package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"text/tabwriter"
	"time"

	shared "budgero-server/cmd/shared"
	"budgero-server/internal/adapter/driven/sqlite"
	"budgero-server/internal/application"
	"budgero-server/internal/config"
	"budgero-server/internal/domain"

	"github.com/mattn/go-isatty"
	"github.com/spf13/cobra"
)

var version = "dev"

const osWindows = "windows"

const releaseBucketHost = "https://storage.googleapis.com/budgero_releases"

func main() {
	// The whole binary is self-host: every subcommand must resolve the
	// self-host database path, not just `serve` (which sets this again in
	// shared.Run). Without it, admin commands silently open and migrate an
	// empty data/budgero.db next to the server's data/budgero_self_host.db.
	_ = os.Setenv("SELF_HOSTABLE", "true")
	cobra.CheckErr(newRootCmd().Execute())
}

func newRootCmd() *cobra.Command {
	rootCmd := &cobra.Command{
		Use:   "budgero",
		Short: "Budgero self-host server and admin CLI",
		// CheckErr in main prints the returned error; without SilenceErrors
		// cobra prints it too and every failure shows up twice.
		SilenceErrors: true,
		SilenceUsage:  true,
		RunE: func(cmd *cobra.Command, args []string) error {
			return cmd.Help()
		},
	}

	rootCmd.Version = version
	rootCmd.SetVersionTemplate("{{printf \"budgero %s\\n\" .Version}}")

	rootCmd.AddCommand(newServeCmd())
	rootCmd.AddCommand(newAdminCmd())
	rootCmd.AddCommand(newUninstallCmd())
	rootCmd.AddCommand(newUpdateCmd())
	rootCmd.AddCommand(newDaemonCmd())
	return rootCmd
}

func newUpdateCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "update",
		Short: "Download and install the latest Budgero release",
		RunE: func(cmd *cobra.Command, args []string) error {
			return runUpdate()
		},
	}
}

func newUninstallCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "uninstall",
		Short: "Remove the installed Budgero binary",
		RunE: func(cmd *cobra.Command, args []string) error {
			return runUninstall()
		},
	}
}

func newServeCmd() *cobra.Command {
	envOpts := runtimeEnvOptions{}
	serveCmd := &cobra.Command{
		Use:   "serve",
		Short: "Run the self-hosted Budgero server in the foreground",
		RunE: func(cmd *cobra.Command, args []string) error {
			if envOpts.port < 0 {
				return fmt.Errorf("port must be positive when provided")
			}
			if err := envOpts.applyProcessEnv(); err != nil {
				return err
			}
			shared.Run(true)
			return nil
		},
	}
	bindRuntimeEnvFlags(serveCmd, &envOpts, true, "Port to run the server on (overrides PORT env; defaults to existing value or 3001)")
	return serveCmd
}

