package websocket

import (
	"context"
	"encoding/json"
	"time"

	"github.com/gorilla/websocket"
	"github.com/rs/zerolog/log"
)

const (
	// Time allowed to write a message to the peer
	writeWait = 10 * time.Second

	// Time allowed to read the next pong message from the peer
	pongWait = 60 * time.Second

	// Send pings to peer with this period. Must be less than pongWait
	pingPeriod = (pongWait * 9) / 10

	// Maximum message size allowed from peer (increased for database blobs)
	maxMessageSize = 10 * 1024 * 1024 // 10MB
)

// Client is a middleman between the websocket connection and the hub
type Client struct {
	hub     *Hub
	conn    *websocket.Conn
	Send    chan *Message
	userID  string
	spaceID string

	// sendClosed marks the Send channel as closed. Guarded by hub.mu: it is
	// only set (and the channel only closed) via Hub.removeAndCloseClient
	// under the write lock, and checked by senders under the read lock.
	sendClosed bool
}

// NewClient creates a new Client instance
func NewClient(hub *Hub, conn *websocket.Conn, userID, spaceID string) *Client {
	return &Client{
		hub:     hub,
		conn:    conn,
		Send:    make(chan *Message, 256),
		userID:  userID,
		spaceID: spaceID,
	}
}

// ReadPump pumps messages from the websocket connection to the hub
func (c *Client) ReadPump() {
	defer func() {
		c.hub.Unregister <- c
		_ = c.conn.Close()
	}()

	// Set max message size for binary blobs (10MB should be enough for most databases)
	c.conn.SetReadLimit(maxMessageSize)

	_ = c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		_ = c.conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	for {
		// Read messages from client (both text and binary)
		msgType, data, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Error().Err(err).Str("user_id", c.userID).Msg("WebSocket read error")
			}
			break
		}

		// Log every message received
		log.Info().
			Str("user_id", c.userID).
			Str("space_id", c.spaceID).
			Int("msg_type", msgType).
			Int("data_len", len(data)).
			Bool("is_text", msgType == websocket.TextMessage).
			Bool("is_binary", msgType == websocket.BinaryMessage).
			Msg("Message received")

		// Handle text messages (mutations and other messages)
		if msgType == websocket.TextMessage {
			log.Info().
				Str("user_id", c.userID).
				Str("space_id", c.spaceID).
				Str("data", string(data)).
				Msg("Received text message")

			// Parse JSON message
			var msg map[string]interface{}
			if err := json.Unmarshal(data, &msg); err != nil {
				log.Error().
					Err(err).
					Str("user_id", c.userID).
					Str("data", string(data)).
					Msg("Failed to parse text message")
			} else {
				msgType, hasType := msg["type"].(string)

				switch {
				case hasType && msgType == "mutation":
					// Handle incoming mutation
					var mutation MutationMessage
					if err := json.Unmarshal(data, &mutation); err != nil {
						log.Error().
							Err(err).
							Str("user_id", c.userID).
							Msg("Failed to parse mutation message")
					} else {
						log.Info().
							Str("user_id", c.userID).
							Str("mutation_id", mutation.ID).
							Str("op", mutation.Op).
							Msg("Processing incoming mutation")

							// Handle the mutation
						mutation.SpaceID = c.spaceID
						if err := c.hub.HandleMutation(c.spaceID, c.userID, &mutation, c); err != nil {
							log.Error().
								Err(err).
								Str("user_id", c.userID).
								Str("space_id", c.spaceID).
								Str("mutation_id", mutation.ID).
								Msg("Failed to handle mutation")
						}
					}
				case hasType && msgType == "catch_up_request":
					// Handle catch-up request
					if sinceVersion, ok := msg["sinceVersion"].(float64); ok {
						since := int64(sinceVersion)
						log.Info().
							Str("user_id", c.userID).
							Str("space_id", c.spaceID).
							Int64("since_version", since).
							Msg("Processing catch-up request")

						c.handleCatchUpRequest(since)
					}
				case hasType && msgType == "master_password_changed":
					// User-scoped fan-out: the sender changed their master
					// password; notify the same user's other devices only.
					c.hub.NotifyUserPasswordChanged(c.userID, c)
				case hasType && msgType == "increment_encryption_key_version":
					// Handle encryption key version increment request
					log.Info().
						Str("user_id", c.userID).
						Str("space_id", c.spaceID).
						Msg("Processing encryption key version increment request")

					ctx := context.Background()
					newVersion, err := c.hub.HandleEncryptionKeyVersionIncrement(ctx, c.spaceID, c.userID, c)

					// Send response back to sender
					response := map[string]interface{}{
						"type":     "encryption_key_version_ack",
						"space_id": c.spaceID,
						"success":  err == nil,
					}
					if err == nil {
						response["new_version"] = newVersion
					} else {
						response["error"] = err.Error()
					}

					// Route through the Send channel: WritePump is the sole
					// socket writer (gorilla/websocket forbids concurrent writes).
					if !c.hub.TrySend(c, &Message{Type: "encryption_key_version_ack", SpaceID: c.spaceID, Raw: response}) {
						log.Error().
							Str("user_id", c.userID).
							Str("space_id", c.spaceID).
							Msg("Failed to queue encryption key version ack - channel full or closed")
					}
				default:
					log.Info().
						Str("user_id", c.userID).
						Str("space_id", c.spaceID).
						Str("type", msgType).
						Msg("Non-mutation text message")
				}
			}
		}

		// Note: Binary message handling removed - database blobs now handled via HTTP Layer 2 endpoints
	}
}

