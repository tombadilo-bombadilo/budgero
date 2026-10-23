package bankrelay

import (
	"context"
	"errors"
	"io"
	"net"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
	"golang.org/x/time/rate"
)

// EnableBankingTarget is the only destination the production relay allows.
const EnableBankingTarget = "api.enablebanking.com:443"

// ErrThrottled is returned when a user asks for tickets or sessions too fast.
var ErrThrottled = errors.New("bank relay rate limit exceeded")

// Options tunes the relay. Zero values fall back to DefaultOptions.
type Options struct {
	// AllowedTargets lists "host:port" pairs the relay will dial. Everything
	// else is refused, so the relay can't be used as an open proxy.
	AllowedTargets []string
	Dial           func(ctx context.Context, network, address string) (net.Conn, error)
	// BufferSize is the Wisp flow-control window, in packets per stream.
	BufferSize uint32
	// MaxStreams caps concurrent TCP streams per WebSocket.
	MaxStreams int
	// MaxStreamOpens caps streams opened over a WebSocket's lifetime.
	MaxStreamOpens int
	// MaxBytes caps traffic (both directions) per WebSocket.
	MaxBytes int64
	// IdleTimeout closes a WebSocket that has no open streams and no traffic.
	IdleTimeout time.Duration
	// StreamIdleTimeout closes a stream whose destination sends nothing for
	// this long. It's generous because a bank can take minutes to answer.
	StreamIdleTimeout time.Duration
	MaxDuration       time.Duration
	TicketTTL         time.Duration
	// SessionsPerUser caps concurrent WebSockets per user.
	SessionsPerUser int
	// UserRate and UserBurst limit how often a user may get a ticket.
	UserRate  rate.Limit
	UserBurst int
}

// DefaultOptions returns production settings: Enable Banking only.
func DefaultOptions() Options {
	return Options{
		AllowedTargets:    []string{EnableBankingTarget},
		Dial:              (&net.Dialer{Timeout: 10 * time.Second}).DialContext,
		BufferSize:        128,
		MaxStreams:        8,
		MaxStreamOpens:    64,
		MaxBytes:          64 << 20,
		IdleTimeout:       90 * time.Second,
		StreamIdleTimeout: 5 * time.Minute,
		MaxDuration:       15 * time.Minute,
		TicketTTL:         10 * time.Minute,
		SessionsPerUser:   3,
		UserRate:          rate.Every(time.Minute),
		UserBurst:         20,
	}
}

func (o *Options) withDefaults() Options {
	d := DefaultOptions()
	out := *o
	o = &out
	if len(o.AllowedTargets) == 0 {
		o.AllowedTargets = d.AllowedTargets
	}
	if o.Dial == nil {
		o.Dial = d.Dial
	}
	if o.BufferSize < 2 {
		o.BufferSize = d.BufferSize
	}
	if o.MaxStreams <= 0 {
		o.MaxStreams = d.MaxStreams
	}
	if o.MaxStreamOpens <= 0 {
		o.MaxStreamOpens = d.MaxStreamOpens
	}
	if o.MaxBytes <= 0 {
		o.MaxBytes = d.MaxBytes
	}
	if o.IdleTimeout <= 0 {
		o.IdleTimeout = d.IdleTimeout
	}
	if o.StreamIdleTimeout <= 0 {
		o.StreamIdleTimeout = d.StreamIdleTimeout
	}
	if o.MaxDuration <= 0 {
		o.MaxDuration = d.MaxDuration
	}
	if o.TicketTTL <= 0 {
		o.TicketTTL = d.TicketTTL
	}
	if o.SessionsPerUser <= 0 {
		o.SessionsPerUser = d.SessionsPerUser
	}
	if o.UserRate <= 0 {
		o.UserRate = d.UserRate
		o.UserBurst = d.UserBurst
	}
	if o.UserBurst <= 0 {
		o.UserBurst = d.UserBurst
	}
	return out
}

// Stats are the only things the relay records: counters, no identities.
type Stats struct {
	ActiveSessions   int64 `json:"active_sessions"`
	Sessions         int64 `json:"sessions"`
	Streams          int64 `json:"streams"`
	RejectedConnects int64 `json:"rejected_connects"`
	BytesUp          int64 `json:"bytes_up"`
	BytesDown        int64 `json:"bytes_down"`
}

