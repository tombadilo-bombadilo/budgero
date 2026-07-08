"""
Budgero API client.

This module provides the main client class for interacting with the Budgero API.
"""
from __future__ import annotations

import hashlib
import json
from datetime import date
from typing import Any, Optional

import httpx

from budgero._version import __version__
from budgero.encryption import (
    encrypt_payload,
    key_from_base64,
    key_from_hex,
    KEY_LENGTH,
)
from budgero.exceptions import (
    APIError,
    AuthenticationError,
    EncryptionError,
    NetworkError,
    UpgradeRequiredError,
    ValidationError,
)
from budgero.models import (
    AmountLike,
    PushQueueItem,
    PushResult,
    TransactionInput,
    to_milliunits,
)


DEFAULT_BASE_URL = "https://my.budgero.app"
DEFAULT_TIMEOUT = 30.0

#: Sync wire-format version spoken by this SDK. Sent as the payload "v"
#: field, the X-Budgero-Protocol header on every request, and the
#: X-Data-Format-Version header on encrypted data uploads.
PROTOCOL_VERSION = 2


class BudgeroClient:
    """
    Client for interacting with the Budgero Push API.

    The Budgero SDK allows you to programmatically add transactions to your
    Budgero budget. All data is encrypted client-side before being sent to
    the server, ensuring your financial data remains private.

    Attributes:
        base_url: Base URL of the Budgero API.

    Example:
        >>> from budgero import BudgeroClient
        >>>
        >>> # Initialize the client
        >>> client = BudgeroClient(
        ...     api_key="your-api-key",
        ...     encryption_key="your-encryption-key-hex",
        ... )
        >>>
        >>> # Add a transaction
        >>> result = client.add_transaction(
        ...     account_id=1,
        ...     category_id=5,
        ...     budget_id=1,
        ...     date="2024-11-27",
        ...     inflow=100.50,
        ...     memo="Salary deposit",
        ... )
        >>> print(f"Transaction queued: {result.queue_id}")

    Note:
        You can obtain your API key and encryption key from the Budgero app
        in Settings > Integrations > Push API.
    """

    def __init__(
        self,
        api_key: str,
        encryption_key: str,
        *,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = DEFAULT_TIMEOUT,
        transport: Optional[httpx.BaseTransport] = None,
    ) -> None:
        """
        Initialize the Budgero client.

        Args:
            api_key: Your Budgero Push API key (obtained from Settings > Integrations).
            encryption_key: Your encryption key in hex or base64 format.
                This is the same key used to encrypt your budget data.
            base_url: Base URL of the Budgero API. Defaults to the production URL.
                Use this to point to a self-hosted instance.
            timeout: Request timeout in seconds. Defaults to 30 seconds.
            transport: Optional httpx transport, mainly useful for testing
                (e.g. ``httpx.MockTransport``).

        Raises:
            EncryptionError: If the encryption key is invalid.

        Example:
            >>> # Using hex-encoded key
            >>> client = BudgeroClient(
            ...     api_key="bpk_abc123...",
            ...     encryption_key="0123456789abcdef...",  # 64 hex chars
            ... )
            >>>
            >>> # Using base64-encoded key
            >>> client = BudgeroClient(
            ...     api_key="bpk_abc123...",
            ...     encryption_key="base64encodedkey==",
            ... )
            >>>
            >>> # Self-hosted instance
            >>> client = BudgeroClient(
            ...     api_key="bpk_abc123...",
            ...     encryption_key="...",
            ...     base_url="https://budgero.mycompany.com",
            ... )
        """
        self._api_key = api_key
        self._encryption_key = self._parse_encryption_key(encryption_key)
        self.base_url = base_url.rstrip("/")
        self._timeout = timeout
        self._client = httpx.Client(
            base_url=self.base_url,
            timeout=timeout,
            transport=transport,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "User-Agent": f"budgero-python/{__version__}",
                "X-Budgero-Protocol": str(PROTOCOL_VERSION),
            },
        )

    def _parse_encryption_key(self, key: str) -> bytes:
        """Parse encryption key from hex or base64 format."""
        # Try hex first (64 characters = 32 bytes)
        if len(key) == KEY_LENGTH * 2:
            try:
                return key_from_hex(key)
            except EncryptionError:
                pass

        # Try base64
        try:
            return key_from_base64(key)
        except EncryptionError:
            pass

        # Try hex anyway for better error message
        try:
            return key_from_hex(key)
        except EncryptionError as e:
            raise EncryptionError(
                f"Invalid encryption key format. Expected 64 hex characters or "
                f"base64-encoded 32-byte key. Error: {e}"
            ) from e

    def _make_request(
        self,
        method: str,
        path: str,
        *,
        json_data: Optional[dict[str, Any]] = None,
        params: Optional[dict[str, str]] = None,
        headers: Optional[dict[str, str]] = None,
    ) -> dict[str, Any]:
        """Make an HTTP request to the API."""
        try:
            response = self._client.request(
                method,
                path,
                json=json_data,
                params=params,
                headers=headers,
            )
        except httpx.ConnectError as e:
            raise NetworkError(f"Failed to connect to {self.base_url}: {e}") from e
        except httpx.TimeoutException as e:
            raise NetworkError(f"Request timed out: {e}") from e
        except httpx.HTTPError as e:
            raise NetworkError(f"HTTP error: {e}") from e

        # Handle error responses
        if response.status_code == 401:
            raise AuthenticationError(
                "Invalid or expired API key. Please check your credentials."
            )
        elif response.status_code == 403:
            raise AuthenticationError(
                "API key is disabled or lacks permission for this operation."
            )
        elif response.status_code == 426:
            raise UpgradeRequiredError(response_body=response.text)
        elif response.status_code >= 400:
            try:
                error_body = response.json()
                message = error_body.get("error", response.text)
            except Exception:
                message = response.text
            raise APIError(
                f"API request failed: {message}",
                status_code=response.status_code,
                response_body=response.text,
            )

        # Parse response
        try:
            body: dict[str, Any] = response.json()
            return body
        except Exception:
            return {"raw": response.text}

    def _encrypt_mutation(self, op: str, args: dict[str, Any]) -> tuple[str, str]:
        """
        Encrypt a mutation payload and produce a deterministic message ID.

        Payloads are versioned (sync protocol v2): the encrypted JSON is
        ``{"v": 2, "op": ..., "args": {...}}`` and all monetary values in
        ``args`` must already be integer milliunits.
        """
        payload: dict[str, Any] = {"v": PROTOCOL_VERSION, "op": op, "args": args}
        canonical = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
        message_id = hashlib.sha512(canonical).hexdigest()
        payload["message_id"] = message_id
        encrypted = encrypt_payload(payload, self._encryption_key)
        return message_id, encrypted

    def add_transaction(
        self,
        account_id: int,
        category_id: Optional[int],
        budget_id: int,
        date: str | date,
        *,
        inflow: AmountLike = 0,
        outflow: AmountLike = 0,
        memo: str = "",
        payee: Optional[str] = None,
        transfer_id: Optional[str] = None,
    ) -> PushResult:
        """
        Add a new transaction to your budget.

        The transaction data is encrypted client-side before being sent to
        the server. It will be queued and processed when you next open the
        Budgero app.

        Amounts are given in currency units (``Decimal``, ``float``, or
        ``int``; e.g. ``12.34`` for $12.34). On the wire they are encoded
        as integer milliunits (1/1000 currency unit; ``12.34 -> 12340``)
        as required by sync protocol v2. Non-finite values (NaN, infinity)
        are rejected.

        Args:
            account_id: ID of the account for this transaction.
            category_id: ID of the category. Use None for transfers.
            budget_id: ID of the budget.
            date: Transaction date. Can be a string in "YYYY-MM-DD" format
                or a Python date object.
            inflow: Amount flowing into the account, in currency units.
                Default is 0.
            outflow: Amount flowing out of the account, in currency units.
                Default is 0.
            memo: Optional description or note.
            payee: Optional payee name.
            transfer_id: Optional transfer ID for linked transfers.

        Returns:
            PushResult with the queue ID and status.

        Raises:
            ValidationError: If required fields are missing or invalid.
            EncryptionError: If encryption fails.
            AuthenticationError: If the API key is invalid.
            APIError: If the API request fails.

        Example:
            >>> # Record an expense
            >>> result = client.add_transaction(
            ...     account_id=1,
            ...     category_id=5,  # Groceries
            ...     budget_id=1,
            ...     date="2024-11-27",
            ...     outflow=50.00,
            ...     memo="Weekly groceries",
            ...     payee="Whole Foods",
            ... )
            >>>
            >>> # Record income
            >>> result = client.add_transaction(
            ...     account_id=1,
            ...     category_id=10,  # Income category
            ...     budget_id=1,
            ...     date=date.today(),
            ...     inflow=3000.00,
            ...     memo="Monthly salary",
            ...     payee="Acme Corp",
            ... )
            >>>
            >>> # Record a transfer (no category)
            >>> result = client.add_transaction(
            ...     account_id=1,  # From checking
            ...     category_id=None,
            ...     budget_id=1,
            ...     date="2024-11-27",
            ...     outflow=500.00,
            ...     memo="Transfer to savings",
            ...     transfer_id="transfer-123",
            ... )
        """
        # Validate inputs. Converting first rejects non-finite values (NaN,
        # infinity) and validates the amounts as they will appear on the wire.
        inflow_milli = to_milliunits(inflow)
        outflow_milli = to_milliunits(outflow)
        if inflow_milli < 0:
            raise ValidationError("inflow must be non-negative")
        if outflow_milli < 0:
            raise ValidationError("outflow must be non-negative")
        if inflow_milli == 0 and outflow_milli == 0:
            raise ValidationError("Either inflow or outflow must be non-zero")
        if inflow_milli > 0 and outflow_milli > 0:
            raise ValidationError("Cannot have both inflow and outflow on same transaction")

        # Build transaction input
        tx = TransactionInput(
            account_id=account_id,
            category_id=category_id,
            budget_id=budget_id,
            date=date,
            inflow=inflow,
            outflow=outflow,
            memo=memo,
            payee=payee,
            transfer_id=transfer_id,
        )

        return self.push_transaction(tx)

    def push_transaction(self, transaction: TransactionInput) -> PushResult:
        """
        Push a transaction using a TransactionInput object.

        This is a lower-level method that accepts a pre-built TransactionInput.
        Most users should use `add_transaction()` instead.

        Amounts on the TransactionInput are given in currency units
        (``Decimal``/``float``/``int``) and are converted to integer
        milliunits when the wire payload is built (sync protocol v2).

        Args:
            transaction: TransactionInput object with transaction details.

        Returns:
            PushResult with the queue ID and status.

        Example:
            >>> from budgero import TransactionInput
            >>>
            >>> tx = TransactionInput(
            ...     account_id=1,
            ...     category_id=5,
            ...     budget_id=1,
            ...     date="2024-11-27",
            ...     outflow=25.00,
            ...     memo="Coffee",
            ... )
            >>> result = client.push_transaction(tx)
        """
        # Encrypt the mutation
        message_id, encrypted = self._encrypt_mutation(
            "transactions.add",
            transaction.to_api_dict(),
        )

        # Send to API. Encrypted data uploads must declare the data format
        # version so the server can gate stale clients.
        response = self._make_request(
            "POST",
            "/api/v1/push",
            json_data={
                "encrypted_payload": encrypted,
                "message_id": message_id,
            },
            headers={"X-Data-Format-Version": str(PROTOCOL_VERSION)},
        )

        return PushResult(
            success=True,
            queue_id=response.get("id"),
            message=response.get("message"),
        )

    def get_queue(self) -> list[PushQueueItem]:
        """
        Get pending items in the push queue.

        Returns a list of mutations that have been submitted but not yet
        processed by the Budgero app.

        Returns:
            List of PushQueueItem objects.

        Example:
            >>> queue = client.get_queue()
            >>> for item in queue:
            ...     print(f"{item.id}: {item.status}")
        """
        response = self._make_request("GET", "/api/v1/push/queue")
        items = response.get("items", [])
        try:
            return [
                PushQueueItem(
                    id=item["id"],
                    status=item["status"],
                    created_at=item["created_at"],
                    processed_at=item.get("processed_at"),
                )
                for item in items
            ]
        except (KeyError, TypeError) as exc:
            raise APIError(f"Unexpected queue response shape: missing {exc}") from exc

    def get_queue_stats(self) -> dict[str, int]:
        """
        Get statistics about the push queue.

        Returns:
            Dictionary with queue statistics:
            - pending: Number of pending items
            - processed: Number of processed items
            - failed: Number of failed items

        Example:
            >>> stats = client.get_queue_stats()
            >>> print(f"Pending: {stats['pending']}")
        """
        return self._make_request("GET", "/api/v1/push/stats")

    def clear_queue(self) -> dict[str, Any]:
        """
        Clear all items from the push queue.

        This removes all pending mutations. Use with caution as this
        cannot be undone.

        Returns:
            Response from the API.

        Example:
            >>> client.clear_queue()
        """
        return self._make_request("DELETE", "/api/v1/push/queue")

    def acknowledge_queue_item(self, item_id: str) -> dict[str, Any]:
        """
        Acknowledge a queue item as processed.

        This is typically called by the Budgero app after processing
        a mutation, but can be used to manually mark items.

        Args:
            item_id: ID of the queue item to acknowledge.

        Returns:
            Response from the API.
        """
        return self._make_request("PUT", f"/api/v1/push/queue/{item_id}")

    def health_check(self) -> bool:
        """
        Check if the API is healthy and reachable.

        Returns:
            True if the API is healthy, False otherwise.

        Example:
            >>> if client.health_check():
            ...     print("API is healthy")
        """
        try:
            self._make_request("GET", "/api/v1/health")
            return True
        except Exception:
            return False

    def close(self) -> None:
        """
        Close the HTTP client and release resources.

        Call this when you're done using the client to free up
        connections.

        Example:
            >>> client = BudgeroClient(...)
            >>> try:
            ...     client.add_transaction(...)
            ... finally:
            ...     client.close()
        """
        self._client.close()

    def __enter__(self) -> "BudgeroClient":
        """Support context manager protocol."""
        return self

    def __exit__(self, *args: Any) -> None:
        """Close client on context exit."""
        self.close()
