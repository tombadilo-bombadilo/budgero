#!/usr/bin/env python3
"""
Budgero Push API - Transaction Sender (using budgero SDK)

Edit CONFIG below (token/key/amounts) and run:
    python push_transaction.py

Requirements:
    pip install budgero
"""

from __future__ import annotations

import sys
from datetime import datetime, date as date_cls

from budgero import BudgeroClient
from budgero.exceptions import (
    APIError,
    AuthenticationError,
    EncryptionError,
    NetworkError,
    ValidationError,
)

# =============================================================================
# CONFIGURATION - Edit these values for quick testing
# =============================================================================
CONFIG: dict[str, object] = {
    # API URL (SDK default is https://my.budgero.app)
    "url": "http://localhost:3001",

    # Push API token (Budgero Settings > Push API)
    "token": "your-push-api-token",

    # Encryption key (32-byte key, base64 or hex; Budgero Settings > Push API)
    "key": "your-encryption-key",

    # Transaction fields
    "inflow": 0.00,
    "outflow": 10.00,
    "account_id": 1,
    "category_id": 9,
    "budget_id": 1,
    "date": None,  # None = today's date
    "memo": "Example transaction from the Budgero Python SDK",
    "payee": "Test Payee",
}
# =============================================================================


def main() -> None:
    # Validate required fields
    token = str(CONFIG.get("token") or "").strip()
    key = str(CONFIG.get("key") or "").strip()
    url = str(CONFIG.get("url") or "").strip()

    if not token:
        print("Error: No API token provided. Set CONFIG['token'].")
        sys.exit(1)
    if not key:
        print("Error: No encryption key provided. Set CONFIG['key'].")
        sys.exit(1)
    if not url:
        print("Error: No API URL provided. Set CONFIG['url'].")
        sys.exit(1)

    tx_date: str | date_cls = (
        CONFIG["date"] if CONFIG.get("date") else datetime.now().strftime("%Y-%m-%d")
    )  # type: ignore[assignment]

    print(f"\nSending transaction to {url}...")

    try:
        client = BudgeroClient(
            api_key=token,
            encryption_key=key,
            base_url=url,
        )

        result = client.add_transaction(
            account_id=int(CONFIG["account_id"]),
            category_id=int(CONFIG["category_id"]),
            budget_id=int(CONFIG["budget_id"]),
            date=tx_date,
            inflow=float(CONFIG["inflow"]),
            outflow=float(CONFIG["outflow"]),
            memo=str(CONFIG["memo"]),
            payee=str(CONFIG["payee"]),
        )

        print("\n" + "=" * 50)
        print("SUCCESS: Transaction queued!")
        print(f"Queue ID: {result.queue_id}")
        if result.message:
            print(f"Message: {result.message}")
        print("=" * 50)
    except (AuthenticationError, APIError, EncryptionError, ValidationError, NetworkError) as e:
        print(f"\nERROR: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"\nUnexpected error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
