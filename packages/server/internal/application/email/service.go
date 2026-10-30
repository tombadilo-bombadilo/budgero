// Package email owns the transactional + marketing email flows for the
// SaaS deployment:
//
//   - Welcome (fired once per user, right after the user row is created)
//   - Inactivity nudge (72h after signup, zero mutations recorded)
//   - Trial-ended discount (2 days after trial_ends_at, no active subscription)
//
// Each flow is de-duplicated per user via the sent_emails table so a crash,
// retry loop, or scheduler restart can't fire a second copy. See scheduler.go
// for the polling loop that drives flows 2 and 3 and retries flow 1 if the
// inline send at signup failed.
package email

import (
	"bytes"
	"context"
	"embed"
	"errors"
	"fmt"
	"html/template"
	"strings"
	"time"

	"budgero-server/internal/config"

	"github.com/resend/resend-go/v2"
	"github.com/rs/zerolog/log"
)

// Template names — also the de-dup keys stored in sent_emails.template.
// DO NOT rename these strings; doing so will make the scheduler think old
// recipients haven't been emailed and it will re-send.
const (
	TemplateWelcome          = "welcome"
	TemplateTrialEndingDay33 = "trial_ending_day33"
	TemplateTrialEndingDay35 = "trial_ending_day35"
	// Rendered per broadcast; the sent_emails dedup key is quarter-stamped
	// (see QuarterKey), so the same template can be re-sent each quarter.
	TemplateQuarterlyFeedback = "quarterly_feedback"
	TemplateDay2Feedback      = "day2_feedback"
)

//go:embed templates/*.html
var templatesFS embed.FS

// Sender is the minimum interface the rest of the app depends on. The
// Resend-backed implementation is resendSender; tests can pass a fake.
type Sender interface {
	Send(ctx context.Context, msg Message) error
}

// Message is a fully-rendered email ready to hand to the transport.
type Message struct {
	To       string
	Subject  string
	HTMLBody string
	// ReplyTo is optional; when empty the transport omits the header.
	// Welcome sets it to hello@; marketing emails leave it blank.
	ReplyTo string
}

// Service orchestrates rendering templates, de-duping sends via the store,
// and handing the rendered message to the Sender.
type Service struct {
	cfg    *config.Config
	store  *Store
	sender Sender
	tpls   map[string]*template.Template
}

// NewService wires the Resend client, store, and parsed templates. Returns
// (nil, nil) — explicitly, with no error — when email is disabled via config.
// Callers should treat a nil Service as "email is off; silently skip."
func NewService(cfg *config.Config, store *Store) (*Service, error) {
	if !cfg.HasEmail() {
		log.Info().Msg("email: disabled (RESEND_API_KEY unset or EMAIL_ENABLED=false)")
		return nil, nil
	}
	sender, err := newResendSender(cfg)
	if err != nil {
		return nil, err
	}
	tpls, err := parseTemplates()
	if err != nil {
		return nil, err
	}
	log.Info().Str("from", cfg.Email.FromAddress).Bool("dry_run", cfg.Email.DryRun).
		Msg("email: service initialized")
	return &Service{cfg: cfg, store: store, sender: sender, tpls: tpls}, nil
}

// NewServiceWithSender builds a Service around a caller-supplied transport
// (tests use a fake that records messages instead of calling Resend).
func NewServiceWithSender(cfg *config.Config, store *Store, sender Sender) (*Service, error) {
	tpls, err := parseTemplates()
	if err != nil {
		return nil, err
	}
	return &Service{cfg: cfg, store: store, sender: sender, tpls: tpls}, nil
}

// NewRenderer returns a render-only Service (nil sender, nil store).
// Render works; SendDirect / SendOnce will panic — those require a sender.
// Used by the CLI email-preview subcommand so you can inspect templates
// without a Resend key or a database.
func NewRenderer(cfg *config.Config) (*Service, error) {
	tpls, err := parseTemplates()
	if err != nil {
		return nil, err
	}
	return &Service{cfg: cfg, tpls: tpls}, nil
}