func newAdminCmd() *cobra.Command {
	adminCmd := &cobra.Command{
		Use:   "admin",
		Short: "Manage local accounts for self-host deployments",
	}

	var (
		createUsername string
		createName     string
		createPassword string
		createAdmin    bool
	)
	createCmd := &cobra.Command{
		Use:   "create-user",
		Short: "Create or promote a local user (with optional admin access)",
		RunE: func(cmd *cobra.Command, args []string) error {
			return adminCreateUser(createUsername, createName, createPassword, createAdmin)
		},
	}
	createCmd.Flags().StringVar(&createUsername, "username", "", "Username")
	createCmd.Flags().StringVar(&createName, "name", "", "Display name")
	createCmd.Flags().StringVar(&createPassword, "password", "", "Password (min 8 chars)")
	createCmd.Flags().BoolVar(&createAdmin, "admin", true, "Grant admin access")
	_ = createCmd.MarkFlagRequired("username")
	_ = createCmd.MarkFlagRequired("password")

	var (
		resetUsername string
		resetPassword string
	)
	resetCmd := &cobra.Command{
		Use:   "reset-password",
		Short: "Reset the password for an existing local user",
		RunE: func(cmd *cobra.Command, args []string) error {
			return adminResetPassword(resetUsername, resetPassword)
		},
	}
	resetCmd.Flags().StringVar(&resetUsername, "username", "", "Username")
	resetCmd.Flags().StringVar(&resetPassword, "password", "", "New password (min 8 chars)")
	_ = resetCmd.MarkFlagRequired("username")
	_ = resetCmd.MarkFlagRequired("password")

	listCmd := &cobra.Command{
		Use:   "list-users",
		Short: "List users and their status",
		RunE: func(cmd *cobra.Command, args []string) error {
			return adminListUsers()
		},
	}

	var (
		setAdminUsername string
		enableAdmin      bool
	)
	setAdminCmd := &cobra.Command{
		Use:   "set-admin",
		Short: "Enable or disable admin access for a user",
		RunE: func(cmd *cobra.Command, args []string) error {
			return adminSetAdmin(setAdminUsername, enableAdmin)
		},
	}
	setAdminCmd.Flags().StringVar(&setAdminUsername, "username", "", "Username")
	setAdminCmd.Flags().BoolVar(&enableAdmin, "enable", true, "Grant admin access (use --enable=false to revoke)")
	_ = setAdminCmd.MarkFlagRequired("username")

	var deleteUsername string
	deleteCmd := &cobra.Command{
		Use:   "delete-user",
		Short: "Delete a user and their owned data",
		RunE: func(cmd *cobra.Command, args []string) error {
			return adminDeleteUser(deleteUsername)
		},
	}
	deleteCmd.Flags().StringVar(&deleteUsername, "username", "", "Username")
	_ = deleteCmd.MarkFlagRequired("username")

	var resetDataUsername string
	resetDataCmd := &cobra.Command{
		Use:   "reset-master",
		Short: "Reset master password state and encrypted data",
		RunE: func(cmd *cobra.Command, args []string) error {
			return adminResetMaster(resetDataUsername)
		},
	}
	resetDataCmd.Flags().StringVar(&resetDataUsername, "username", "", "Username")
	_ = resetDataCmd.MarkFlagRequired("username")

	var blockUsername string
	blockCmd := &cobra.Command{
		Use:   "block-user",
		Short: "Block a user from logging in",
		RunE: func(cmd *cobra.Command, args []string) error {
			return adminBlockUser(blockUsername, true)
		},
	}
	blockCmd.Flags().StringVar(&blockUsername, "username", "", "Username")
	_ = blockCmd.MarkFlagRequired("username")

	unblockCmd := &cobra.Command{
		Use:   "unblock-user",
		Short: "Remove a block from a user",
		RunE: func(cmd *cobra.Command, args []string) error {
			return adminBlockUser(blockUsername, false)
		},
	}
	unblockCmd.Flags().StringVar(&blockUsername, "username", "", "Username")
	_ = unblockCmd.MarkFlagRequired("username")

	adminCmd.AddCommand(createCmd, resetCmd, listCmd, setAdminCmd, deleteCmd, resetDataCmd, blockCmd, unblockCmd)
	return adminCmd
}

func runUninstall() error {
	exe, err := os.Executable()
	if err != nil {
		return fmt.Errorf("unable to determine current executable: %w", err)
	}
	if exe == "" {
		return fmt.Errorf("unable to determine installation path; remove budgero manually")
	}
	targetExe, err := filepath.EvalSymlinks(exe)
	if err != nil || targetExe == "" {
		targetExe = exe
	}

	if runtime.GOOS == osWindows && os.Getenv("BUDGERO_UNINSTALL_HELPER") != "1" {
		helper := targetExe + ".uninstall.exe"
		if err := copyFile(targetExe, helper); err != nil {
			return fmt.Errorf("failed to stage uninstall helper: %w", err)
		}
		cmd := exec.Command(helper, "uninstall") //nolint:gosec // G204: helper is a temp file path we control
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		cmd.Env = append(os.Environ(),
			"BUDGERO_UNINSTALL_HELPER=1",
			fmt.Sprintf("BUDGERO_UNINSTALL_TARGET=%s", targetExe),
		)
		if err := cmd.Start(); err != nil {
			return fmt.Errorf("failed to launch uninstall helper: %w", err)
		}
		fmt.Println("Uninstall helper started; Budgero will exit so it can finish removal.")
		return nil
	}

	if runtime.GOOS == osWindows {
		if override := strings.TrimSpace(os.Getenv("BUDGERO_UNINSTALL_TARGET")); override != "" {
			targetExe = override
		}
		fmt.Printf("Removing Budgero binary at %s...\n", targetExe)
		if err := removeFileWithRetries(targetExe, 40, 250*time.Millisecond); err != nil {
			return err
		}
		fmt.Println("Budgero has been uninstalled.")
		fmt.Println("Your data files remain untouched. Remove them manually if desired.")
		scheduleWindowsSelfDelete()
		return nil
	}

	fmt.Printf("Removing Budgero binary at %s...\n", targetExe)
	if err := os.Remove(targetExe); err != nil {
		return fmt.Errorf("failed to remove %s: %w", targetExe, err)
	}
	fmt.Println("Budgero has been uninstalled.")
	fmt.Println("Your data files remain untouched. Remove them manually if desired.")
	return nil
}

