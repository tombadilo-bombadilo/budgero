package main

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/google/uuid"
	"github.com/joho/godotenv"
	"github.com/spf13/cobra"
)

type daemonRecord struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	PID       int       `json:"pid"`
	Port      int       `json:"port"`
	LogPath   string    `json:"log_path"`
	StartedAt time.Time `json:"started_at"`
}

type daemonState struct {
	Daemons []daemonRecord `json:"daemons"`
}

func newDaemonCmd() *cobra.Command {
	daemonCmd := &cobra.Command{
		Use:     "daemon",
		Aliases: []string{"deamon"},
		Short:   "Manage background self-host Budgero processes",
	}

	var (
		name    string
		envFile string
		logDir  string
	)
	envOpts := runtimeEnvOptions{}
	startCmd := &cobra.Command{
		Use:   "start",
		Short: "Start a detached Budgero self-host server",
		RunE: func(cmd *cobra.Command, args []string) error {
			if envOpts.port < 0 {
				return fmt.Errorf("port must be positive when provided")
			}
			return daemonStart(envOpts, name, envFile, logDir)
		},
	}
	bindRuntimeEnvFlags(startCmd, &envOpts, true, "Port to run the server on (overrides PORT env; defaults to 3001)")
	startCmd.Flags().StringVar(&name, "name", "", "Optional name to identify the daemon")
	startCmd.Flags().StringVar(&envFile, "env-file", "", "Optional .env file to load before starting")
	startCmd.Flags().StringVar(&logDir, "log-dir", filepath.Join("data", "logs"), "Directory for daemon logs")

	listCmd := &cobra.Command{
		Use:     "list",
		Aliases: []string{"ls"},
		Short:   "List background Budgero daemon processes",
		RunE: func(cmd *cobra.Command, args []string) error {
			return daemonList()
		},
	}

	stopCmd := &cobra.Command{
		Use:     "stop <id|name|pid>",
		Aliases: []string{"kill"},
		Short:   "Stop a daemon process by id, name, or pid",
		Args:    cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			return daemonStop(args[0])
		},
	}

	daemonCmd.AddCommand(startCmd, listCmd, stopCmd)
	return daemonCmd
}

func daemonStart(envOpts runtimeEnvOptions, name, envFile, logDir string) error {
	executable, err := os.Executable()
	if err != nil {
		return fmt.Errorf("failed to resolve current executable: %w", err)
	}

	envMap := envSliceToMap(os.Environ())
	if strings.TrimSpace(envFile) != "" {
		envFromFile, readErr := godotenv.Read(envFile)
		if readErr == nil {
			for k, v := range envFromFile {
				envMap[k] = v
			}
		} else {
			fmt.Printf("warning: could not load env file %s: %v\n", envFile, readErr)
		}
	}
	if applyErr := envOpts.applyToEnvMap(envMap); applyErr != nil {
		return applyErr
	}
	if strings.TrimSpace(envMap["PORT"]) == "" {
		if envOpts.port > 0 {
			envMap["PORT"] = strconv.Itoa(envOpts.port)
		} else {
			envMap["PORT"] = "3001"
		}
	}
	portValue, err := strconv.Atoi(envMap["PORT"])
	if err != nil {
		return fmt.Errorf("PORT must be a valid integer: %w", err)
	}
	env := envMapToSlice(envMap)

	if err = os.MkdirAll(logDir, 0o750); err != nil {
		return fmt.Errorf("failed to create log directory: %w", err)
	}

	id := uuid.New().String()
	displayName := strings.TrimSpace(name)
	if displayName == "" {
		displayName = "daemon-" + id[:8]
	}

	logPath := filepath.Join(logDir, fmt.Sprintf("%s.log", displayName))
	logFile, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600) //nolint:gosec // G304: log path is constructed from controlled inputs
	if err != nil {
		return fmt.Errorf("failed to open log file: %w", err)
	}
	defer func() {
		if closeErr := logFile.Close(); closeErr != nil {
			fmt.Fprintf(os.Stderr, "warning: failed to close log file: %v\n", closeErr)
		}
	}()

	cmd := exec.Command(executable, "serve") //nolint:gosec // G204: executable is the current binary path from os.Executable()
	cmd.Stdout = logFile
	cmd.Stderr = logFile
	cmd.Stdin = nil
	cmd.Env = env
	if attr := newSysProcAttr(); attr != nil {
		cmd.SysProcAttr = attr
	}

	if err = cmd.Start(); err != nil {
		return fmt.Errorf("failed to start daemon: %w", err)
	}

	pid := cmd.Process.Pid
	record := daemonRecord{
		ID:        id,
		Name:      displayName,
		PID:       pid,
		Port:      portValue,
		LogPath:   logPath,
		StartedAt: time.Now().UTC(),
	}

	state, err := loadDaemonState()
	if err != nil {
		_ = cmd.Process.Kill()
		return fmt.Errorf("failed to read daemon state: %w", err)
	}
	state.Daemons = append(state.Daemons, record)
	if err := saveDaemonState(state); err != nil {
		_ = cmd.Process.Kill()
		return fmt.Errorf("failed to persist daemon state: %w", err)
	}

	if err := cmd.Process.Release(); err != nil {
		fmt.Printf("warning: failed to detach daemon process: %v\n", err)
	}

	fmt.Printf("Started daemon %s (pid=%d, port=%d, log=%s)\n", record.Name, pid, record.Port, record.LogPath)
	return nil
}