// AllTemplates returns every template name the service knows how to render.
// Stable order for deterministic CLI output.
func AllTemplates() []string {
	return []string{
		TemplateWelcome,
		TemplateTrialEndingDay33,
		TemplateTrialEndingDay35,
		TemplateQuarterlyFeedback,
		TemplateDay2Feedback,
	}
}

// renderData is the union of all fields any template reads. Unused fields
// in a given template are harmless — html/template ignores them.
type renderData struct {
	Subject    string
	FirstName  string
	AppURL     string
	DocsURL    string
	DiscordURL string
	RedditURL  string
	LogoURL    string
	// Answers are the one-tap reason links (day-2, trial-ending); empty for
	// templates without reasons.
	Answers []AnswerLink
}

// AnswerLink is one rendered reason link.
type AnswerLink struct {
	URL   string
	Label string
}

// Render produces a fully-rendered Message for the given template. Exported
// so the CLI test subcommand can render without sending.
func (s *Service) Render(templateName, to, firstName string) (Message, error) {
	return s.render(templateName, to, firstName, "preview")
}

// render is Render with the answer token used in the reason links.
func (s *Service) render(templateName, to, firstName, answerToken string) (Message, error) {
	data := s.buildData(templateName, firstName)
	for _, r := range ReasonsFor(templateName) {
		data.Answers = append(data.Answers, AnswerLink{
			URL:   data.AppURL + "/api/v1/email/answer/" + answerToken + "?r=" + r.Key,
			Label: r.Label,
		})
	}
	body, err := s.renderHTML(templateName, &data)
	if err != nil {
		return Message{}, err
	}
	msg := Message{
		To:       to,
		Subject:  data.Subject,
		HTMLBody: body,
	}
	// Welcome and the feedback asks are personal / replies encouraged;
	// marketing emails don't set Reply-To (footer directs users to hello@).
	switch templateName {
	case TemplateWelcome, TemplateQuarterlyFeedback, TemplateDay2Feedback:
		msg.ReplyTo = s.cfg.Email.ReplyTo
	}
	return msg, nil
}

// SendDirect hands a rendered Message to the transport with no dedup check,
// no sent_emails write, no dry-run gating. Used by the CLI email-test
// subcommand for visual QA against real inboxes.
func (s *Service) SendDirect(ctx context.Context, msg Message) error {
	if s == nil {
		return fmt.Errorf("email service is nil")
	}
	return s.sender.Send(ctx, msg)
}

// SendOnce renders and sends the given template to the user, recording the
// send in sent_emails so subsequent calls become no-ops. Returns nil on
// successful send OR on "already sent" — both are successful outcomes from
// the caller's perspective. Errors represent render/transport failures.
func (s *Service) SendOnce(ctx context.Context, userID, email, firstName, templateName string) error {
	return s.SendOnceKeyed(ctx, userID, email, firstName, templateName, templateName)
}

// SendOnceKeyed is SendOnce with the sent_emails dedup key decoupled from the
// template name, so recurring broadcasts can dedup per occurrence (e.g.
// quarterly_feedback_2026q3) while rendering a single template.
func (s *Service) SendOnceKeyed(ctx context.Context, userID, email, firstName, templateName, dedupKey string) error {
	if s == nil {
		return nil
	}
	alreadySent, err := s.store.HasSent(ctx, userID, dedupKey)
	if err != nil {
		return fmt.Errorf("check sent_emails: %w", err)
	}
	if alreadySent {
		return nil
	}

	token := "preview"
	if len(ReasonsFor(templateName)) > 0 {
		if token, err = s.store.CreateAnswer(ctx, userID, templateName, time.Now()); err != nil {
			return fmt.Errorf("create answer token: %w", err)
		}
	}

	msg, err := s.render(templateName, email, firstName, token)
	if err != nil {
		return fmt.Errorf("render %s: %w", templateName, err)
	}

	if s.cfg.Email.DryRun {
		log.Info().Str("template", templateName).Str("user_id", userID).
			Str("subject", msg.Subject).Msg("email: DRY RUN (not sent)")
	} else {
		if err := s.sender.Send(ctx, msg); err != nil {
			if token != "preview" {
				_ = s.store.DeleteAnswer(ctx, token)
			}
			return fmt.Errorf("send %s: %w", templateName, err)
		}
	}

	if err := s.store.MarkSent(ctx, userID, dedupKey, time.Now().UTC()); err != nil {
		// Send succeeded; log but don't fail — scheduler will see a duplicate
		// sent_emails miss next tick, but that's preferable to reporting a
		// send failure to the caller.
		log.Error().Err(err).Str("user_id", userID).Str("template", dedupKey).
			Msg("email: failed to record sent_emails row after successful send")
	}
	return nil
}

