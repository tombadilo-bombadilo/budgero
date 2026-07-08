// Package websocket provides real-time synchronization via WebSocket connections.
package websocket

import (
	"context"
	"sync"
	"time"

	"github.com/rs/zerolog/log"
)

// KeyVersionIncrementer is an interface for incrementing encryption key versions.
// This allows the Hub to trigger database operations without having a direct dependency on services.
type KeyVersionIncrementer interface {
	IncrementEncryptionKeyVersion(ctx context.Context, userID, spaceID string) (int64, error)
}

// MutationAppliedMessage represents a mutation that was successfully applied
type MutationAppliedMessage struct {
	Type       string         `json:"type"`
	UserID     string         `json:"userId"`
	SpaceID    string         `json:"spaceId"`
	Version    int64          `json:"version"`
	MutationID string         `json:"mutationId"`
	Payload    *MutationEntry `json:"payload,omitempty"`
	Sender     *Client        `json:"-"` // Excluded from JSON, used to filter broadcasts
}

// EncryptionKeyChangedMessage represents an encryption key version change notification
type EncryptionKeyChangedMessage struct {
	SpaceID    string  `json:"spaceId"`
	NewVersion int64   `json:"newVersion"`
	Sender     *Client `json:"-"` // Excluded from JSON, used to filter broadcasts
}

// Hub maintains the set of active clients and broadcasts messages to the clients.
type Hub struct {
	// Registered clients by space ID
	clients map[string]map[*Client]bool
	mu      sync.RWMutex

	// Mutation log for sequencing
	mutationLog *MutationLog

	// Inbound messages from the clients
	broadcast chan *Message

	// Mutation broadcast channel for real-time mutations
	mutationBroadcast chan *MutationAppliedMessage

	// Encryption key changed broadcast channel
	encryptionKeyBroadcast chan *EncryptionKeyChangedMessage

	// Register requests from the clients
	Register chan *Client

	// Unregister requests from clients
	Unregister chan *Client

	// KeyVersionIncrementer for handling encryption key version increments via WebSocket
	keyVersionIncrementer KeyVersionIncrementer
}

// Message represents a sync state change notification
type Message struct {
	Type    string         `json:"type"`
	UserID  string         `json:"userId"`
	SpaceID string         `json:"spaceId"`
	Version int64          `json:"version"`
	Hash    string         `json:"hash"`
	Payload *MutationEntry `json:"payload,omitempty"`
	// OutOfBand marks sync_state_changed blobs written by bulk imports or
	// restores whose content is NOT in the mutation log — clients must
	// download the blob rather than just record its version.
	OutOfBand bool `json:"out_of_band,omitempty"`

	// Raw, when non-nil, is a pre-built payload that WritePump writes to the
	// socket verbatim instead of the Message itself. It lets read-side handlers
	// (catch-up responses, key-version acks) route arbitrary JSON through the
	// Send channel so WritePump stays the sole socket writer.
	Raw map[string]interface{} `json:"-"`
}

// sendTimeout bounds how long a must-not-drop message (catch-up response)
// waits for room on a client's Send channel before the caller gives up and
// closes the connection.
const sendTimeout = 5 * time.Second

// NewHub creates a new Hub instance
func NewHub(mutationLog *MutationLog) *Hub {
	return &Hub{
		mutationLog:            mutationLog,
		broadcast:              make(chan *Message, 100),                     // Buffered for sync notifications
		mutationBroadcast:      make(chan *MutationAppliedMessage, 100),      // Buffered for mutation broadcasts
		encryptionKeyBroadcast: make(chan *EncryptionKeyChangedMessage, 100), // Buffered for encryption key changes
		Register:               make(chan *Client, 100),                      // Buffered for client registrations
		Unregister:             make(chan *Client, 100),                      // Buffered for client disconnections
		clients:                make(map[string]map[*Client]bool),
	}
}

// SetKeyVersionIncrementer sets the callback for incrementing encryption key versions.
// This should be called after creating handlers that have access to the SpaceService.
func (h *Hub) SetKeyVersionIncrementer(kvi KeyVersionIncrementer) {
	h.keyVersionIncrementer = kvi
}