func buildCatchUpResponse(spaceID string, sinceVersion int64, mutations []*MutationEntry, latestVersion int64) map[string]interface{} {
	if mutations == nil {
		mutations = make([]*MutationEntry, 0)
	}

	nextSinceVersion := sinceVersion
	if len(mutations) > 0 {
		nextSinceVersion = mutations[len(mutations)-1].Version
	}
	hasMore := latestVersion > nextSinceVersion

	return map[string]interface{}{
		"type":             "catch_up_response",
		"mutations":        mutations,
		"space_id":         spaceID,
		"hasMore":          hasMore,
		"latestVersion":    latestVersion,
		"nextSinceVersion": nextSinceVersion,
	}
}

const catchUpFetchMaxAttempts = 3

// handleCatchUpRequest fetches mutations since the given version and queues a
// catch_up_response on the Send channel (WritePump is the sole socket writer).
// A silently dropped or fabricated response would stall the client's sync for
// the whole session, so persistent failures close the connection instead: the
// client reconnects and re-requests catch-up.
func (c *Client) handleCatchUpRequest(since int64) {
	mutations, err := c.getMutationsSinceWithRetry(since)
	if err != nil {
		log.Error().
			Err(err).
			Str("user_id", c.userID).
			Str("space_id", c.spaceID).
			Int64("since_version", since).
			Msg("Failed to get mutations for catch-up; closing connection so the client retries")
		_ = c.conn.Close()
		return
	}

	latestVersion, latestErr := c.hub.GetLatestMutationVersion(c.spaceID)
	if latestErr != nil {
		// One retry before giving up: answering with fabricated metadata
		// (e.g. hasMore=false while mutations remain) would strand the client.
		latestVersion, latestErr = c.hub.GetLatestMutationVersion(c.spaceID)
	}
	if latestErr != nil {
		log.Error().
			Err(latestErr).
			Str("user_id", c.userID).
			Str("space_id", c.spaceID).
			Msg("Failed to fetch latest mutation version for catch-up; closing connection so the client retries")
		_ = c.conn.Close()
		return
	}

	response := buildCatchUpResponse(c.spaceID, since, mutations, latestVersion)
	if !c.hub.sendOrTimeout(c, &Message{Type: "catch_up_response", SpaceID: c.spaceID, Raw: response}) {
		log.Error().
			Str("user_id", c.userID).
			Str("space_id", c.spaceID).
			Msg("Failed to queue catch-up response; closing connection so the client retries")
		_ = c.conn.Close()
		return
	}

	hasMore, _ := response["hasMore"].(bool)
	nextSinceVersion, _ := response["nextSinceVersion"].(int64)
	log.Info().
		Str("user_id", c.userID).
		Str("space_id", c.spaceID).
		Int("mutation_count", len(mutations)).
		Int64("latest_version", latestVersion).
		Int64("next_since_version", nextSinceVersion).
		Bool("has_more", hasMore).
		Msg("Queued catch-up response")
}

