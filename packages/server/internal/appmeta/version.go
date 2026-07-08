// Package appmeta provides application metadata such as version information.
package appmeta

import (
	_ "embed"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/joho/godotenv"
	"github.com/rs/zerolog/log"
)

//go:embed version.txt
var embeddedVersion string

const versionUnknown = "unknown"

var (
	buildVersionOnce  sync.Once
	latestVersionOnce sync.Once
	buildVersion      string
	latestVersion     string
	loadEnvOnce       sync.Once
)

// BuildVersion returns the version baked into the current server build.
func BuildVersion() string {
	buildVersionOnce.Do(func() {
		buildVersion = detectBuildVersion()
	})
	return buildVersion
}

// LatestVersion returns the server-declared latest app version.
func LatestVersion() string {
	latestVersionOnce.Do(func() {
		latestVersion = detectLatestVersion()
	})
	return latestVersion
}

func detectLatestVersion() string {
	ensureEnvLoaded()

	if v := strings.TrimSpace(os.Getenv("APP_LATEST_VERSION")); v != "" {
		log.Info().Str("latest_version", v).Msg("Using APP_LATEST_VERSION override")
		return v
	}

	if bv := BuildVersion(); bv != "" && bv != versionUnknown {
		return bv
	}

	return versionUnknown
}

func detectBuildVersion() string {
	ensureEnvLoaded()

	if v := strings.TrimSpace(os.Getenv("APP_VERSION")); v != "" {
		log.Info().Str("version", v).Msg("Using APP_VERSION for server build metadata")
		return v
	}

	candidates := []string{
		filepath.Join(".", "package.json"),
		filepath.Join("..", "package.json"),
		filepath.Join("..", "..", "package.json"),
		filepath.Join("packages", "server", "package.json"),
	}

	seen := make(map[string]struct{}, len(candidates))
	for _, candidate := range candidates {
		path := filepath.Clean(candidate)
		if _, ok := seen[path]; ok {
			continue
		}
		seen[path] = struct{}{}

		version, err := readPackageVersion(path)
		if err != nil || version == "" {
			continue
		}
		log.Info().Str("version", version).Str("source", path).Msg("Detected server build version")
		return version
	}

	if v := strings.TrimSpace(embeddedVersion); v != "" {
		log.Info().Str("version", v).Msg("Using embedded server version metadata")
		return v
	}

	log.Warn().Msg("Unable to determine server build version; defaulting to unknown")
	return versionUnknown
}

func readPackageVersion(path string) (string, error) {
	data, err := os.ReadFile(path) //nolint:gosec // G304: path is from hardcoded candidate list
	if err != nil {
		return "", err
	}

	var pkg struct {
		Version string `json:"version"`
	}

	if err := json.Unmarshal(data, &pkg); err != nil {
		return "", err
	}

	return strings.TrimSpace(pkg.Version), nil
}

func ensureEnvLoaded() {
	loadEnvOnce.Do(func() {
		if err := godotenv.Load(); err != nil && !os.IsNotExist(err) {
			log.Debug().Err(err).Msg("godotenv load failed in appmeta (continuing)")
		}
	})
}