// Run starts the hub's main event loop
func (h *Hub) Run() {
	for {
		select {
		case client := <-h.Register:
			h.mu.Lock()
			if h.clients[client.spaceID] == nil {
				h.clients[client.spaceID] = make(map[*Client]bool)
			}
			h.clients[client.spaceID][client] = true
			totalConnections := len(h.clients[client.spaceID])
			h.mu.Unlock()

			log.Info().
				Str("user_id", client.userID).
				Str("space_id", client.spaceID).
				Int("total_connections", totalConnections).
				Msg("WebSocket client connected")

		case client := <-h.Unregister:
			h.removeAndCloseClient(client)

			log.Info().
				Str("user_id", client.userID).
				Str("space_id", client.spaceID).
				Msg("WebSocket client disconnected")

		case message := <-h.broadcast:
			// Send to all clients of the same space
			for _, client := range h.clientsForSpace(message.SpaceID) {
				if h.TrySend(client, message) {
					log.Debug().
						Str("user_id", message.UserID).
						Str("space_id", message.SpaceID).
						Int64("version", message.Version).
						Msg("Sent sync notification to client")
				} else {
					// Client's send channel is full (or already closed), drop it
					h.removeAndCloseClient(client)
				}
			}

		case mutationMsg := <-h.mutationBroadcast:
			// Handle mutation applied broadcasts (excluding sender)
			for _, client := range h.clientsForSpace(mutationMsg.SpaceID) {
				if client == mutationMsg.Sender {
					continue // Don't echo back to sender
				}
				sent := h.TrySend(client, &Message{
					Type:    mutationMsg.Type,
					UserID:  mutationMsg.UserID,
					SpaceID: mutationMsg.SpaceID,
					Version: mutationMsg.Version,
					Hash:    mutationMsg.MutationID,
					Payload: mutationMsg.Payload,
				})
				if sent {
					log.Debug().
						Str("user_id", mutationMsg.UserID).
						Str("space_id", mutationMsg.SpaceID).
						Int64("version", mutationMsg.Version).
						Str("mutation_id", mutationMsg.MutationID).
						Msg("Sent mutation applied notification to client")
				} else {
					// Client's send channel is full (or already closed), drop it
					h.removeAndCloseClient(client)
				}
			}

		case keyMsg := <-h.encryptionKeyBroadcast:
			// Handle encryption key changed broadcasts (excluding sender)
			notifiedCount := 0
			for _, client := range h.clientsForSpace(keyMsg.SpaceID) {
				if client == keyMsg.Sender {
					continue // Don't notify the client that initiated the change
				}
				sent := h.TrySend(client, &Message{
					Type:    "encryption_key_changed",
					SpaceID: keyMsg.SpaceID,
					Version: keyMsg.NewVersion,
				})
				if sent {
					notifiedCount++
					log.Debug().
						Str("space_id", keyMsg.SpaceID).
						Str("user_id", client.userID).
						Int64("new_version", keyMsg.NewVersion).
						Msg("Sent encryption key changed notification to client")
				} else {
					// Client's send channel is full (or already closed), drop it
					h.removeAndCloseClient(client)
				}
			}

			log.Info().
				Str("space_id", keyMsg.SpaceID).
				Int64("new_version", keyMsg.NewVersion).
				Int("notified_clients", notifiedCount).
				Msg("Broadcast encryption key changed to other clients")
		}
	}
}

// clientsForSpace returns a snapshot of the clients registered for a space so
// callers can iterate without holding the hub lock: the underlying map may be
// mutated concurrently (ResetSpace, CloseUserClients, full-channel drops).
func (h *Hub) clientsForSpace(spaceID string) []*Client {
	h.mu.RLock()
	defer h.mu.RUnlock()
	clients := make([]*Client, 0, len(h.clients[spaceID]))
	for client := range h.clients[spaceID] {
		clients = append(clients, client)
	}
	return clients
}

// TrySend enqueues a message on the client's Send channel without blocking.
// It returns false when the channel is full or already closed. The sendClosed
// check runs under the hub read lock, and the channel is only ever closed
// while the write lock is held, so this can never send on a closed channel.
func (h *Hub) TrySend(client *Client, message *Message) bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	if client.sendClosed {
		return false
	}
	select {
	case client.Send <- message:
		return true
	default:
		return false
	}
}

