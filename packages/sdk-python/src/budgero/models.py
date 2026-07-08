"""
Data models for the Budgero SDK.

All models use dataclasses for clean, typed data structures with
automatic serialization support.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from enum import Enum
from typing import Any, Optional, Union

from budgero.exceptions import ValidationError


#: Number of milliunits in one currency unit ($12.34 == 12340 milliunits).
MILLIUNITS_PER_UNIT = 1000

#: Amounts accepted by the public API: plain currency units.
AmountLike = Union[int, float, Decimal]


def to_milliunits(amount: AmountLike) -> int:
    """
    Convert an amount in currency units to integer milliunits.

    Budgero's sync wire format (protocol v2) represents all monetary values
    as integers in 1/1000 of a currency unit, e.g. ``$12.34 -> 12340``.
    The public SDK API keeps accepting ``Decimal``/``float``/``int`` currency
    units for convenience; this helper performs the conversion when building
    wire payloads.

    Args:
        amount: Amount in currency units (e.g. ``12.34`` or ``Decimal("12.34")``).

    Returns:
        The amount as integer milliunits (e.g. ``12340``).

    Raises:
        ValidationError: If the amount is not a number or is not finite
            (NaN or infinity).
    """
    if isinstance(amount, Decimal):
        if not amount.is_finite():
            raise ValidationError(f"Amount must be finite, got {amount}")
    elif isinstance(amount, (int, float)) and not isinstance(amount, bool):
        if not math.isfinite(amount):
            raise ValidationError(f"Amount must be finite, got {amount}")
    else:
        raise ValidationError(
            f"Amount must be an int, float, or Decimal, got {type(amount).__name__}"
        )
    return round(amount * MILLIUNITS_PER_UNIT)


def from_milliunits(milliunits: int) -> Decimal:
    """
    Convert integer milliunits (wire format) back to currency units.

    Returns a ``Decimal`` for exact representation, e.g. ``12340 ->
    Decimal("12.34")``.

    Args:
        milliunits: Amount as integer milliunits.

    Returns:
        The amount in currency units as a ``Decimal``.
    """
    return Decimal(milliunits) / MILLIUNITS_PER_UNIT


class GoalPurpose(str, Enum):
    """Purpose of a budget goal."""

    SPENDING = "spending"
    """Track spending limits."""

    SAVINGS = "savings"
    """Track savings targets."""


class GoalType(str, Enum):
    """Type of budget goal."""

    MONTHLY = "monthly"
    """Monthly spending limit."""

    YEARLY = "yearly"
    """Yearly budget allocation."""

    TARGET_DATE = "target-date"
    """Save a specific amount by a target date."""

    MONTHLY_SAVINGS = "monthly-savings"
    """Save a fixed amount each month."""


class RecurringIntervalUnit(str, Enum):
    """Interval unit for recurring transactions."""

    DAY = "day"
    WEEK = "week"
    MONTH = "month"
    YEAR = "year"


class RecurringDirection(str, Enum):
    """Direction of a recurring transaction."""

    INFLOW = "inflow"
    OUTFLOW = "outflow"


@dataclass
class TransactionInput:
    """
    Input data for creating a new transaction.

    Attributes:
        account_id: ID of the account for this transaction.
        category_id: ID of the category (use None for transfers).
        budget_id: ID of the budget this transaction belongs to.
        date: Transaction date in YYYY-MM-DD format or as a date object.
        inflow: Amount flowing into the account (positive number), in
            currency units (``Decimal``, ``float``, or ``int``). Converted
            to integer milliunits on the wire.
        outflow: Amount flowing out of the account (positive number), in
            currency units. Converted to integer milliunits on the wire.
        memo: Optional description or note for the transaction.
        payee: Optional payee name.
        transfer_id: Optional transfer ID for linked transfer transactions.

    Example:
        >>> tx = TransactionInput(
        ...     account_id=1,
        ...     category_id=5,
        ...     budget_id=1,
        ...     date="2024-11-27",
        ...     inflow=100.50,
        ...     memo="Salary deposit",
        ... )
    """

    account_id: int
    category_id: Optional[int]
    budget_id: int
    date: str | date
    inflow: AmountLike = 0
    outflow: AmountLike = 0
    memo: str = ""
    payee: Optional[str] = None
    transfer_id: Optional[str] = None

    def to_api_dict(self) -> dict[str, Any]:
        """
        Convert to API payload format.

        Monetary values are converted from currency units to integer
        milliunits as required by sync protocol v2 (``12.34 -> 12340``).

        Raises:
            ValidationError: If inflow/outflow are not finite numbers.
        """
        date_str = self.date if isinstance(self.date, str) else self.date.isoformat()
        result: dict[str, Any] = {
            "accountId": self.account_id,
            "categoryId": self.category_id,
            "budgetId": self.budget_id,
            "date": date_str,
            "inflow": to_milliunits(self.inflow),
            "outflow": to_milliunits(self.outflow),
            "memo": self.memo,
        }
        if self.payee is not None:
            result["payee"] = self.payee
        if self.transfer_id is not None:
            result["transferId"] = self.transfer_id
        return result


@dataclass
class Transaction:
    """
    A budget transaction.

    Attributes:
        id: Unique transaction ID.
        account_id: ID of the account.
        category_id: ID of the category.
        budget_id: ID of the budget.
        date: Transaction date.
        month: Month in YYYY-MM format.
        inflow: Amount flowing in, in currency units (``Decimal``). The API
            transmits integer milliunits; values are converted on read.
        outflow: Amount flowing out, in currency units (``Decimal``).
        memo: Transaction description.
        reconciled: Whether the transaction is reconciled.
        running_balance: Running balance after this transaction, in
            currency units (``Decimal``).
        transfer_id: ID linking transfer transactions.
        payee: Payee name.
        cleared: Cleared status.
        approved: Whether transaction is approved.
        flag_color: Optional flag color.
        deleted: Whether transaction is soft-deleted.
    """

    id: int
    account_id: int
    category_id: int
    budget_id: int
    date: str
    month: str
    inflow: Decimal
    outflow: Decimal
    memo: str = ""
    reconciled: bool = False
    running_balance: Decimal = Decimal(0)
    transfer_id: Optional[str] = None
    payee: Optional[str] = None
    cleared: Optional[str] = None
    approved: bool = True
    flag_color: Optional[str] = None
    deleted: bool = False

    @classmethod
    def from_api_dict(cls, data: dict[str, Any]) -> "Transaction":
        """Create Transaction from API response."""
        return cls(
            id=data["ID"],
            account_id=data["AccountID"],
            category_id=data["CategoryID"],
            budget_id=data["BudgetID"],
            date=data["Date"],
            month=data["Month"],
            inflow=from_milliunits(data.get("Inflow", 0)),
            outflow=from_milliunits(data.get("Outflow", 0)),
            memo=data.get("Memo", ""),
            reconciled=data.get("Reconciled", False),
            running_balance=from_milliunits(data.get("RunningBalance", 0)),
            transfer_id=data.get("TransferID"),
            payee=data.get("Payee"),
            cleared=data.get("Cleared"),
            approved=data.get("Approved", True),
            flag_color=data.get("FlagColor"),
            deleted=data.get("Deleted", False),
        )


@dataclass
class Account:
    """
    A budget account (checking, savings, credit card, etc.).

    Attributes:
        id: Unique account ID.
        name: Account name.
        currency: Currency code (e.g., "USD", "EUR").
        type: Account type (e.g., "checking", "savings", "credit").
        budget_id: ID of the budget this account belongs to.
        balance: Current account balance, in currency units (``Decimal``).
            The API transmits integer milliunits; values are converted on read.
        on_budget: Whether this account is included in budget calculations.
        archived: Whether the account is archived.
        deleted: Whether the account is soft-deleted.
        note: Optional account note.
        reconciled_at: Last reconciliation timestamp.
    """

    id: int
    name: str
    currency: str
    type: str
    budget_id: int
    balance: Decimal = Decimal(0)
    on_budget: bool = True
    archived: bool = False
    deleted: bool = False
    note: Optional[str] = None
    reconciled_at: Optional[str] = None

    @classmethod
    def from_api_dict(cls, data: dict[str, Any]) -> "Account":
        """Create Account from API response."""
        return cls(
            id=data["ID"],
            name=data["Name"],
            currency=data["Currency"],
            type=data["Type"],
            budget_id=data["BudgetID"],
            balance=from_milliunits(data.get("Balance", 0)),
            on_budget=data.get("OnBudget", True),
            archived=bool(data.get("Archived", False)),
            deleted=data.get("Deleted", False),
            note=data.get("Note"),
            reconciled_at=data.get("ReconciledAt"),
        )


@dataclass
class CategoryGroup:
    """
    A group of budget categories.

    Attributes:
        id: Unique group ID.
        name: Group name.
        budget_id: ID of the budget.
        note: Optional note.
    """

    id: int
    name: str
    budget_id: int
    note: str = ""

    @classmethod
    def from_api_dict(cls, data: dict[str, Any]) -> "CategoryGroup":
        """Create CategoryGroup from API response."""
        return cls(
            id=data["ID"],
            name=data["Name"],
            budget_id=data["BudgetID"],
            note=data.get("Note", ""),
        )


@dataclass
class Category:
    """
    A budget category.

    Attributes:
        id: Unique category ID.
        name: Category name.
        category_group_id: ID of the parent category group.
        budget_id: ID of the budget.
        note: Optional note.
        exclude_from_budget_pace: Whether to exclude from pacing calculations.
    """

    id: int
    name: str
    category_group_id: int
    budget_id: int
    note: str = ""
    exclude_from_budget_pace: bool = False

    @classmethod
    def from_api_dict(cls, data: dict[str, Any]) -> "Category":
        """Create Category from API response."""
        return cls(
            id=data["ID"],
            name=data["Name"],
            category_group_id=data["CategoryGroupID"],
            budget_id=data["BudgetID"],
            note=data.get("Note", ""),
            exclude_from_budget_pace=data.get("ExcludeFromBudgetPace", False),
        )


@dataclass
class Budget:
    """
    A budget workspace.

    Attributes:
        id: Unique budget ID.
        space_id: ID of the budget space (for multi-user).
        name: Budget name.
        display_currency: Currency for display.
        badge_icon: Icon identifier.
        number_format: Number formatting preference.
    """

    id: int
    space_id: str
    name: str
    display_currency: str
    badge_icon: str = ""
    number_format: str = ""

    @classmethod
    def from_api_dict(cls, data: dict[str, Any]) -> "Budget":
        """Create Budget from API response."""
        return cls(
            id=data["ID"],
            space_id=data["SpaceID"],
            name=data["Name"],
            display_currency=data["DisplayCurrency"],
            badge_icon=data.get("BadgeIcon", ""),
            number_format=data.get("NumberFormat", ""),
        )


@dataclass
class Goal:
    """
    A budget goal for a category.

    Attributes:
        id: Unique goal ID.
        type: Type of goal (monthly, yearly, target-date, monthly-savings).
        purpose: Purpose of goal (spending or savings).
        category_id: ID of the associated category.
        target: Target amount, in currency units (``Decimal``). The API
            transmits integer milliunits; values are converted on read.
        start_date: Start date for the goal.
        target_date: Target completion date (for target-date and yearly goals).
        budget_id: ID of the budget.

    Example:
        >>> goal = Goal(
        ...     id=1,
        ...     type=GoalType.TARGET_DATE,
        ...     purpose=GoalPurpose.SAVINGS,
        ...     category_id=5,
        ...     target=1000.00,
        ...     start_date="2024-01-01",
        ...     target_date="2024-12-31",
        ... )
    """

    id: int
    type: GoalType
    purpose: GoalPurpose
    category_id: int
    target: Decimal
    start_date: str
    target_date: Optional[str] = None
    budget_id: Optional[int] = None

    @classmethod
    def from_api_dict(cls, data: dict[str, Any]) -> "Goal":
        """Create Goal from API response."""
        return cls(
            id=data["ID"],
            type=GoalType(data["Type"]),
            purpose=GoalPurpose(data["Purpose"]),
            category_id=data["CategoryID"],
            target=from_milliunits(data["Target"]),
            start_date=data["StartDate"],
            target_date=data.get("TargetDate"),
            budget_id=data.get("BudgetID"),
        )


@dataclass
class Assignment:
    """
    A monthly budget assignment to a category.

    Attributes:
        id: Unique assignment ID.
        category_id: ID of the category.
        amount: Assigned amount, in currency units (``Decimal``). The API
            transmits integer milliunits; values are converted on read.
        month: Month in YYYY-MM format.
        budget_id: ID of the budget.
    """

    id: int
    category_id: int
    amount: Decimal
    month: str
    budget_id: int

    @classmethod
    def from_api_dict(cls, data: dict[str, Any]) -> "Assignment":
        """Create Assignment from API response."""
        return cls(
            id=data["ID"],
            category_id=data["CategoryID"],
            amount=from_milliunits(data["Amount"]),
            month=data["Month"],
            budget_id=data["BudgetID"],
        )


@dataclass
class RecurringSchedule:
    """
    Schedule for a recurring transaction.

    Attributes:
        start_date: When the recurrence starts.
        interval_unit: Unit of interval (day, week, month, year).
        interval_count: Number of units between occurrences.
        end_date: Optional end date.
        anchor_day: Day of month to anchor to.
        anchor_month: Month to anchor to (for yearly).
        weekday: Day of week (0=Sunday, 6=Saturday).
        weekdays: Multiple days of week for weekly recurrence.
    """

    start_date: str
    interval_unit: RecurringIntervalUnit
    interval_count: int = 1
    end_date: Optional[str] = None
    anchor_day: Optional[int] = None
    anchor_month: Optional[int] = None
    weekday: Optional[int] = None
    weekdays: Optional[list[int]] = None


@dataclass
class RecurringTransaction:
    """
    A recurring transaction template.

    Attributes:
        id: Unique ID.
        budget_id: ID of the budget.
        account_id: ID of the account.
        category_id: ID of the category.
        name: Name/title of the recurring transaction.
        memo: Description.
        amount: Transaction amount, in currency units (``Decimal``, ``float``,
            or ``int``). Converted to integer milliunits on the wire.
        direction: Whether it's an inflow or outflow.
        schedule: Recurrence schedule.
        notify_days_before: Days before to notify.
        last_occurrence_date: Date of last occurrence.
        active: Whether the recurrence is active.
        created_at: Creation timestamp.
        updated_at: Last update timestamp.
    """

    id: int
    budget_id: int
    account_id: int
    category_id: Optional[int]
    name: str
    memo: str
    amount: AmountLike
    direction: RecurringDirection
    schedule: RecurringSchedule
    notify_days_before: int = 0
    last_occurrence_date: Optional[str] = None
    active: bool = True
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


@dataclass
class PushQueueItem:
    """
    An item in the push mutation queue.

    Attributes:
        id: Unique queue item ID.
        status: Current status (pending, processed, failed).
        created_at: When the item was created.
        processed_at: When the item was processed.
    """

    id: str
    status: str
    created_at: str
    processed_at: Optional[str] = None


@dataclass
class PushResult:
    """
    Result of a push operation.

    Attributes:
        success: Whether the push was successful.
        queue_id: ID of the queued mutation.
        message: Optional message.
    """

    success: bool
    queue_id: Optional[str] = None
    message: Optional[str] = None
