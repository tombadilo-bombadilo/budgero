package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"budgero-server/cmd/shared"
	"budgero-server/internal/application/email"
	"budgero-server/internal/config"

	"github.com/joho/godotenv"
)

func main() {
	// Minimal subcommand router. Default (no args) starts the server.
	//   email-preview — render all templates to HTML files for browser preview
	//                   (no Resend key, no DB required)
	//   email-test    — render + send one template to a real address, or
	//                   --dry-run to print the HTML to stdout
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "email-preview":
			if err := runEmailPreview(os.Args[2:]); err != nil {
				fmt.Fprintln(os.Stderr, "email-preview failed:", err)
				os.Exit(1)
			}
			return
		case "email-test":
			if err := runEmailTest(os.Args[2:]); err != nil {
				fmt.Fprintln(os.Stderr, "email-test failed:", err)
				os.Exit(1)
			}
			return
		}
	}
	shared.Run(false)
}

// runEmailPreview renders every template to HTML files in --dir so you can
// open them in a browser. Does not call Resend and does not require a
// RESEND_API_KEY. Ideal for iterating on copy + design.
func runEmailPreview(args []string) error {
	fs := flag.NewFlagSet("email-preview", flag.ExitOnError)
	dir := fs.String("dir", "./email-preview", "output directory")
	firstName := fs.String("first-name", "Alex", "first name used in greeting")
	if err := fs.Parse(args); err != nil {
		return err
	}

	_ = godotenv.Load()
	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("load config: %w", err)
	}

	svc, err := email.NewRenderer(cfg)
	if err != nil {
		return err
	}

	if err := os.MkdirAll(*dir, 0o750); err != nil {
		return fmt.Errorf("mkdir %s: %w", *dir, err)
	}

	abs, _ := filepath.Abs(*dir)
	for _, tpl := range email.AllTemplates() {
		msg, err := svc.Render(tpl, "preview@example.com", *firstName)
		if err != nil {
			return fmt.Errorf("render %s: %w", tpl, err)
		}
		path := filepath.Join(*dir, tpl+".html")
		if err := os.WriteFile(path, []byte(msg.HTMLBody), 0o644); err != nil { //nolint:gosec // local dev output
			return fmt.Errorf("write %s: %w", path, err)
		}
		fmt.Printf("  %s  %s\n", tpl, filepath.Join(abs, tpl+".html"))
	}
	fmt.Fprintln(os.Stderr, "\nOpen the files above in your browser. Re-run after edits.")
	return nil
}

// runEmailTest renders one template and either prints HTML (--dry-run / --out)
// or sends it via Resend to --to. Sending requires RESEND_API_KEY;
// dry-run/--out do not.
func runEmailTest(args []string) error {
	fs := flag.NewFlagSet("email-test", flag.ExitOnError)
	tpl := fs.String("template", email.TemplateWelcome, "welcome | inactivity | trial_ended")
	to := fs.String("to", "", "recipient address (required for real send)")
	firstName := fs.String("first-name", "Alex", "first name used in greeting")
	dryRun := fs.Bool("dry-run", false, "print HTML to stdout instead of sending")
	out := fs.String("out", "", "write HTML to this file instead of sending")
	if err := fs.Parse(args); err != nil {
		return err
	}

	_ = godotenv.Load()
	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("load config: %w", err)
	}

	// Render-only paths (dry-run / --out) work without a Resend key.
	renderOnly := *dryRun || *out != ""
	var svc *email.Service
	if renderOnly {
		svc, err = email.NewRenderer(cfg)
	} else {
		if *to == "" {
			return fmt.Errorf("--to is required when sending; pass --dry-run or --out to skip the send")
		}
		if !cfg.HasEmail() {
			return fmt.Errorf("email disabled: set RESEND_API_KEY and EMAIL_ENABLED=true")
		}
		svc, err = email.NewService(cfg, nil) // nil store — bypass dedup
	}
	if err != nil {
		return err
	}

	renderTo := *to
	if renderTo == "" {
		renderTo = "preview@example.com"
	}
	msg, err := svc.Render(*tpl, renderTo, *firstName)
	if err != nil {
		return fmt.Errorf("render: %w", err)
	}

	if *out != "" {
		if err := os.WriteFile(*out, []byte(msg.HTMLBody), 0o644); err != nil { //nolint:gosec // local dev output
			return fmt.Errorf("write %s: %w", *out, err)
		}
		fmt.Fprintf(os.Stderr, "wrote %s  (subject: %s)\n", *out, msg.Subject)
		return nil
	}
	if *dryRun {
		fmt.Fprintf(os.Stderr, "Subject: %s\nTo: %s\n\n", msg.Subject, msg.To)
		fmt.Println(msg.HTMLBody)
		return nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := svc.SendDirect(ctx, msg); err != nil {
		return fmt.Errorf("send: %w", err)
	}
	fmt.Fprintln(os.Stderr, "sent ✓")
	return nil
}