func runUpdate() error {
	targetExe, err := os.Executable()
	if err != nil {
		return fmt.Errorf("unable to determine install path: %w", err)
	}
	targetExe, err = filepath.EvalSymlinks(targetExe)
	if err != nil {
		return fmt.Errorf("unable to resolve install path: %w", err)
	}

	isUpdateHelper := runtime.GOOS == osWindows && os.Getenv("BUDGERO_UPDATE_HELPER") == "1"
	helperExecutable := ""
	if isUpdateHelper {
		helperPath, helperErr := os.Executable()
		if helperErr == nil {
			helperExecutable = helperPath
		}
	}

	if runtime.GOOS == osWindows && !isUpdateHelper {
		helper := targetExe + ".update.exe"
		if err = copyFile(targetExe, helper); err != nil {
			return fmt.Errorf("failed to stage helper binary: %w", err)
		}
		cmd := exec.Command(helper, "update") //nolint:gosec // G204: helper is a temp file path we control
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		cmd.Env = append(os.Environ(), "BUDGERO_UPDATE_HELPER=1", fmt.Sprintf("BUDGERO_UPDATE_TARGET=%s", targetExe))
		if err = cmd.Start(); err != nil {
			return fmt.Errorf("failed to launch update helper: %w", err)
		}
		fmt.Println("Update helper started; Budgero will exit so it can replace the binary.")
		return nil
	}

	if runtime.GOOS == osWindows {
		if override := strings.TrimSpace(os.Getenv("BUDGERO_UPDATE_TARGET")); override != "" {
			targetExe = override
		}
	}

	current := normalizeVersion(version)
	if current == "" {
		current = "dev"
	}
	fmt.Printf("Current version: %s\n", current)
	latest, err := fetchLatestVersion()
	if err != nil {
		return fmt.Errorf("failed to determine latest version: %w", err)
	}
	fmt.Printf("Latest release: %s\n", latest)
	if latest == current {
		fmt.Println("Already up to date.")
		return nil
	}

	if stopErr := ensureServerStopped(targetExe); stopErr != nil {
		return stopErr
	}

	artifactURL, err := resolveArtifactURL(latest)
	if err != nil {
		return err
	}
	fmt.Printf("Downloading %s...\n", artifactURL)
	tmp, err := os.CreateTemp("", "budgero-update-*")
	if err != nil {
		return fmt.Errorf("failed to create temp file: %w", err)
	}
	tmpPath := tmp.Name()
	defer func() {
		if err := os.Remove(tmpPath); err != nil && !os.IsNotExist(err) {
			fmt.Fprintf(os.Stderr, "warning: failed to remove temp file: %v\n", err)
		}
	}()
	if err := downloadTo(tmp, artifactURL); err != nil {
		return err
	}
	if err := tmp.Chmod(0o755); err != nil {
		return fmt.Errorf("failed to mark binary executable: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return err
	}

	if runtime.GOOS == osWindows {
		if err := removeFileWithRetries(targetExe, 40, 250*time.Millisecond); err != nil {
			return fmt.Errorf("failed to remove existing binary: %w", err)
		}
	}

	// targetExe is derived from os.Executable() / explicit self-update flags;
	// tmpPath is a tempfile we just wrote. Neither is user-controlled at runtime.
	if err := os.Rename(tmpPath, targetExe); err != nil { //nolint:gosec // G304/G703: self-updater intentionally overwrites its own binary
		return fmt.Errorf("failed to replace %s: %w", targetExe, err)
	}
	fmt.Printf("Budgero updated to %s. Restart the server to apply the new version.\n", latest)
	if isUpdateHelper && helperExecutable != "" {
		scheduleWindowsSelfDeletePath(helperExecutable)
	}
	return nil
}

func ensureServerStopped(target string) error {
	running, err := isBinaryRunning(target)
	if err != nil {
		return err
	}
	if running {
		return fmt.Errorf("budgero server appears to be running; stop it before updating")
	}
	return nil
}

func isBinaryRunning(exe string) (bool, error) {
	if runtime.GOOS == osWindows {
		return isBinaryRunningWindows(exe)
	}
	return isBinaryRunningPosix(exe)
}

func isBinaryRunningPosix(exe string) (bool, error) {
	cmd := exec.Command("ps", "-eo", "pid=,args=")
	out, err := cmd.Output()
	if err != nil {
		return false, fmt.Errorf("failed to inspect running processes (ps): %w", err)
	}
	self := os.Getpid()
	lines := strings.Split(string(out), "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		pidStr := fields[0]
		pid, err := strconv.Atoi(pidStr)
		if err != nil {
			continue
		}
		if pid == self {
			continue
		}
		if strings.Contains(line, exe) {
			return true, nil
		}
	}
	return false, nil
}

func isBinaryRunningWindows(exe string) (bool, error) {
	base := strings.ToLower(filepath.Base(exe))
	self := os.Getpid()
	cmd := exec.Command("wmic", "process", "where", fmt.Sprintf("name='%s'", base), "get", "ProcessId,ExecutablePath", "/format:csv") //nolint:gosec // G204: wmic args are derived from validated exe path
	out, err := cmd.Output()
	if err == nil {
		lines := strings.Split(string(out), "\n")
		for _, line := range lines {
			line = strings.TrimSpace(line)
			if line == "" || strings.HasPrefix(line, "Node") {
				continue
			}
			parts := strings.Split(line, ",")
			if len(parts) < 3 {
				continue
			}
			pidStr := strings.TrimSpace(parts[1])
			exePath := strings.TrimSpace(parts[2])
			if exePath == "" {
				continue
			}
			pid, _ := strconv.Atoi(pidStr)
			if pid == self {
				continue
			}
			if strings.EqualFold(filepath.Clean(exePath), filepath.Clean(exe)) {
				return true, nil
			}
		}
		return false, nil
	}

	cmd = exec.Command("tasklist", "/FI", fmt.Sprintf("IMAGENAME eq %s", base), "/FO", "CSV", "/NH") //nolint:gosec // G204: tasklist args derived from validated exe path
	out, err = cmd.Output()
	if err != nil {
		return false, fmt.Errorf("failed to inspect running processes (tasklist): %w", err)
	}
	trimmed := strings.TrimSpace(string(out))
	if trimmed == "" || strings.HasPrefix(trimmed, "INFO:") {
		return false, nil
	}
	r := csv.NewReader(bytes.NewReader(out))
	for {
		rec, err := r.Read()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return false, fmt.Errorf("failed to parse process list: %w", err)
		}
		if len(rec) < 2 {
			continue
		}
		pid, err := strconv.Atoi(strings.TrimSpace(rec[1]))
		if err != nil || pid == self {
			continue
		}
		return true, nil
	}
	return false, nil
}