func daemonList() error {
	state, err := loadDaemonState()
	if err != nil {
		return fmt.Errorf("failed to read daemon state: %w", err)
	}
	if len(state.Daemons) == 0 {
		fmt.Println("No daemon processes recorded. Launch one via `budgero daemon start`.")
		return nil
	}

	fmt.Printf("%-12s %-8s %-6s %-24s %s\n", "ID", "PID", "PORT", "STARTED (UTC)", "NAME")
	fmt.Println(strings.Repeat("-", 70))
	for _, d := range state.Daemons {
		status := "running"
		if !isProcessRunning(d.PID) {
			status = "stopped"
		}
		fmt.Printf("%-12s %-8d %-6d %-24s %s [%s]\n",
			d.ID[:12],
			d.PID,
			d.Port,
			d.StartedAt.Format(time.RFC3339),
			d.Name,
			status,
		)
	}
	return nil
}

func daemonStop(target string) error {
	target = strings.TrimSpace(target)
	if target == "" {
		return fmt.Errorf("daemon stop requires an identifier (id, name, or pid)")
	}

	state, err := loadDaemonState()
	if err != nil {
		return fmt.Errorf("failed to read daemon state: %w", err)
	}

	found := false
	updated := make([]daemonRecord, 0, len(state.Daemons))
	for i := range state.Daemons {
		d := &state.Daemons[i]
		if matchesDaemon(d, target) {
			found = true
			if err := terminateProcess(d.PID); err != nil {
				fmt.Printf("failed to terminate %s (pid=%d): %v\n", d.Name, d.PID, err)
				updated = append(updated, *d)
				continue
			}
			fmt.Printf("Stopped daemon %s (pid=%d)\n", d.Name, d.PID)
			continue
		}
		updated = append(updated, *d)
	}

	if !found {
		return fmt.Errorf("no daemon found for %s", target)
	}

	state.Daemons = updated
	if err := saveDaemonState(state); err != nil {
		return fmt.Errorf("failed to persist daemon state: %w", err)
	}
	return nil
}

func matchesDaemon(d *daemonRecord, target string) bool {
	if d.ID == target || d.Name == target {
		return true
	}
	if strings.HasPrefix(d.ID, target) {
		return true
	}
	if pid, err := strconv.Atoi(target); err == nil && pid == d.PID {
		return true
	}
	return false
}

func daemonStatePath() string {
	if custom := strings.TrimSpace(os.Getenv("SELFHOST_CLI_STATE_PATH")); custom != "" {
		return custom
	}
	return filepath.Join("data", "selfhost-daemons.json")
}

func loadDaemonState() (*daemonState, error) {
	path := daemonStatePath()
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		return nil, err
	}
	data, err := os.ReadFile(path) //nolint:gosec // G304: path is from daemonStatePath() which uses controlled paths
	if err != nil {
		if os.IsNotExist(err) {
			return &daemonState{}, nil
		}
		return nil, err
	}
	var state daemonState
	if err := json.Unmarshal(data, &state); err != nil {
		return nil, err
	}
	return &state, nil
}

func saveDaemonState(state *daemonState) error {
	path := daemonStatePath()
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o600)
}

func isProcessRunning(pid int) bool {
	proc, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	err = proc.Signal(syscall.Signal(0))
	return err == nil
}

func terminateProcess(pid int) error {
	proc, err := os.FindProcess(pid)
	if err != nil {
		return err
	}
	if runtime.GOOS == "windows" {
		return proc.Kill()
	}
	if err := proc.Signal(syscall.SIGTERM); err != nil {
		return err
	}
	for i := 0; i < 10; i++ {
		if !isProcessRunning(pid) {
			return nil
		}
		time.Sleep(300 * time.Millisecond)
	}
	return proc.Kill()
}
