"""
Budgero Python SDK

Official Python SDK for Budgero - Privacy-First Zero Based Budget Manager.

Example usage:
    from budgero import BudgeroClient

    client = BudgeroClient(
        api_key="your-api-key",
        encryption_key="your-encryption-key",
    )

    # Add a transaction (amounts in currency units; encoded as integer
    # milliunits on the wire)
    client.add_transaction(
        account_id=1,
        category_id=5,
        budget_id=1,
        date="2024-11-27",
        inflow=100.50,
        memo="Salary deposit",
    )
"""

from budgero._version import __version__
from budgero.client import BudgeroClient
from budgero.models import (
    Transaction,
    TransactionInput,
    Account,
    Category,
    CategoryGroup,
    Budget,
    Goal,
    GoalPurpose,
    GoalType,
    from_milliunits,
    to_milliunits,
)
from budgero.exceptions import (
    BudgeroError,
    AuthenticationError,
    EncryptionError,
    APIError,
    UpgradeRequiredError,
    ValidationError,
)

__all__ = [
    "BudgeroClient",
    "Transaction",
    "TransactionInput",
    "Account",
    "Category",
    "CategoryGroup",
    "Budget",
    "Goal",
    "GoalPurpose",
    "GoalType",
    "BudgeroError",
    "AuthenticationError",
    "EncryptionError",
    "APIError",
    "UpgradeRequiredError",
    "ValidationError",
    "to_milliunits",
    "from_milliunits",
    "__version__",
]
