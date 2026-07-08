// Package server is the main server package for Budgero.
package server

import "embed"

// WebAssets provides access to the built frontend bundle embedded into the server binary.
// When dist/ is absent (for example in clean test environments), dist-fallback/ ensures
// compilation still succeeds.
//
//go:embed dist* dist-fallback
var WebAssets embed.FS