// getMutationsSinceWithRetry mirrors MutationLog.AppendMutation's retry loop
// for transient SQLite lock errors.
func (c *Client) getMutationsSinceWithRetry(since int64) ([]*MutationEntry, error) {
	var lastErr error
	for attempt := 1; attempt <= catchUpFetchMaxAttempts; attempt++ {
		mutations, err := c.hub.GetMutationsSince(c.spaceID, since)
		if err == nil {
			return mutations, nil
		}
		lastErr = err
		if !isRetryableMutationAppendError(err) || attempt == catchUpFetchMaxAttempts {
			break
		}
		time.Sleep(time.Duration(attempt) * 50 * time.Millisecond)
	}
	return nil, lastErr
}

// WritePump pumps messages from the hub to the websocket connection
func (c *Client) WritePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		_ = c.conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.Send:
			_ = c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				// The hub closed the channel
				_ = c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			// Pre-built payloads (catch-up responses, key-version acks) are
			// written verbatim; read-side handlers use this to route JSON
			// through the single-writer Send channel.
			if message.Raw != nil {
				if err := c.conn.WriteJSON(message.Raw); err != nil {
					log.Error().
						Err(err).
						Str("user_id", c.userID).
						Str("type", message.Type).
						Msg("Failed to write raw payload to WebSocket")
					return
				}
				continue
			}

			// Handle mutation acknowledgments (simple pass-through)
			switch message.Type {
			case "mutation_ack":
				// Just send the ack as-is
				ackMsg := map[string]interface{}{
					"type":       "mutation_ack",
					"mutationId": message.Hash,
					"version":    message.Version,
					"space_id":   c.spaceID,
					"success":    true,
				}

				if err := c.conn.WriteJSON(ackMsg); err != nil {
					log.Error().
						Err(err).
						Str("user_id", c.userID).
						Msg("Failed to write mutation ack to WebSocket")
					return
				}

				log.Debug().
					Str("user_id", c.userID).
					Str("mutation_id", message.Hash).
					Int64("version", message.Version).
					Msg("Sent mutation ack to client")
			case "mutation_applied":
				// For mutation_applied, we need to send the payload - get it from the hash field
				mutationID := message.Hash

				// The hub attaches the full mutation entry on broadcast; only
				// fall back to re-querying the log when it is missing.
				var payload interface{}
				if message.Payload != nil {
					payload = message.Payload
				} else if mutations, err := c.hub.GetMutationsSince(c.spaceID, message.Version-1); err == nil {
					// Find the matching mutation
					for _, mut := range mutations {
						if mut.ID == mutationID && mut.Version == message.Version {
							payload = mut
							break
						}
					}
				}

				// Send mutation applied message with payload
				appliedMsg := map[string]interface{}{
					"type":       "mutation_applied",
					"userId":     message.UserID,
					"version":    message.Version,
					"mutationId": mutationID,
					"payload":    payload,
				}

				if err := c.conn.WriteJSON(appliedMsg); err != nil {
					log.Error().
						Err(err).
						Str("user_id", c.userID).
						Msg("Failed to write mutation applied to WebSocket")
					return
				}

				log.Debug().
					Str("user_id", c.userID).
					Str("mutation_id", mutationID).
					Int64("version", message.Version).
					Bool("has_payload", payload != nil).
					Msg("Sent mutation applied with payload")
			default:
				// Regular message
				if err := c.conn.WriteJSON(message); err != nil {
					log.Error().
						Err(err).
						Str("user_id", c.userID).
						Msg("Failed to write message to WebSocket")
					return
				}
			}

		// Note: Binary send channel removed - database blobs now handled via HTTP Layer 2 endpoints

		case <-ticker.C:
			_ = c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