// sendOrTimeout keeps trying to enqueue a message that must not be silently
// dropped (a lost catch-up response stalls the client's sync for the whole
// session). It polls rather than blocking on the channel so the hub lock is
// never held across a blocked send. Returns false when the client closed or
// the channel stayed full past sendTimeout.
func (h *Hub) sendOrTimeout(client *Client, message *Message) bool {
	deadline := time.Now().Add(sendTimeout)
	for {
		if h.TrySend(client, message) {
			return true
		}
		h.mu.RLock()
		closed := client.sendClosed
		h.mu.RUnlock()
		if closed || time.Now().After(deadline) {
			return false
		}
		time.Sleep(10 * time.Millisecond)
	}
}

// removeAndCloseClient removes a client from the hub and closes its Send
// channel exactly once. Every disconnect path (Unregister, full-channel drops,
// ResetSpace, CloseUserClients) goes through here so the channel can never be
// closed twice or closed while a guarded send is in flight.
func (h *Hub) removeAndCloseClient(client *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if clients, ok := h.clients[client.spaceID]; ok {
		if _, member := clients[client]; member {
			delete(clients, client)

			// Clean up empty space entries
			if len(clients) == 0 {
				delete(h.clients, client.spaceID)
			}
		}
	}
	if !client.sendClosed {
		client.sendClosed = true
		close(client.Send)
	}
}

// CloseUserClients disconnects all of a user's clients for a space, e.g. after
// membership revocation, so removed users don't keep a live mutation stream.
func (h *Hub) CloseUserClients(spaceID, userID string) {
	closed := 0
	for _, client := range h.clientsForSpace(spaceID) {
		if client.userID != userID {
			continue
		}
		h.removeAndCloseClient(client)
		closed++
	}
	if closed > 0 {
		log.Info().
			Str("space_id", spaceID).
			Str("user_id", userID).
			Int("closed_connections", closed).
			Msg("Closed WebSocket clients for removed user")
	}
}

// NotifyUserPasswordChanged tells every OTHER connected client belonging to
// the same user — across all spaces — that the account's master password
// changed, so those devices reload and re-prompt. This is deliberately
// USER-scoped: a master-password change never rotates any space key, so
// other members of a shared space must not be notified (their passwords are
// their own).
func (h *Hub) NotifyUserPasswordChanged(userID string, sender *Client) {
	h.mu.RLock()
	targets := make([]*Client, 0)
	for _, clients := range h.clients {
		for client := range clients {
			if client.userID == userID && client != sender {
				targets = append(targets, client)
			}
		}
	}
	h.mu.RUnlock()

	notified := 0
	for _, client := range targets {
		if h.TrySend(client, &Message{Type: "master_password_changed", UserID: userID, SpaceID: client.spaceID}) {
			notified++
		}
	}
	log.Info().
		Str("user_id", userID).
		Int("notified_connections", notified).
		Msg("Notified user's other devices of master password change")
}

// NotifyDatabaseUpdate sends a sync state change notification to all clients
// of the space. outOfBand marks blobs whose content is not in the mutation log
// (imports/restores) so receivers download them instead of waiting for catch-up.
func (h *Hub) NotifyDatabaseUpdate(spaceID, userID string, version int64, hash string, outOfBand bool) {
	message := &Message{
		Type:      "sync_state_changed",
		UserID:    userID,
		SpaceID:   spaceID,
		Version:   version,
		Hash:      hash,
		OutOfBand: outOfBand,
	}

	select {
	case h.broadcast <- message:
		// Message sent
	default:
		// Broadcast channel is full, log and continue
		log.Warn().
			Str("user_id", userID).
			Str("space_id", spaceID).
			Msg("Failed to broadcast sync notification - channel full")
	}
}

// NotifyEncryptionKeyChanged sends an encryption key changed notification to all clients of a space,
// excluding the sender client. This is called when a user changes their master password.
func (h *Hub) NotifyEncryptionKeyChanged(spaceID string, newVersion int64, sender *Client) {
	keyMsg := &EncryptionKeyChangedMessage{
		SpaceID:    spaceID,
		NewVersion: newVersion,
		Sender:     sender,
	}

	select {
	case h.encryptionKeyBroadcast <- keyMsg:
		// enqueued for broadcast loop
	default:
		log.Warn().
			Str("space_id", spaceID).
			Msg("encryptionKeyBroadcast channel full; dropping notification")
	}
}

