package main

import (
	"fmt"
	"os"
	"strconv"
	"strings"

	"github.com/spf13/cobra"
)

type runtimeEnvOptions struct {
	port             int
	jwtSecret        string
	jwtTTLHours      int
	currencyAPIKey   string
	extraAssignments []string
}

func bindRuntimeEnvFlags(cmd *cobra.Command, opts *runtimeEnvOptions, includePort bool, portHelp string) {
	if includePort {
		cmd.Flags().IntVar(&opts.port, "port", 0, portHelp)
	}
	cmd.Flags().StringVar(&opts.jwtSecret, "jwt-secret", "", "Self-host JWT secret (overrides SELF_HOST_JWT_SECRET)")
	cmd.Flags().IntVar(&opts.jwtTTLHours, "jwt-ttl-hours", 0, "JWT expiry in hours (overrides SELF_HOST_JWT_TTL_HOURS; defaults to 24)")
	cmd.Flags().StringVar(&opts.currencyAPIKey, "currency-api-key", "", "CurrencyLayer API key (overrides CURRENCYLAYER_API_KEY)")
	cmd.Flags().StringArrayVar(&opts.extraAssignments, "env", nil, "Additional KEY=VALUE environment overrides (repeatable)")
}

func (opts runtimeEnvOptions) processEnvOverrides() (map[string]string, error) {
	overrides := make(map[string]string)
	if opts.port > 0 {
		overrides["PORT"] = strconv.Itoa(opts.port)
	}
	if strings.TrimSpace(opts.jwtSecret) != "" {
		overrides["SELF_HOST_JWT_SECRET"] = opts.jwtSecret
	}
	if opts.jwtTTLHours > 0 {
		overrides["SELF_HOST_JWT_TTL_HOURS"] = strconv.Itoa(opts.jwtTTLHours)
	}
	if strings.TrimSpace(opts.currencyAPIKey) != "" {
		overrides["CURRENCYLAYER_API_KEY"] = opts.currencyAPIKey
	}
	for _, raw := range opts.extraAssignments {
		key, value, err := parseEnvAssignment(raw)
		if err != nil {
			return nil, err
		}
		overrides[key] = value
	}
	return overrides, nil
}

func (opts runtimeEnvOptions) applyProcessEnv() error {
	overrides, err := opts.processEnvOverrides()
	if err != nil {
		return err
	}
	for key, value := range overrides {
		if err := os.Setenv(key, value); err != nil {
			return fmt.Errorf("failed to set %s: %w", key, err)
		}
	}
	return nil
}

func (opts runtimeEnvOptions) applyToEnvMap(env map[string]string) error {
	overrides, err := opts.processEnvOverrides()
	if err != nil {
		return err
	}
	for key, value := range overrides {
		env[key] = value
	}
	return nil
}

func parseEnvAssignment(raw string) (key, value string, err error) {
	parts := strings.SplitN(raw, "=", 2)
	if len(parts) != 2 {
		return "", "", fmt.Errorf("env override must be in KEY=VALUE form: %s", raw)
	}
	key = strings.TrimSpace(parts[0])
	if key == "" {
		return "", "", fmt.Errorf("env override must provide a key: %s", raw)
	}
	return key, parts[1], nil
}

func envSliceToMap(entries []string) map[string]string {
	result := make(map[string]string, len(entries))
	for _, entry := range entries {
		if entry == "" {
			continue
		}
		if idx := strings.Index(entry, "="); idx != -1 {
			key := entry[:idx]
			value := entry[idx+1:]
			result[key] = value
		}
	}
	return result
}

func envMapToSlice(env map[string]string) []string {
	result := make([]string, 0, len(env))
	for key, value := range env {
		result = append(result, fmt.Sprintf("%s=%s", key, value))
	}
	return result
}