type userState struct {
	limiter  *rate.Limiter
	active   int
	lastSeen time.Time
}

// Relay accepts Wisp WebSockets and pipes their streams to allowed hosts.
type Relay struct {
	opts    Options
	allowed map[string]struct{}
	tickets *ticketSigner

	mu        sync.Mutex
	users     map[string]*userState
	lastSweep time.Time

	activeSessions   atomic.Int64
	sessions         atomic.Int64
	streams          atomic.Int64
	rejectedConnects atomic.Int64
	bytesUp          atomic.Int64
	bytesDown        atomic.Int64
}

// New builds a relay.
func New(options *Options) *Relay {
	opts := options.withDefaults()
	allowed := make(map[string]struct{}, len(opts.AllowedTargets))
	for _, target := range opts.AllowedTargets {
		allowed[strings.ToLower(target)] = struct{}{}
	}
	return &Relay{
		opts:    opts,
		allowed: allowed,
		tickets: newTicketSigner(opts.TicketTTL),
		users:   map[string]*userState{},
	}
}

// Stats returns a snapshot of the relay counters.
func (r *Relay) Stats() Stats {
	return Stats{
		ActiveSessions:   r.activeSessions.Load(),
		Sessions:         r.sessions.Load(),
		Streams:          r.streams.Load(),
		RejectedConnects: r.rejectedConnects.Load(),
		BytesUp:          r.bytesUp.Load(),
		BytesDown:        r.bytesDown.Load(),
	}
}

// IssueTicket returns a short-lived ticket that opens relay sessions for userID.
func (r *Relay) IssueTicket(userID string) (string, time.Time, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.user(userID).limiter.Allow() {
		return "", time.Time{}, ErrThrottled
	}
	ticket, expires := r.tickets.issue(userID)
	return ticket, expires, nil
}

// Acquire validates a ticket and reserves a session slot. Call release when
// the session ends.
func (r *Relay) Acquire(ticket string) (release func(), err error) {
	_, release, err = r.AcquireUser(ticket)
	return release, err
}