func fetchLatestVersion() (string, error) {
	resp, err := http.Get(releaseBucketHost + "/latest.txt")
	if err != nil {
		return "", err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("unexpected status %s when fetching latest version", resp.Status)
	}
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	latest := normalizeVersion(strings.TrimSpace(string(data)))
	if latest == "" {
		return "", fmt.Errorf("latest version pointer was empty")
	}
	return latest, nil
}

func downloadTo(dst *os.File, url string) error {
	resp, err := http.Get(url) //nolint:gosec // G107: URL is constructed from trusted release server base URL
	if err != nil {
		return fmt.Errorf("failed to download %s: %w", url, err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("download %s returned %s", url, resp.Status)
	}
	var reader io.Reader = resp.Body
	var progress *downloadProgress
	if isatty.IsTerminal(os.Stdout.Fd()) || isatty.IsCygwinTerminal(os.Stdout.Fd()) {
		progress = newDownloadProgress(resp.ContentLength)
		reader = io.TeeReader(resp.Body, progress)
	}
	if _, err := io.Copy(dst, reader); err != nil {
		return fmt.Errorf("failed to write download: %w", err)
	}
	if progress != nil {
		progress.finish()
	}
	return nil
}

func resolveArtifactURL(ver string) (string, error) {
	osName := runtime.GOOS
	arch := runtime.GOARCH
	switch arch {
	case "amd64", "arm64":
	default:
		return "", fmt.Errorf("unsupported architecture %s", arch)
	}
	base := fmt.Sprintf("budgero_%s_%s", osName, arch)
	ext := ""
	if osName == osWindows {
		ext = ".exe"
	}
	suffixes := []string{""}
	if arch == "amd64" {
		suffixes = append(suffixes, "_v1")
	} else {
		suffixes = append(suffixes, "_v8.0")
	}
	client := &http.Client{Timeout: 2 * time.Second}
	for _, suffix := range suffixes {
		path := fmt.Sprintf("%s/%s/%s%s/budgero%s", releaseBucketHost, ver, base, suffix, ext)
		req, err := http.NewRequest(http.MethodHead, path, http.NoBody)
		if err != nil {
			return "", err
		}
		resp, err := client.Do(req)
		if err == nil && resp.StatusCode == http.StatusOK {
			_ = resp.Body.Close()
			return path, nil
		}
		if resp != nil {
			_ = resp.Body.Close()
		}
	}
	return "", fmt.Errorf("no release artifact found for %s/%s", osName, arch)
}

func normalizeVersion(v string) string {
	v = strings.TrimSpace(v)
	if v == "" {
		return ""
	}
	if strings.HasPrefix(v, "v") {
		return v
	}
	return "v" + v
}

func copyFile(src, dst string) error {
	in, err := os.Open(src) //nolint:gosec // G304: src is internal path from update logic
	if err != nil {
		return err
	}
	defer func() { _ = in.Close() }()
	out, err := os.Create(dst) //nolint:gosec // G304: dst is internal path from update logic
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		_ = out.Close()
		return err
	}
	if err := out.Close(); err != nil {
		return err
	}
	if info, err := os.Stat(src); err == nil {
		_ = os.Chmod(dst, info.Mode())
	}
	return nil
}

