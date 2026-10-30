package middleware

import "budgero-server/internal/domain/analytics"

// ClassifyErrorForTest exposes classifyError to external tests.
func ClassifyErrorForTest(err error) analytics.ErrorCode { return classifyError(err) }

// RootErrorTypeForTest exposes rootErrorType to external tests.
func RootErrorTypeForTest(err error) string { return rootErrorType(err) }