// HandleEncryptionKeyVersionIncrement processes a request to increment the encryption key version.
// It increments the version in the database and broadcasts to all other clients.
func (h *Hub) HandleEncryptionKeyVersionIncrement(ctx context.Context, spaceID, userID string, sender *Client) (int64, error) {
	if h.keyVersionIncrementer == nil {
		log.Error().Msg("KeyVersionIncrementer not set on Hub")
		return 0, nil
	}

	newVersion, err := h.keyVersionIncrementer.IncrementEncryptionKeyVersion(ctx, userID, spaceID)
	if err != nil {
		log.Error().
			Err(err).
			Str("user_id", userID).
			Str("space_id", spaceID).
			Msg("Failed to increment encryption key version")
		return 0, err
	}

	// Broadcast to all other clients (excluding sender)
	h.NotifyEncryptionKeyChanged(spaceID, newVersion, sender)

	log.Info().
		Str("user_id", userID).
		Str("space_id", spaceID).
		Int64("new_version", newVersion).
		Msg("Encryption key version incremented via WebSocket")

	return newVersion, nil
}

// HandleMutation processes a mutation and broadcasts it to other clients within the same space.
func (h *Hub) HandleMutation(spaceID, userID string, mutation *MutationMessage, sender *Client) error {
	// Append to mutation log and get assigned version
	version, err := h.mutationLog.AppendMutation(spaceID, userID, mutation)
	if err != nil {
		return err
	}

	mutation.SpaceID = spaceID

	// Send acknowledgment to sender (just version, no payload to avoid echo)
	if sender != nil {
		ackMsg := &Message{
			Type:    "mutation_ack",
			UserID:  userID,
			SpaceID: spaceID,
			Version: version,
			Hash:    mutation.ID, // Reuse hash field for mutation ID
		}
		if h.TrySend(sender, ackMsg) {
			log.Debug().
				Str("user_id", userID).
				Str("space_id", spaceID).
				Str("mutation_id", mutation.ID).
				Int64("version", version).
				Msg("Sent mutation acknowledgment to sender")
		} else {
			log.Warn().
				Str("user_id", userID).
				Str("mutation_id", mutation.ID).
				Msg("Failed to send mutation acknowledgment - channel full or closed")
		}
	}

	// Create mutation entry for broadcast
	mutationEntry := &MutationEntry{
		ID:               mutation.ID,
		SpaceID:          spaceID,
		UserID:           userID,
		Version:          version,
		Op:               mutation.Op,               // Legacy: will be empty for encrypted
		Args:             mutation.Args,             // Legacy: will be empty for encrypted
		EncryptedPayload: mutation.EncryptedPayload, // New: encrypted op + args
		Timestamp:        mutation.Timestamp,
		BaseVersion:      mutation.BaseVersion,
	}

	// Broadcast mutation applied message to other clients (excluding sender)
	mutationMsg := &MutationAppliedMessage{
		Type:       "mutation_applied",
		UserID:     userID,
		SpaceID:    spaceID,
		Version:    version,
		MutationID: mutation.ID,
		Payload:    mutationEntry,
		Sender:     sender,
	}

	select {
	case h.mutationBroadcast <- mutationMsg:
		// enqueued for broadcast loop
	default:
		log.Warn().
			Str("space_id", spaceID).
			Msg("mutationBroadcast channel full; dropping real-time broadcast")
	}

	return nil
}

// GetMutationsSince returns mutations since a given version for catch-up
func (h *Hub) GetMutationsSince(spaceID string, sinceVersion int64) ([]*MutationEntry, error) {
	return h.mutationLog.GetMutationsSince(spaceID, sinceVersion, 50) // Limit to 50 mutations
}

// GetLatestMutationVersion returns the latest mutation-log version for a space.
func (h *Hub) GetLatestMutationVersion(spaceID string) (int64, error) {
	return h.mutationLog.GetLatestVersion(spaceID)
}

// ResetSpace clears mutation state and disconnects any active clients for the space.
func (h *Hub) ResetSpace(spaceID string) error {
	if err := h.mutationLog.ResetSpace(spaceID); err != nil {
		return err
	}

	for _, client := range h.clientsForSpace(spaceID) {
		h.removeAndCloseClient(client)
	}

	log.Info().Str("space_id", spaceID).Msg("Reset sync state for space")
	return nil
}
