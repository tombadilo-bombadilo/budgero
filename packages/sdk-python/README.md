# Budgero Python SDK

Official Python SDK for [Budgero](https://budgero.app) — the privacy-first,
zero-based budget manager.

The SDK lets you push transactions to your Budgero budget programmatically.
All data is encrypted client-side with your own key before it leaves your
machine — the server never sees your financial data in plaintext.

## Installation

```bash
pip install budgero
```

Requires Python 3.9+.

## Quickstart

Get your API key and encryption key from the Budgero app under
**Settings → Integrations → Push API**. The encryption key is the same key
that encrypts your budget data; it is accepted in hex (64 characters) or
base64 form.

```python
from budgero import BudgeroClient

client = BudgeroClient(
    api_key="bpk_...",                 # Push API key
    encryption_key="0123...abcdef",    # 32-byte key, hex or base64
)

# Record an expense
result = client.add_transaction(
    account_id=1,
    category_id=5,          # e.g. Groceries
    budget_id=1,
    date="2026-07-03",
    outflow=50.00,          # currency units — $50.00
    memo="Weekly groceries",
    payee="Whole Foods",
)
print(f"Queued: {result.queue_id}")

client.close()  # or use `with BudgeroClient(...) as client:`
```

Every mutation is serialized, encrypted with AES-256-GCM using your key, and
only then sent to the API. Pushed transactions are queued server-side and
applied the next time you open the Budgero app.

For self-hosted instances, pass `base_url="https://budgero.example.com"`.

## Amounts and milliunits

Budgero's sync wire format (protocol v2) represents all monetary values as
**integer milliunits** — 1/1000 of a currency unit, so `$12.34` is
transmitted as `12340`. This avoids floating-point drift in financial data.

You don't need to think about this when using the SDK: the public API accepts
plain currency units as `Decimal`, `float`, or `int` (e.g. `outflow=12.34` or
`outflow=Decimal("12.34")`) and converts to milliunits when building the
encrypted payload. Values read back from the API are converted from
milliunits to `Decimal`. Non-finite values (NaN, infinity) are rejected.

The conversion helpers are exported if you need them:

```python
from budgero import to_milliunits, from_milliunits

to_milliunits(12.34)     # 12340
from_milliunits(12340)   # Decimal('12.34')
```

## Errors

All SDK exceptions inherit from `budgero.BudgeroError`:

- `AuthenticationError` — invalid, expired, or disabled API key
- `ValidationError` — invalid input (e.g. negative or non-finite amounts)
- `EncryptionError` — invalid encryption key or corrupted payload
- `UpgradeRequiredError` — the server requires a newer sync protocol than
  this SDK version speaks; upgrade with `pip install --upgrade budgero`
- `APIError` — other API failures (carries `status_code`)
- `NetworkError` — connection failures and timeouts

## Examples

Runnable examples live in [`examples/`](examples/) — start with
`push_transaction.py`, a minimal end-to-end push (fill in your token, key,
and IDs from Settings > Push API).

## Links

- Website: <https://budgero.app>
- License: MIT
