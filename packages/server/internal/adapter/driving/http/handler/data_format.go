package handler

import (
	"net/http"
	"strconv"

	"github.com/labstack/echo/v4"
)

// CurrentDataFormatVersion is the client data format this server ships with
// (2 = integer-milliunit money). The server never reads blob contents
// (zero-knowledge); clients declare the format they write, and these gates
// stop clients that don't understand a space's format from syncing it —
// an outdated cached PWA or pinned SDK would otherwise misread milliunit
// amounts as decimals and write corrupted data back.
const CurrentDataFormatVersion = 2

// dataFormatHeader declares the format of an uploaded blob.
const dataFormatHeader = "X-Data-Format-Version"

// protocolHeader declares the highest data format the client understands.
// WebSocket clients pass ?protocol= instead (browsers cannot set WS headers).
const protocolHeader = "X-Budgero-Protocol"

// clientDeclaredFormat parses the format version a client declares for data
// it writes. Absent header = legacy client (format 1).
func clientDeclaredFormat(c echo.Context) int64 {
	return parseVersionValue(c.Request().Header.Get(dataFormatHeader))
}

// clientSupportedFormat parses the highest format the client understands,
// from the protocol header or the ?protocol= query param. Absent = legacy.
func clientSupportedFormat(c echo.Context) int64 {
	if v := c.Request().Header.Get(protocolHeader); v != "" {
		return parseVersionValue(v)
	}
	return parseVersionValue(c.QueryParam("protocol"))
}

func parseVersionValue(raw string) int64 {
	if raw == "" {
		return 1
	}
	v, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || v < 1 {
		return 1
	}
	return v
}

// requireFormatSupport returns 426 Upgrade Required when the space's blob is
// in a format newer than the client understands.
func requireFormatSupport(c echo.Context, blobFormat int64) error {
	if blobFormat > clientSupportedFormat(c) {
		return echo.NewHTTPError(
			http.StatusUpgradeRequired,
			"this space uses a newer data format; update the app to continue syncing",
		)
	}
	return nil
}