func (s *Service) buildData(templateName, firstName string) renderData {
	data := renderData{
		FirstName:  firstName,
		AppURL:     strings.TrimRight(s.cfg.Email.AppURL, "/"),
		DocsURL:    "https://budgero.app/docs",
		DiscordURL: "https://discord.gg/ZgWnzaPqae",
		RedditURL:  "https://reddit.com/r/budgero",
		LogoURL:    "https://budgero.app/logo_144.png",
	}
	if data.AppURL == "" {
		data.AppURL = "https://my.budgero.app"
	}
	switch templateName {
	case TemplateWelcome:
		data.Subject = "Welcome to Budgero"
	case TemplateTrialEndingDay33:
		data.Subject = "2 days left in your Budgero trial"
	case TemplateTrialEndingDay35:
		data.Subject = "Your Budgero trial ends today"
	case TemplateQuarterlyFeedback:
		data.Subject = "How's Budgero working for you?"
	case TemplateDay2Feedback:
		data.Subject = "A quick question from Budgero's developer"
	default:
		data.Subject = "Budgero"
	}
	return data
}

func (s *Service) renderHTML(name string, data *renderData) (string, error) {
	tpl, ok := s.tpls[name]
	if !ok {
		return "", fmt.Errorf("unknown template %q", name)
	}
	var buf bytes.Buffer
	if err := tpl.ExecuteTemplate(&buf, "layout", data); err != nil {
		return "", err
	}
	return buf.String(), nil
}

func parseTemplates() (map[string]*template.Template, error) {
	layout, err := templatesFS.ReadFile("templates/layout.html")
	if err != nil {
		return nil, fmt.Errorf("read layout.html: %w", err)
	}

	templates := map[string]string{
		TemplateWelcome:           "templates/welcome.html",
		TemplateTrialEndingDay33:  "templates/trial_ending_day33.html",
		TemplateTrialEndingDay35:  "templates/trial_ending_day35.html",
		TemplateQuarterlyFeedback: "templates/quarterly_feedback.html",
		TemplateDay2Feedback:      "templates/day2_feedback.html",
	}

	out := make(map[string]*template.Template, len(templates))
	for name, path := range templates {
		body, err := templatesFS.ReadFile(path)
		if err != nil {
			return nil, fmt.Errorf("read %s: %w", path, err)
		}
		tpl := template.New(name)
		if _, err := tpl.Parse(string(layout)); err != nil {
			return nil, fmt.Errorf("parse layout for %s: %w", name, err)
		}
		if _, err := tpl.Parse(string(body)); err != nil {
			return nil, fmt.Errorf("parse %s: %w", name, err)
		}
		out[name] = tpl
	}
	return out, nil
}

// ---- Resend transport ----

type resendSender struct {
	client *resend.Client
	from   string
}

func newResendSender(cfg *config.Config) (*resendSender, error) {
	if cfg.Email.ResendAPIKey == "" {
		return nil, errors.New("RESEND_API_KEY is empty")
	}
	return &resendSender{
		client: resend.NewClient(cfg.Email.ResendAPIKey),
		from:   cfg.Email.FromAddress,
	}, nil
}

func (r *resendSender) Send(ctx context.Context, msg Message) error {
	params := &resend.SendEmailRequest{
		From:    r.from,
		To:      []string{msg.To},
		Subject: msg.Subject,
		Html:    msg.HTMLBody,
	}
	if msg.ReplyTo != "" {
		params.ReplyTo = msg.ReplyTo
	}
	resp, err := r.client.Emails.SendWithContext(ctx, params)
	if err != nil {
		return err
	}
	log.Info().Str("resend_id", resp.Id).
		Str("subject", msg.Subject).Msg("email: sent")
	return nil
}
