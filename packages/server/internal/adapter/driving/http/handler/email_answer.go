package handler

import (
	"errors"
	"html/template"
	"net/http"
	"strings"
	"time"

	"budgero-server/internal/application/email"

	"github.com/labstack/echo/v4"
	"github.com/rs/zerolog/log"
)

// Email answer page: the one-tap reason links in the day-2 and trial-ending
// emails land here. No login; the random token in the path is the credential.
//
// GET only shows the page and never records anything, because mail scanners
// (Outlook Safe Links, corporate gateways) fetch every link in an email. A
// tiny inline script submits the form, so the answer is saved only when a
// real browser opens the page; without JS the visitor gets a Confirm button.

type emailAnswerPage struct {
	State    string // pick | confirm | thanks | noted | gone
	Token    string
	Reason   string
	Label    string
	Reasons  []email.Reason
	HasNote  bool
	Template string
}

var emailAnswerTpl = template.Must(template.New("answer").Parse(`<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Budgero</title>
<style>
:root { --bg:#fbf7eb; --card:#fffdf8; --ink:#141414; --muted:#64748b; --line:#9e9e9e; --accent:#111c34; --on-accent:#f8fafc; }
@media (prefers-color-scheme: dark) { :root { --bg:#10141d; --card:#161b26; --ink:#e8e6df; --muted:#94a3b8; --line:#475569; --accent:#e8e6df; --on-accent:#10141d; } }
* { box-sizing:border-box; }
body { margin:0; background:var(--bg); color:var(--ink); font:15px/1.6 "IBM Plex Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace; }
main { max-width:520px; margin:0 auto; padding:40px 16px; }
.card { background:var(--card); border:1px dashed var(--line); padding:28px 22px; }
.brand { font-size:11px; letter-spacing:2.2px; text-transform:uppercase; color:var(--muted); margin:0 0 18px; }
h1 { font-size:22px; line-height:1.3; margin:0 0 10px; }
p { margin:0 0 14px; }
.muted { color:var(--muted); font-size:13px; }
button, .opt { display:block; width:100%; text-align:left; font:inherit; font-weight:500; padding:12px 16px; margin:0 0 8px;
  border:1px solid var(--accent); background:transparent; color:var(--ink); cursor:pointer; text-decoration:none; }
button.primary { background:var(--accent); color:var(--on-accent); text-align:center; }
textarea { width:100%; min-height:110px; font:inherit; padding:10px; border:1px solid var(--line); background:var(--bg); color:var(--ink); margin:0 0 10px; }
a { color:inherit; }
</style></head>
<body><main><div class="card">
<p class="brand">Budgero</p>
{{if eq .State "gone"}}
  <h1>This link has expired.</h1>
  <p>Answer links work for 60 days. You can still tell me anything at
  <a href="mailto:hello@budgero.app">hello@budgero.app</a>.</p>
{{else if eq .State "confirm"}}
  <h1>Saving your answer…</h1>
  <form id="f" method="post"><input type="hidden" name="r" value="{{.Reason}}">
    <noscript><p>&ldquo;{{.Label}}&rdquo;</p><button class="primary" type="submit">Confirm</button></noscript>
  </form>
  <script>document.getElementById("f").submit();</script>
{{else if eq .State "pick"}}
  <h1>What fits best?</h1>
  <form method="post">
  {{range .Reasons}}<button type="submit" name="r" value="{{.Key}}">{{.Label}}</button>{{end}}
  </form>
{{else}}
  {{if eq .State "noted"}}
    <h1>Thank you, I'll read it.</h1>
    <p>I answer when there's something to answer. If you want a reply, write to
    <a href="mailto:hello@budgero.app">hello@budgero.app</a>.</p>
  {{else}}
    <h1>Thanks, got it.</h1>
    <p>Your answer: <strong>{{.Label}}</strong></p>
    {{if not .HasNote}}
    <form method="post">
      <p>Anything else? One sentence helps a lot. (Optional)</p>
      <textarea name="note" maxlength="1000" placeholder="e.g. which bank, which feature, what felt confusing"></textarea>
      <button class="primary" type="submit">Send</button>
    </form>
    {{end}}
  {{end}}
  <p class="muted"><a href="?change=1">Change my answer</a> · <a href="https://my.budgero.app">Open Budgero</a></p>
{{end}}
</div></main></body></html>`))

func (h *Handlers) renderEmailAnswer(c echo.Context, status int, page *emailAnswerPage) error {
	c.Response().Header().Set("Cache-Control", "no-store")
	c.Response().Header().Set("Referrer-Policy", "no-referrer")
	c.Response().Header().Set(echo.HeaderContentType, echo.MIMETextHTMLCharsetUTF8)
	c.Response().WriteHeader(status)
	return emailAnswerTpl.Execute(c.Response(), page)
}

func (h *Handlers) emailAnswerStore() *email.Store {
	if h.email == nil {
		return nil
	}
	return h.email.Store()
}

// GetEmailAnswer shows the answer page. It never writes.
func (h *Handlers) GetEmailAnswer(c echo.Context) error {
	store := h.emailAnswerStore()
	if store == nil {
		return echo.NewHTTPError(http.StatusNotFound)
	}
	token := c.Param("token")
	a, err := store.LookupAnswer(c.Request().Context(), token, time.Now())
	if err != nil {
		return h.emailAnswerError(c, err)
	}
	page := emailAnswerPage{Token: token, Template: a.Template, Reasons: email.ReasonsFor(a.Template)}
	r := c.QueryParam("r")
	label, ok := email.ReasonLabel(a.Template, r)
	switch {
	case c.QueryParam("change") == "" && a.Reason != "" && (r == "" || r == a.Reason):
		page.State, page.Reason, page.HasNote = "thanks", a.Reason, a.Note != ""
		page.Label, _ = email.ReasonLabel(a.Template, a.Reason)
	case ok:
		page.State, page.Reason, page.Label = "confirm", r, label
	default:
		page.State = "pick"
	}
	return h.renderEmailAnswer(c, http.StatusOK, &page)
}

// PostEmailAnswer records a reason (form field r) and/or a note.
func (h *Handlers) PostEmailAnswer(c echo.Context) error {
	store := h.emailAnswerStore()
	if store == nil {
		return echo.NewHTTPError(http.StatusNotFound)
	}
	token := c.Param("token")
	reason := strings.TrimSpace(c.FormValue("r"))
	note := c.FormValue("note")
	a, err := store.RecordAnswer(c.Request().Context(), token, reason, note, time.Now())
	if err != nil {
		if errors.Is(err, email.ErrAnswerReason) {
			return echo.NewHTTPError(http.StatusBadRequest, "unknown reason")
		}
		return h.emailAnswerError(c, err)
	}
	page := emailAnswerPage{Token: token, Template: a.Template, Reason: a.Reason, HasNote: a.Note != "", State: "thanks"}
	page.Label, _ = email.ReasonLabel(a.Template, a.Reason)
	if strings.TrimSpace(note) != "" {
		page.State = "noted"
	} else if a.Reason == "" {
		page.State, page.Reasons = "pick", email.ReasonsFor(a.Template)
	}
	return h.renderEmailAnswer(c, http.StatusOK, &page)
}

func (h *Handlers) emailAnswerError(c echo.Context, err error) error {
	if errors.Is(err, email.ErrAnswerNotFound) || errors.Is(err, email.ErrAnswerExpired) {
		return h.renderEmailAnswer(c, http.StatusNotFound, &emailAnswerPage{State: "gone"})
	}
	log.Error().Err(err).Msg("email answer: lookup failed")
	return echo.NewHTTPError(http.StatusInternalServerError)
}