// AcquireUser is Acquire that also returns the ticket's user. The user is
// returned with ErrThrottled too (the ticket was valid), and is empty when
// the ticket itself is invalid.
func (r *Relay) AcquireUser(ticket string) (userID string, release func(), err error) {
	userID, err = r.tickets.verify(ticket)
	if err != nil {
		return "", nil, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	state := r.user(userID)
	if state.active >= r.opts.SessionsPerUser {
		return userID, nil, ErrThrottled
	}
	state.active++
	var once sync.Once
	return userID, func() {
		once.Do(func() {
			r.mu.Lock()
			state.active--
			state.lastSeen = time.Now()
			r.mu.Unlock()
		})
	}, nil
}

// user returns the per-user state, sweeping idle entries now and then.
// Callers hold r.mu.
func (r *Relay) user(userID string) *userState {
	now := time.Now()
	if now.Sub(r.lastSweep) > 10*time.Minute {
		r.lastSweep = now
		for id, state := range r.users {
			if state.active == 0 && now.Sub(state.lastSeen) > time.Hour {
				delete(r.users, id)
			}
		}
	}
	state, ok := r.users[userID]
	if !ok {
		state = &userState{limiter: rate.NewLimiter(r.opts.UserRate, r.opts.UserBurst)}
		r.users[userID] = state
	}
	state.lastSeen = now
	return state
}

func (r *Relay) allows(host string, port uint16) bool {
	address := net.JoinHostPort(strings.ToLower(strings.TrimSpace(host)), strconv.Itoa(int(port)))
	_, ok := r.allowed[address]
	return ok
}

// Serve runs a Wisp session on an upgraded WebSocket until either side closes
// it, it idles out, or it hits MaxDuration. It closes ws before returning.
func (r *Relay) Serve(ctx context.Context, ws *websocket.Conn) {
	ctx, cancel := context.WithTimeout(ctx, r.opts.MaxDuration)
	s := &session{relay: r, ws: ws, ctx: ctx, cancel: cancel, streams: map[uint32]*stream{}}
	r.sessions.Add(1)
	r.activeSessions.Add(1)
	defer r.activeSessions.Add(-1)
	defer s.shutdown()

	go func() {
		<-ctx.Done()
		_ = ws.Close()
	}()
	go s.watchIdle()

	ws.SetReadLimit(1 << 20)
	if !s.write(continuePacket(0, r.opts.BufferSize)) {
		return
	}
	for {
		kind, raw, err := ws.ReadMessage()
		if err != nil {
			return
		}
		s.touch()
		if kind != websocket.BinaryMessage {
			continue
		}
		p, err := parsePacket(raw)
		if err != nil {
			return
		}
		switch p.kind {
		case packetConnect:
			s.connect(ctx, p)
		case packetData:
			if !s.data(p) {
				return
			}
		case packetClose:
			if st := s.stream(p.streamID); st != nil {
				s.finish(st, 0)
			}
		}
	}
}

type session struct {
	relay  *Relay
	ws     *websocket.Conn
	ctx    context.Context
	cancel context.CancelFunc

	writeMu sync.Mutex

	mu      sync.Mutex
	streams map[uint32]*stream
	opened  int
	bytes   atomic.Int64
	// lastActive is the unix-nano time of the last traffic in either direction.
	lastActive atomic.Int64
}

type stream struct {
	id   uint32
	in   chan []byte
	done chan struct{}
	// received counts DATA packets from the client, for flow control.
	received atomic.Uint32

	mu     sync.Mutex
	conn   net.Conn
	closed bool
	once   sync.Once
}

func (s *session) write(frame []byte) bool {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	_ = s.ws.SetWriteDeadline(time.Now().Add(10 * time.Second))
	if err := s.ws.WriteMessage(websocket.BinaryMessage, frame); err != nil {
		s.cancel()
		return false
	}
	s.touch()
	return true
}

func (s *session) touch() {
	s.lastActive.Store(time.Now().UnixNano())
}

// watchIdle ends the session once it has no open streams and no traffic for
// IdleTimeout. Open streams are bounded by StreamIdleTimeout and MaxDuration
// instead, so a slow bank answer never trips it.
func (s *session) watchIdle() {
	idle := s.relay.opts.IdleTimeout
	tick := time.NewTicker(min(idle/4, time.Second))
	defer tick.Stop()
	s.touch()
	for {
		select {
		case <-s.ctx.Done():
			return
		case <-tick.C:
			s.mu.Lock()
			open := len(s.streams)
			s.mu.Unlock()
			if open == 0 && time.Since(time.Unix(0, s.lastActive.Load())) > idle {
				s.cancel()
				return
			}
		}
	}
}

func (s *session) stream(id uint32) *stream {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.streams[id]
}

// count adds n bytes to the session budget; false once it's spent.
func (s *session) count(n int) bool {
	return s.bytes.Add(int64(n)) <= s.relay.opts.MaxBytes
}

func (s *session) connect(ctx context.Context, p packet) {
	req, err := parseConnect(p.payload)
	if err != nil || p.streamID == 0 {
		s.write(closePacket(p.streamID, closeInvalidInfo))
		return
	}
	if req.streamType != streamTCP || !s.relay.allows(req.host, req.port) {
		s.relay.rejectedConnects.Add(1)
		s.write(closePacket(p.streamID, closeBlocked))
		return
	}

	s.mu.Lock()
	if _, exists := s.streams[p.streamID]; exists {
		s.mu.Unlock()
		s.write(closePacket(p.streamID, closeInvalidInfo))
		return
	}
	if len(s.streams) >= s.relay.opts.MaxStreams || s.opened >= s.relay.opts.MaxStreamOpens {
		s.mu.Unlock()
		s.relay.rejectedConnects.Add(1)
		s.write(closePacket(p.streamID, closeThrottled))
		return
	}
	st := &stream{
		id: p.streamID,
		// Twice the window: a CONTINUE can cross packets still in flight.
		in:   make(chan []byte, 2*s.relay.opts.BufferSize),
		done: make(chan struct{}),
	}
	s.streams[p.streamID] = st
	s.opened++
	s.mu.Unlock()

	s.relay.streams.Add(1)
	address := net.JoinHostPort(strings.ToLower(strings.TrimSpace(req.host)), strconv.Itoa(int(req.port)))
	go s.run(ctx, st, address)
}

// data queues bytes for a stream. Wisp lets clients send before the TCP dial
// completes, so bytes wait in the stream's channel. A full channel blocks the
// read loop, which is the backpressure a client gets for ignoring CONTINUE.
func (s *session) data(p packet) bool {
	st := s.stream(p.streamID)
	if st == nil {
		return true
	}
	if !s.count(len(p.payload)) {
		return false
	}
	s.relay.bytesUp.Add(int64(len(p.payload)))
	st.received.Add(1)
	select {
	case st.in <- p.payload:
	case <-st.done:
	case <-s.ctx.Done():
		return false
	}
	return true
}

func (s *session) run(ctx context.Context, st *stream, address string) {
	dialCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	conn, err := s.relay.opts.Dial(dialCtx, "tcp", address)
	cancel()
	if err != nil {
		s.finish(st, closeUnreachable)
		return
	}
	st.mu.Lock()
	if st.closed {
		st.mu.Unlock()
		_ = conn.Close()
		return
	}
	st.conn = conn
	st.mu.Unlock()

	go s.pumpDown(st, conn)

	// Flow control: the client may send `advertised` packets after our last
	// CONTINUE. Once fewer than half remain, advertise the free queue space.
	// Clients reset their budget to the advertised value, so advertising more
	// than is free would let the queue grow until it blocks the read loop.
	window := s.relay.opts.BufferSize
	advertised, receivedAtAdvert := window, uint32(0)
	for {
		select {
		case <-st.done:
			return
		case <-s.ctx.Done():
			s.finish(st, closeVoluntary)
			return
		case chunk := <-st.in:
			_ = conn.SetWriteDeadline(time.Now().Add(s.relay.opts.StreamIdleTimeout))
			if _, err := conn.Write(chunk); err != nil {
				s.finish(st, closeNetworkError)
				return
			}
			s.touch()
			received := st.received.Load()
			remaining := int64(advertised) - int64(received-receivedAtAdvert)
			if remaining < int64(window/2) {
				queued := uint32(len(st.in)) //nolint:gosec // bounded by the channel capacity
				free := uint32(0)
				if queued < window {
					free = window - queued
				}
				if int64(free) > remaining {
					advertised, receivedAtAdvert = free, received
					s.write(continuePacket(st.id, free))
				}
			}
		}
	}
}

// pumpDown copies bytes from the destination back to the browser.
func (s *session) pumpDown(st *stream, conn net.Conn) {
	buf := make([]byte, 32*1024)
	for {
		_ = conn.SetReadDeadline(time.Now().Add(s.relay.opts.StreamIdleTimeout))
		n, err := conn.Read(buf)
		if n > 0 {
			s.touch()
			if !s.count(n) {
				s.cancel()
				return
			}
			s.relay.bytesDown.Add(int64(n))
			if !s.write(encodePacket(packetData, st.id, buf[:n])) {
				return
			}
		}
		if err != nil {
			reason := closeNetworkError
			if errors.Is(err, io.EOF) {
				reason = closeVoluntary
			}
			s.finish(st, reason)
			return
		}
	}
}

// finish tears a stream down once. reason 0 means the client closed it, so
// no CLOSE is echoed back.
func (s *session) finish(st *stream, reason byte) {
	st.once.Do(func() {
		st.mu.Lock()
		st.closed = true
		conn := st.conn
		st.mu.Unlock()
		close(st.done)
		if conn != nil {
			_ = conn.Close()
		}
		s.mu.Lock()
		delete(s.streams, st.id)
		s.mu.Unlock()
		if reason != 0 && s.ctx.Err() == nil {
			s.write(closePacket(st.id, reason))
		}
	})
}

func (s *session) shutdown() {
	s.cancel()
	s.mu.Lock()
	open := make([]*stream, 0, len(s.streams))
	for _, st := range s.streams {
		open = append(open, st)
	}
	s.mu.Unlock()
	for _, st := range open {
		s.finish(st, 0)
	}
	_ = s.ws.Close()
}