func removeFileWithRetries(path string, attempts int, delay time.Duration) error {
	for i := 0; i < attempts; i++ {
		// path is an internal self-updater target (current executable or tempfile),
		// never a user-supplied value.
		err := os.Remove(path) //nolint:gosec // G304/G703: self-updater internal path
		if err == nil || os.IsNotExist(err) {
			return nil
		}
		if runtime.GOOS != osWindows {
			return err
		}
		time.Sleep(delay)
	}
	return fmt.Errorf("failed to remove %s; ensure no processes are using this file and try again", path)
}

func scheduleWindowsSelfDelete() {
	scheduleWindowsSelfDeletePath(currentExecutable())
}

func scheduleWindowsSelfDeletePath(path string) {
	if runtime.GOOS != osWindows || strings.TrimSpace(path) == "" {
		return
	}
	cmd := exec.Command("cmd", "/C", fmt.Sprintf("ping 127.0.0.1 -n 3 > NUL && del /f /q %q", path)) //nolint:gosec // G204: path is current executable from os.Executable()
	cmd.Stdout = nil
	cmd.Stderr = nil
	_ = cmd.Start()
}

func currentExecutable() string {
	path, err := os.Executable()
	if err != nil {
		return ""
	}
	return path
}

type downloadProgress struct {
	total      int64
	downloaded int64
	lastPrint  time.Time
}

