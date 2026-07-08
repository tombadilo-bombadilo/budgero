"""
Custom exceptions for the Budgero SDK.
"""
from __future__ import annotations


class BudgeroError(Exception):
    """Base exception for all Budgero SDK errors."""

    pass


class AuthenticationError(BudgeroError):
    """
    Raised when authentication fails.

    This can occur when:
    - The API key is invalid or expired
    - The API key has been revoked
    - The token is malformed
    """

    pass


class EncryptionError(BudgeroError):
    """
    Raised when encryption or decryption fails.

    This can occur when:
    - The encryption key is invalid
    - The key length is incorrect (must be 32 bytes for AES-256)
    - The encrypted payload is corrupted
    - The IV/nonce is invalid
    """

    pass


class APIError(BudgeroError):
    """
    Raised when an API request fails.

    Attributes:
        status_code: HTTP status code from the API.
        response_body: Raw response body if available.
    """

    def __init__(
        self,
        message: str,
        status_code: int | None = None,
        response_body: str | None = None,
    ):
        super().__init__(message)
        self.status_code = status_code
        self.response_body = response_body

    def __str__(self) -> str:
        base = super().__str__()
        if self.status_code:
            return f"{base} (HTTP {self.status_code})"
        return base


class UpgradeRequiredError(APIError):
    """
    Raised when the server rejects the request with HTTP 426 (Upgrade Required).

    Budgero versions its sync wire format. The server refuses requests from
    clients that speak an older protocol than it requires. If you see this
    error, this version of the SDK is too old for the server it is talking
    to — upgrade with::

        pip install --upgrade budgero
    """

    def __init__(
        self,
        message: str = (
            "The Budgero server requires a newer sync protocol than this SDK "
            "supports. Please upgrade the SDK: pip install --upgrade budgero"
        ),
        status_code: int | None = 426,
        response_body: str | None = None,
    ):
        super().__init__(message, status_code=status_code, response_body=response_body)


class ValidationError(BudgeroError):
    """
    Raised when input validation fails.

    This can occur when:
    - Required fields are missing
    - Field values are out of valid range
    - Date formats are invalid
    """

    pass


class NetworkError(BudgeroError):
    """
    Raised when a network error occurs.

    This can occur when:
    - The server is unreachable
    - The connection times out
    - DNS resolution fails
    """

    pass