func newDownloadProgress(total int64) *downloadProgress {
	return &downloadProgress{total: total, lastPrint: time.Now()}
}

func (p *downloadProgress) Write(b []byte) (int, error) {
	n := len(b)
	p.downloaded += int64(n)
	if time.Since(p.lastPrint) >= 200*time.Millisecond {
		p.print()
	}
	return n, nil
}

func (p *downloadProgress) finish() {
	p.print()
	fmt.Print("\n")
}

func (p *downloadProgress) print() {
	p.lastPrint = time.Now()
	if p.total > 0 {
		percent := float64(p.downloaded) / float64(p.total) * 100
		fmt.Printf("\rDownloading... %3.0f%% (%s / %s)", percent, formatBytes(p.downloaded), formatBytes(p.total))
	} else {
		fmt.Printf("\rDownloading... %s", formatBytes(p.downloaded))
	}
}

func formatBytes(n int64) string {
	const unit = 1024
	if n < unit {
		return fmt.Sprintf("%d B", n)
	}
	div, exp := int64(unit), 0
	for m := n / unit; m >= unit; m /= unit {
		div *= unit
		exp++
	}
	prefix := []string{"KB", "MB", "GB", "TB", "PB"}
	if exp >= len(prefix) {
		exp = len(prefix) - 1
	}
	return fmt.Sprintf("%.1f %s", float64(n)/float64(div), prefix[exp])
}

// openServices opens the database and creates services for CLI admin commands.
func openServices() (*sql.DB, *application.Services, error) {
	dbConn, err := sqlite.Open()
	if err != nil {
		return nil, nil, fmt.Errorf("failed to open user database: %w", err)
	}
	cfg, err := config.Load()
	if err != nil {
		if cerr := sqlite.Close(dbConn); cerr != nil {
			fmt.Fprintf(os.Stderr, "warning: failed to close database: %v\n", cerr)
		}
		return nil, nil, fmt.Errorf("failed to load config: %w", err)
	}
	return dbConn, shared.WireServices(dbConn, cfg, true), nil
}

// withAdminServices opens the admin services, runs fn, and ensures the
// database is closed afterwards.
func withAdminServices(fn func(context.Context, *application.Services) error) error {
	dbConn, services, err := openServices()
	if err != nil {
		return err
	}
	defer func() {
		if closeErr := sqlite.Close(dbConn); closeErr != nil {
			fmt.Fprintf(os.Stderr, "warning: failed to close database: %v\n", closeErr)
		}
	}()
	return fn(context.Background(), services)
}

func adminCreateUser(username, name, password string, isAdmin bool) error {
	username = strings.TrimSpace(strings.ToLower(username))
	if username == "" || len(strings.TrimSpace(password)) < 8 {
		return fmt.Errorf("username and password (min 8 chars) are required")
	}

	return withAdminServices(func(ctx context.Context, services *application.Services) error {
		user, err := services.User.GetByEmail(ctx, username)
		if err == nil {
			if upsertErr := services.Credential.SetPassword(ctx, user.ID, password, isAdmin); upsertErr != nil {
				return fmt.Errorf("failed to update credentials: %w", upsertErr)
			}
			fmt.Printf("Updated password for existing user %s (%s)\n", user.Name, user.Email)
			return nil
		}
		if !errors.Is(err, domain.ErrUserNotFound) {
			return fmt.Errorf("failed to lookup existing user: %w", err)
		}

		createLocalUser := application.NewCreateLocalUserUsecase(services.User, services.Credential)
		created, err := createLocalUser.Execute(ctx, name, username, password, isAdmin)
		if err != nil {
			return fmt.Errorf("failed to create user: %w", err)
		}
		fmt.Printf("Created user %s (%s) [admin=%v]\n", created.Name, created.Email, isAdmin)
		return nil
	})
}

func adminResetPassword(username, password string) error {
	username = strings.TrimSpace(strings.ToLower(username))
	if username == "" || len(strings.TrimSpace(password)) < 8 {
		return fmt.Errorf("username and password (min 8 chars) are required")
	}

	return withAdminServices(func(ctx context.Context, services *application.Services) error {
		user, err := services.User.GetByEmail(ctx, username)
		if err != nil {
			return fmt.Errorf("user not found: %s", username)
		}

		isAdmin := services.Credential.IsAdmin(ctx, user.ID)
		if err = services.Credential.SetPassword(ctx, user.ID, password, isAdmin); err != nil {
			return fmt.Errorf("failed to reset password: %w", err)
		}
		fmt.Printf("Password updated for %s (%s)\n", user.Name, user.Email)
		return nil
	})
}

func adminListUsers() error {
	return withAdminServices(func(ctx context.Context, services *application.Services) error {
		users, err := services.Admin.ListSelfHostUsers(ctx)
		if err != nil {
			return fmt.Errorf("failed to query users: %w", err)
		}

		tw := tabwriter.NewWriter(os.Stdout, 0, 4, 2, ' ', 0)
		_, _ = fmt.Fprintln(tw, "USERNAME\tNAME\tADMIN\tBLOCKED\tMASTER PW\tLAST LOGIN")
		for _, u := range users {
			last := "never"
			if u.LastLoginAt != nil {
				last = u.LastLoginAt.Format(time.RFC3339)
			}
			_, _ = fmt.Fprintf(tw, "%s\t%s\t%t\t%t\t%t\t%s\n", u.Email, u.Name, u.IsAdmin, u.IsBlocked, u.IsMasterPasswordSet, last)
		}
		_ = tw.Flush()
		return nil
	})
}

func adminSetAdmin(username string, enable bool) error {
	return withAdminServices(func(ctx context.Context, services *application.Services) error {
		user, err := services.User.GetByEmail(ctx, strings.TrimSpace(strings.ToLower(username)))
		if err != nil {
			return fmt.Errorf("user not found: %s", username)
		}
		if err = services.Credential.SetAdmin(ctx, user.ID, enable); err != nil {
			return fmt.Errorf("failed to update admin flag: %w", err)
		}
		state := "granted"
		if !enable {
			state = "revoked"
		}
		fmt.Printf("Admin access %s for %s (%s)\n", state, user.Name, user.Email)
		return nil
	})
}

func adminDeleteUser(username string) error {
	return withAdminServices(func(ctx context.Context, services *application.Services) error {
		user, err := services.User.GetByEmail(ctx, strings.TrimSpace(strings.ToLower(username)))
		if err != nil {
			return fmt.Errorf("user not found: %s", username)
		}
		if _, err = services.User.DeleteWithSpaces(ctx, user.ID); err != nil {
			return fmt.Errorf("failed to delete user: %w", err)
		}
		fmt.Printf("Deleted user %s (%s)\n", user.Name, user.Email)
		return nil
	})
}

func adminResetMaster(username string) error {
	return withAdminServices(func(ctx context.Context, services *application.Services) error {
		user, err := services.User.GetByEmail(ctx, strings.TrimSpace(strings.ToLower(username)))
		if err != nil {
			return fmt.Errorf("user not found: %s", username)
		}
		if _, err = services.User.ResetData(ctx, user.ID); err != nil {
			return fmt.Errorf("failed to reset user data: %w", err)
		}
		fmt.Printf("Reset master password state for %s (%s)\n", user.Name, user.Email)
		return nil
	})
}

func adminBlockUser(username string, blocked bool) error {
	return withAdminServices(func(ctx context.Context, services *application.Services) error {
		user, err := services.User.GetByEmail(ctx, strings.TrimSpace(strings.ToLower(username)))
		if err != nil {
			return fmt.Errorf("user not found: %s", username)
		}
		if err = services.User.Block(ctx, user.ID, blocked); err != nil {
			return fmt.Errorf("failed to update block flag: %w", err)
		}
		action := "Blocked"
		if !blocked {
			action = "Unblocked"
		}
		fmt.Printf("%s %s (%s)\n", action, user.Name, user.Email)
		return nil
	})
}
