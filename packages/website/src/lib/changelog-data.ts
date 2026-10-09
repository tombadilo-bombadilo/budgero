export type ChangelogItemType = 'new' | 'improved' | 'fixed' | 'coming-soon' | 'deprecated';

export type ChangelogItem = {
  type: ChangelogItemType;
  title: string;
  description: string;
};

export type ChangelogEntry = {
  version: string;
  date: string;
  summary: string;
  isLatest?: boolean;
  items: ChangelogItem[];
  acknowledgements?: {
    githubUsername: string;
    pullRequest: number;
    contribution: string;
  }[];
};

export const changelogEntries: ChangelogEntry[] = [
  {
    version: 'v1.17.1',
    date: 'October 9, 2026',
    summary: 'Fixes untranslated labels that appeared as short codes after v1.17.0.',
    isLatest: true,
    items: [
      {
        type: 'fixed',
        title: 'Missing labels',
        description:
          'The inline transaction row, transfer payees and the new Appearance settings showed short codes instead of text. They now show properly in every language.',
      },
    ],
  },
  {
    version: 'v1.17.0',
    date: 'October 9, 2026',
    summary:
      'Adds inline transaction entry on the desktop register, category notes, a target balance goal and duplicating transactions, and makes far more changes undoable.',
    items: [
      {
        type: 'new',
        title: 'Inline transaction entry',
        description:
          'Settings → Appearance → Add transactions: choose Inline row to add transactions straight in the desktop register, including transfers between currencies and splits. Mobile keeps the dialog.',
      },
      {
        type: 'new',
        title: 'Category notes',
        description: 'Write a note for a category in the budget context panel.',
      },
      {
        type: 'new',
        title: 'Target balance goal',
        description: 'Set a balance a category should reach, with no date or repeat.',
      },
      {
        type: 'new',
        title: 'Duplicate transactions',
        description: 'Duplicate the selected transactions with Shift+D.',
      },
      {
        type: 'new',
        title: 'Leave zero amounts empty',
        description:
          'An Appearance setting that shows empty amount fields instead of zeros in the register.',
      },
      {
        type: 'improved',
        title: 'Undo',
        description:
          'Reconciliation, accounts, goals, category order, split edits, transfer deletion, recurring transactions, warranties, custom rates, scenarios, reports, dashboards, budget settings and preferences can now be undone, and undo/redo keeps record IDs stable.',
      },
      {
        type: 'improved',
        title: 'Transfers',
        description:
          'Shorter transfer memos, the other account shown in the payee cell, Quick Add stays open for transfers, and saving a transfer no longer blocks the screen.',
      },
      {
        type: 'improved',
        title: 'Hungarian forint',
        description: 'Forint amounts show as Ft instead of HUF.',
      },
      {
        type: 'improved',
        title: 'Uncategorized badges',
        description: 'The uncategorized count on sidebar accounts explains what it counts.',
      },
      {
        type: 'fixed',
        title: 'PayPal accounts in bank sync',
        description:
          'PayPal accounts reported with the XXX currency can be linked to an existing account.',
      },
      {
        type: 'fixed',
        title: 'Self-hosted bank relay IP',
        description:
          'SELF_HOST_PUBLIC_IP can override the PSU-IP header and accepts a DDNS hostname as well as a literal IP.',
      },
      {
        type: 'fixed',
        title: 'Undo after amount edits',
        description:
          'Editing an amount refreshes the account register so the change can be undone.',
      },
    ],
    acknowledgements: [
      {
        githubUsername: 'f-liva',
        pullRequest: 43,
        contribution:
          'Letting self-hosted bank sync override the public IP, including DDNS hostnames.',
      },
      {
        githubUsername: 'f-liva',
        pullRequest: 44,
        contribution: 'Fixing linking PayPal accounts to an existing account.',
      },
    ],
  },
  {
    version: 'v1.16.0',
    date: 'October 5, 2026',
    summary:
      'Adds EU bank sync (beta) through your own Enable Banking connection, a Sync status page, and fixes the month label being cut off with wide theme fonts.',
    isLatest: false,
    items: [
      {
        type: 'new',
        title: 'EU bank sync (beta)',
        description:
          'Connect European banks through your own Enable Banking account. Bank traffic passes through Budgero only as encrypted data it cannot read. SimpleFIN and Enable Banking can be connected side by side.',
      },
      {
        type: 'improved',
        title: 'Bank sync feed settings',
        description:
          'For each linked account, choose whether pending transactions import as uncleared, and which fields become the date, payee and memo. Country and bank pickers are searchable and show bank logos.',
      },
      {
        type: 'new',
        title: 'Sync status page',
        description:
          'Settings → Sync status shows pending changes and the server’s change log, and can download your budget again.',
      },
      {
        type: 'fixed',
        title: 'Month label truncation',
        description: 'The month picker label no longer gets cut off with wide theme fonts.',
      },
    ],
  },
  {
    version: 'v1.15.1',
    date: 'October 2, 2026',
    summary: 'Fixes the Bank sync settings page opening blank.',
    isLatest: false,
    items: [
      {
        type: 'fixed',
        title: 'Bank sync settings page',
        description:
          'Settings → Bank sync opens again. In v1.15.0 it showed a blank page, so SimpleFIN could not be connected.',
      },
    ],
  },
  {
    version: 'v1.15.0',
    date: 'October 2, 2026',
    summary:
      'Adds bank sync (beta) through your own SimpleFIN Bridge subscription, an Uncleared quick filter with keyboard shortcuts, and a spending breakdown that matches Activity.',
    isLatest: false,
    items: [
      {
        type: 'new',
        title: 'Bank sync (beta)',
        description:
          'Connect your own SimpleFIN Bridge subscription (US and Canadian banks) to import transactions automatically when you open Budgero. The connection is stored encrypted in your budget and Budgero’s servers never see your bank data. Transactions that look like ones you already entered are offered as matches. This is a beta: if your bank is on SimpleFIN, we’d love your feedback on how imports and matching work for you.',
      },
      {
        type: 'new',
        title: 'Uncleared filter and shortcuts',
        description:
          'Account pages have an Uncleared toggle next to Uncategorized. Press ⇧C or ⇧U to switch either filter on and off.',
      },
      {
        type: 'fixed',
        title: 'Spending breakdown matches Activity',
        description:
          'Clicking a category’s Activity now includes transactions dated later in the month and subtracts refunds, so the breakdown total matches.',
      },
    ],
  },
  {
    version: 'v1.14.1',
    date: 'October 1, 2026',
    summary:
      'Fixes upcoming recurring transactions appearing outside the selected register range and YNAB file imports failing on amounts.',
    isLatest: false,
    items: [
      {
        type: 'fixed',
        title: 'Upcoming recurring follows the date range',
        description:
          'The register only shows upcoming recurring transactions within the selected date range. Choose a range that extends past today to see them.',
      },
      {
        type: 'fixed',
        title: 'YNAB file import amounts',
        description:
          'YNAB file imports detect the export’s number format automatically, so amounts like $0.00 no longer stop the import when the budget uses a different number format.',
      },
    ],
  },
  {
    version: 'v1.14.0',
    date: 'September 30, 2026',
    summary:
      'Adds cleared transactions and cleared-balance reconciliation, AND/OR rule conditions, duplicate hints, Push API splits, updates and transfers, and a clearer YNAB import.',
    isLatest: false,
    items: [
      {
        type: 'new',
        title: 'Cleared transactions',
        description:
          'Mark transactions uncleared or cleared alongside reconciled. The account header shows your cleared balance, and reconciling compares it and locks only cleared transactions. Existing transactions start as cleared, and YNAB imports keep their cleared status.',
      },
      {
        type: 'new',
        title: 'Cleared shortcuts and search',
        description:
          'Press C to toggle cleared on the selected rows, and filter the register by cleared, uncleared, or reconciled.',
      },
      {
        type: 'new',
        title: 'Upcoming recurring in the register',
        description:
          'Scheduled recurring transactions appear inline in the register, where you can mark them ready or skip them.',
      },
      {
        type: 'new',
        title: 'Possible duplicate hints',
        description:
          'When you add a transaction that looks like an existing one, Budgero warns you. Switch it off or adjust how close a match has to be in Settings.',
      },
      {
        type: 'new',
        title: 'AND/OR rule conditions',
        description:
          'Chain rule conditions with AND or OR. AND is checked first, so each OR starts a new group.',
      },
      {
        type: 'new',
        title: 'Push API splits, updates, deletes, and transfers',
        description:
          'Push split transactions, update or delete pushed transactions by their message ID, and add linked transfers. The Python SDK supports all of these.',
      },
      {
        type: 'new',
        title: 'YNAB import Ready to Assign breakdown',
        description:
          "When the imported Ready to Assign doesn't match, the import shows which categories cause the difference.",
      },
      {
        type: 'new',
        title: 'Keyboard shortcuts dialog',
        description: 'A header button lists every shortcut, labelled for your platform.',
      },
      {
        type: 'improved',
        title: 'Compact rules page',
        description:
          'Collapsible rule rows show conditions and actions. The rule form is tighter, with searchable category and account pickers.',
      },
      {
        type: 'improved',
        title: 'Compact recurring page',
        description: 'Upcoming occurrences collapse under their schedule.',
      },
      {
        type: 'improved',
        title: 'YNAB import verification',
        description:
          'A clearer verification table after import, and integrity mismatches are now warnings instead of errors.',
      },
      {
        type: 'improved',
        title: 'Consistent icons',
        description: 'One recurring icon everywhere.',
      },
      {
        type: 'fixed',
        title: 'Date range picker',
        description: 'Its width no longer jumps.',
      },
      {
        type: 'fixed',
        title: 'Push API',
        description:
          'Referenced updates are applied atomically, deletes are safe to repeat, and account currencies are preserved on transfers.',
      },
    ],
    acknowledgements: [
      {
        githubUsername: 'caleonardo',
        pullRequest: 18,
        contribution: 'Fixing the date picker width.',
      },
      {
        githubUsername: 'caleonardo',
        pullRequest: 22,
        contribution: 'Turning YNAB import integrity mismatches into warnings.',
      },
      {
        githubUsername: 'caleonardo',
        pullRequest: 23,
        contribution: 'Ready to Assign discrepancy attribution for YNAB imports.',
      },
      {
        githubUsername: 'caleonardo',
        pullRequest: 24,
        contribution: 'The YNAB import verification table.',
      },
      {
        githubUsername: 'f-liva',
        pullRequest: 20,
        contribution: 'Split transactions in the Push API.',
      },
      {
        githubUsername: 'f-liva',
        pullRequest: 21,
        contribution: 'Updating and deleting pushed transactions by reference.',
      },
      {
        githubUsername: 'f-liva',
        pullRequest: 25,
        contribution: 'Linked transfers in the Python SDK and docs.',
      },
    ],
  },
  {
    version: 'v1.13.2',
    date: 'September 17, 2026',
    summary:
      'Adds faster month and year navigation to date range filters and fixes account transaction views staying stale after changes.',
    isLatest: false,
    items: [
      {
        type: 'improved',
        title: 'Faster date range navigation',
        description:
          'Select a month and step between years in date range filters, then choose a day. Jump back to the current month without changing the selected range.',
      },
      {
        type: 'fixed',
        title: 'Account transactions refresh after changes',
        description:
          'Account transaction lists, summaries, upcoming transactions, and balance history now refresh after transaction edits and other changes that affect account transactions.',
      },
    ],
    acknowledgements: [
      {
        githubUsername: 'caleonardo',
        pullRequest: 7,
        contribution: 'Faster month and year navigation in date range filters.',
      },
      {
        githubUsername: 'f-liva',
        pullRequest: 11,
        contribution: 'Correcting the Push API documentation’s required encryption salt prefix.',
      },
    ],
  },
  {
    version: 'v1.13.1',
    date: 'September 17, 2026',
    summary:
      'Adds faster month and year navigation to date range filters and fixes account transaction views staying stale after changes.',
    isLatest: false,
    items: [
      {
        type: 'improved',
        title: 'Faster date range navigation',
        description:
          'Select a month and step between years in date range filters, then choose a day. Jump back to the current month without changing the selected range.',
      },
      {
        type: 'fixed',
        title: 'Account transactions refresh after changes',
        description:
          'Account transaction lists, summaries, upcoming transactions, and balance history now refresh after transaction edits and other changes that affect account transactions.',
      },
    ],
    acknowledgements: [
      {
        githubUsername: 'caleonardo',
        pullRequest: 7,
        contribution: 'Faster month and year navigation in date range filters.',
      },
      {
        githubUsername: 'f-liva',
        pullRequest: 11,
        contribution: 'Correcting the Push API documentation’s required encryption salt prefix.',
      },
    ],
  },
  {
    version: 'v1.13.0',
    date: 'September 16, 2026',
    summary:
      'Adds German, French, Spanish, and Dutch app translations, language-aware dates, and improved layouts for smaller screens.',
    isLatest: false,
    items: [
      {
        type: 'new',
        title: 'Use Budgero in four more languages',
        description:
          'Use the app in German, French, Spanish, or Dutch, including onboarding, budgeting, transactions, reports, goals, and settings. Budgero detects a supported browser language on first use; change it under Settings → Appearance. The choice is saved on this device.',
      },
      {
        type: 'improved',
        title: 'Dates follow your display language',
        description:
          'Month and weekday names, date labels, and relative times follow the selected app language. Currency and number formatting remain controlled by your budget settings.',
      },
      {
        type: 'fixed',
        title: 'Dialogs and controls fit smaller screens',
        description:
          'Dialogs stay within the screen and scroll when needed. Transaction forms and report controls make room for longer translated labels on smaller screens.',
      },
      {
        type: 'fixed',
        title: 'Clearer budgeting and transaction wording',
        description:
          'Corrected savings terminology, exchange-rate descriptions, goal messages, and spacing in translated labels. French goal titles, funding-priority guidance, and recurring-transaction navigation now use clearer phrasing.',
      },
      {
        type: 'fixed',
        title: 'Consistent onboarding language',
        description:
          'French illustrations now use “vous” throughout. Onboarding text uses consistent budgeting terms and correctly points to Settings → Appearance for changing the display language.',
      },
    ],
  },
  {
    version: 'v1.12.1',
    date: 'September 15, 2026',
    summary:
      'Adds a configurable first day of the week and fixes currency displays, scheduled conversions, shortcut labels, app caching, encrypted saving, and sync cleanup.',
    isLatest: false,
    items: [
      {
        type: 'new',
        title: 'Choose the first day of the week',
        description:
          'Choose Sunday or Monday under Budget Settings → Calendar. Calendars, weekly reports, and “this week” and “last week” searches follow the workspace preference.',
      },
      {
        type: 'fixed',
        title: 'Recurring transaction currencies',
        description:
          'Recurring settings and upcoming transactions show amounts in the account currency, with an approximate budget-currency equivalent when currencies differ. Account recurring panels respect the selected currency display.',
      },
      {
        type: 'fixed',
        title: 'Scheduled currency conversions',
        description:
          'Future transactions use current available official rates. Recurring projections respect custom rates for their scheduled dates and correctly calculate cryptocurrency amounts and transfers.',
      },
      {
        type: 'improved',
        title: 'Exchange-rate refresh reliability',
        description:
          'Official rates refresh when opening a budget or reconnecting. Successful refreshes are reused for the rest of the day for that budget and browser. Failed refreshes preserve the last usable rates.',
      },
      {
        type: 'fixed',
        title: 'Keyboard shortcut labels',
        description:
          'Search and Add Transaction labels show Ctrl shortcuts on Windows and Linux and Apple symbols on Apple devices.',
      },
      {
        type: 'fixed',
        title: 'Stale app pages after updates',
        description:
          'Corrected caching rules that could leave browsers loading outdated app pages after a server update.',
      },
      {
        type: 'fixed',
        title: 'Encrypted saving reliability',
        description:
          'Fixed overlapping encryption operations producing unreadable saved data. If local encryption fails, Budgero preserves the previous saved copy instead of writing unencrypted data.',
      },
      {
        type: 'fixed',
        title: 'Sync session cleanup',
        description:
          'Closed sync sessions no longer reconnect or start further updates after shutdown. Delayed saves cannot overwrite a newer session’s sync position.',
      },
    ],
    acknowledgements: [
      {
        githubUsername: 'Dmitiry1921',
        pullRequest: 6,
        contribution: 'the recurring transaction currency fixes',
      },
    ],
  },
  {
    version: 'v1.12.0',
    date: 'September 12, 2026',
    summary:
      'Adds category funding priorities and duplicate review for file imports, and fixes YNAB imports, transaction lists, and local saving.',
    isLatest: false,
    items: [
      {
        type: 'new',
        title: 'Category funding priorities',
        description:
          'Set category priorities independently of category order. Fund Goals funds higher priorities first, then shares remaining money proportionally to shortfalls or toward equal completion percentages. Edit priorities in category dialogs, row menus, or the budgeting side panel. Priority choices, sharing, and badge visibility are saved per budget and synced across devices.',
      },
      {
        type: 'new',
        title: 'Review duplicate file transactions',
        description:
          'CSV, PDF, OFX/QFX, QIF, and CAMT imports identify previously imported rows and flag possible duplicates for review. Choose whether to skip or import them, with separate counts for imported, skipped, invalid, and failed rows.',
      },
      {
        type: 'improved',
        title: 'Resolve ambiguous YNAB imports',
        description:
          'Choose a date format when a ZIP export is ambiguous, and match credit cards to payment categories when a direct YNAB import cannot determine the links.',
      },
      {
        type: 'fixed',
        title: 'YNAB account, category, and split data',
        description:
          'Fixed imports merging same-named accounts or categories, mispairing split transfers, and losing split notes or reconciliation status. Explicitly uncategorized API inflows remain uncategorized. Cancelled imports clean up their unfinished budgets.',
      },
      {
        type: 'fixed',
        title: 'YNAB currency amounts',
        description:
          'Fixed decimal and thousands separators being misread or amounts being truncated. Invalid nonempty amounts now stop the import instead of silently changing values.',
      },
      {
        type: 'fixed',
        title: 'Credit-card payment categories',
        description:
          "Fixed cards with matching names sharing a payment category, and account renaming or deletion changing another card's payment category.",
      },
      {
        type: 'fixed',
        title: 'Remembered transaction defaults',
        description:
          'Fixed remembered accounts, payees, categories, and labels carrying over between budgets, including hidden invalid labels that prevented saving a transaction.',
      },
      {
        type: 'improved',
        title: 'Transaction selection',
        description:
          'Transaction checkboxes are larger on desktop and mobile. The full checkbox cell is clickable on desktop, including Select all, with Shift/Cmd/Ctrl selection preserved.',
      },
      {
        type: 'fixed',
        title: 'Transaction list scrolling',
        description:
          'Fixed category pickers closing immediately in scrolled transaction lists. Desktop lists now fit the space below page controls so the bottom is not pushed off-screen by a fixed table height.',
      },
      {
        type: 'fixed',
        title: 'Local saving and backup restores',
        description:
          'Fixed local save failures being silently ignored. A failed backup restore now keeps the current budget open instead of replacing it.',
      },
    ],
  },
  {
    version: 'v1.11.8',
    date: 'September 10, 2026',
    summary: 'Adds a Month to date report shortcut and self-host registration controls.',
    isLatest: false,
    items: [
      {
        type: 'new',
        title: 'Month to date reports',
        description:
          'Select Month to date directly in the pre-built reports’ date dropdown to report from the first of the current month through today.',
      },
      {
        type: 'new',
        title: 'Control self-host sign-ups',
        description:
          'Enable or disable public registration from the admin dashboard or CLI without restarting. When disabled, Sign up is hidden and sign-up links redirect to sign-in. Existing users can still sign in, and admins can create accounts.',
      },
    ],
  },
  {
    version: 'v1.11.7',
    date: 'September 8, 2026',
    summary: 'Fixes monthly credit-card calculations, YNAB imports, and dashboard spending totals.',
    isLatest: false,
    items: [
      {
        type: 'fixed',
        title: 'Monthly credit-card balances',
        description:
          'Monthly mode now funds earlier card purchases first and correctly handles refunds and positive card balances. Payment-category Activity and calculation details now reflect funding and payments separately.',
      },
      {
        type: 'fixed',
        title: 'YNAB income and transfer imports',
        description:
          'Ready to Assign correctly counts income within split transactions. Split transfers with empty memos are paired correctly, and import verification now includes credit-card payment categories.',
      },
      {
        type: 'fixed',
        title: 'Dashboard spending totals',
        description:
          'Refunds and other category inflows now reduce dashboard spending totals and category breakdowns.',
      },
    ],
  },
  {
    version: 'v1.11.6',
    date: 'September 5, 2026',
    summary:
      'Adds optional income categories, preserves more category history during deletion, and clarifies Cloud signup.',
    isLatest: false,
    items: [
      {
        type: 'new',
        title: 'Manage income categories',
        description:
          'Add, rename, and delete custom income categories in Budget Settings to organize analytics. All income categories contribute equally to Ready to Assign. The system Income category remains protected.',
      },
      {
        type: 'fixed',
        title: 'Preserve split and scheduled transaction categories',
        description:
          'Reassigning transactions before deleting a category now also moves split lines and scheduled transactions to the selected destination.',
      },
      {
        type: 'improved',
        title: 'Clearer Cloud signup',
        description:
          'Cloud signup now displays the 35-day trial, subscription pricing, and no-credit-card terms alongside account creation.',
      },
    ],
  },
  {
    version: 'v1.11.5',
    date: 'September 5, 2026',
    summary: 'Fixes YNAB import verification and selected-category overspending actions.',
    isLatest: false,
    items: [
      {
        type: 'fixed',
        title: 'Import YNAB plans with missing Money Movement history',
        description:
          'Direct YNAB imports no longer fail just because a month has no Money Movement records. Monthly assignments are preserved, and only assignments checked against available movement history are counted as verified.',
      },
      {
        type: 'fixed',
        title: 'Cover overspending for a selected category',
        description:
          'Cover overspending now stays visible in Quick Actions when you select a single category.',
      },
    ],
  },
  {
    version: 'v1.11.4',
    date: 'September 4, 2026',
    summary:
      'This patch adds report drill-downs and direct YNAB API imports, and fixes several transaction, account, and large-ledger issues.',
    isLatest: false,
    items: [
      {
        type: 'new',
        title: 'Inspect grouped values in spending reports and Money Map',
        description:
          'Other Spending can be expanded into its categories and reflected in the chart. Money Map can switch between groups and categories, and selecting a group opens a tiled category breakdown with a route back to the full map.',
      },
      {
        type: 'new',
        title: 'Import directly from the YNAB API',
        description:
          'A YNAB personal access token can be used to select and import a plan without creating a ZIP. Tokens are kept in memory for the import and are not stored by Budgero.',
      },
      {
        type: 'improved',
        title: 'Verify direct YNAB imports before saving',
        description:
          'Direct imports check source rows, account balances, category history, Money Movements, and Ready to Assign for every month. Source and account failures stop the import; category or Ready to Assign differences can be reviewed, removed, or accepted and retained in Import History.',
      },
      {
        type: 'improved',
        title: 'Preserve YNAB transfer, split, and debt semantics',
        description:
          'Transfers contained in YNAB splits are imported as individual transactions, while ordinary splits retain inflows and outflows. Mortgage and loan accounts reuse an identifiable YNAB payment category, and loan-engine interest that is not exported as a register entry is recorded as a visible adjustment.',
      },
      {
        type: 'fixed',
        title: 'Correct off-budget transfer reporting and transfer payees',
        description:
          'Spending reports now include categorized transfers to off-budget accounts. On-budget transfers no longer retain a payee, while transfers involving an off-budget account keep the account payee and the category used by Ready to Assign.',
      },
      {
        type: 'fixed',
        title: 'Transaction forms and details remain usable with long lists and text',
        description:
          'Account fields can be searched by name, split-detail memos wrap within the dialog, newly created debt categories appear without a reload, label colors are restored, and dialog background blur can be disabled in Appearance settings.',
      },
      {
        type: 'fixed',
        title: 'Reject unsafe exchange-rate calculations',
        description:
          'Exchange rates and converted milliunit values are validated before they reach account and query views, preventing an accidentally extreme rate from replacing the page with a runtime error.',
      },
      {
        type: 'improved',
        title: 'Reduce work when adding transactions to large ledgers',
        description:
          'Account registers use paged queries, transaction additions patch cached results instead of broadly rebuilding them, and large account pages render less data at once.',
      },
    ],
  },
  {
    version: 'v1.11.3',
    date: 'August 30, 2026',
    summary:
      'YNAB imports preserve more source data, split lines support payees, and reports sync with stable identifiers.',
    isLatest: false,
    items: [
      {
        type: 'improved',
        title: 'Preview and verify YNAB imports',
        description:
          'Budgero now inspects YNAB exports before importing, showing account, category, register-row, and split-transaction counts. Missing Plan.csv categories are created from the register, complete split sequences remain split transactions, likely credit cards are recognized, and imported budgets use monthly Ready to Assign and open immediately after onboarding.',
      },
      {
        type: 'new',
        title: 'Set payees on individual split lines',
        description:
          'Each line of a split transaction can now keep its own payee. Split editors and transaction details show those payees, and transaction queries and analytics use the split-level value where appropriate.',
      },
      {
        type: 'fixed',
        title: 'Keep report identifiers stable during sync',
        description:
          'Report and chart identifiers are now generated before mutations are synchronized, so creating, duplicating, and adding charts produces the same records on every device instead of triggering repeated catch-up snapshot recovery.',
      },
    ],
  },
  {
    version: 'v1.11.2',
    date: 'August 30, 2026',
    summary:
      'Recurring transactions now share the standard transaction form, while transfers, currency corrections, and large ledgers are more reliable.',
    isLatest: false,
    items: [
      {
        type: 'new',
        title: 'Create recurring transactions from the standard form',
        description:
          'The transaction form now includes a Make recurring switch with cadence, end, reminder, and status settings. Creating or editing recurring transactions uses the same familiar layout, and starting from either leg of a transfer preserves the complete transfer.',
      },
      {
        type: 'improved',
        title: 'Inspect and edit cross-currency transfer rates',
        description:
          "Transfers now expose their direct account-to-account rate separately from each account's budget valuation. Editing the direct rate updates the received amount, custom rates take precedence over fetched rates, and transaction-level overrides remain the highest priority.",
      },
      {
        type: 'fixed',
        title: 'Reliable transfer editing and undo history',
        description:
          'Undo and redo restore both transfer legs, rate changes refresh correctly after undo, and editing a rate no longer marks unrelated budget rates as overridden. Dates, memos, and labels stay independent per leg, while categories remain synchronized and on-budget transfers stay categorized as Transfers.',
      },
      {
        type: 'new',
        title: 'Choose how an account currency correction is applied',
        description:
          'When correcting an account created in the wrong currency, you can either convert its historical amounts or reinterpret the existing numbers as the new currency. Account currency labels now refresh immediately after the change.',
      },
      {
        type: 'improved',
        title: 'Faster large transaction histories and planning',
        description:
          'Desktop transaction lists are virtualized, table editors load only when needed, and balance, planning, and cache updates are batched more efficiently. Currency-rate fetching also avoids repeated work, improving responsiveness for large budgets.',
      },
      {
        type: 'fixed',
        title: 'Long transaction text stays readable',
        description:
          'Long memos and category names are now contained in transaction, projected, upcoming, and recurring views instead of overlapping nearby amounts and controls.',
      },
    ],
  },
  {
    version: 'v1.11.1',
    date: 'August 26, 2026',
    summary:
      'Split transactions now work correctly across currencies, alongside an Echo server security update.',
    isLatest: false,
    items: [
      {
        type: 'fixed',
        title: 'Split transactions in foreign-currency accounts',
        description:
          "Split amounts now use the account's currency while editing and save both native and budget-converted values. Foreign-currency splits reconcile exactly, remain editable in either currency view, and no longer leave an unsplit parent transaction behind if saving fails.",
      },
      {
        type: 'improved',
        title: 'Echo server security update',
        description:
          'Updated the Echo server framework to patch the encoded-path-separator vulnerability in its static-file handling.',
      },
    ],
  },
  {
    version: 'v1.11.0',
    date: 'August 24, 2026',
    summary:
      'Category balances are visible while selecting categories, transfers can record the received amount, and archived accounts are included in reports.',
    isLatest: false,
    items: [
      {
        type: 'new',
        title: 'Category balances in category selectors',
        description:
          "Category selectors now show each category's available balance for the current month, including while creating regular and split transactions.",
      },
      {
        type: 'new',
        title: 'Received amounts for cross-currency transfers',
        description:
          'Cross-currency transfers can now record the amount received in the destination account, with Budgero deriving and saving the implied exchange rate.',
      },
      {
        type: 'fixed',
        title: 'Archived accounts included in prebuilt reports',
        description:
          'Transactions from archived accounts are now included in prebuilt reports and statistics, so historical income and spending remain accurate.',
      },
    ],
  },
  {
    version: 'v1.10.1',
    date: 'August 19, 2026',
    summary:
      'Monthly Ready to Assign now accounts for money assigned in future months, YNAB imports recognise credit cards, and dependency security updates.',
    isLatest: false,
    items: [
      {
        type: 'improved',
        title: 'Monthly Ready to Assign deducts future assignments (YNAB-style)',
        description:
          'In Monthly mode, money already assigned in later months is now subtracted from the month you are viewing, so assigning ahead no longer leaves an inflated Ready to Assign behind. Like YNAB, the deduction is capped at what the month has left over: earlier months bottom out at zero, and any shortfall shows in the month where it was assigned. The Ready to Assign breakdown shows the new "Assigned in future months" line.',
      },
      {
        type: 'fixed',
        title: 'YNAB import creates credit cards as credit accounts',
        description:
          'Accounts listed under YNAB\'s "Credit Card Payments" group are now imported as credit cards, linked to their payment category instead of a duplicate, and their opening debt stays out of Ready to Assign, matching YNAB.',
      },
      {
        type: 'fixed',
        title: 'Long YNAB export file names no longer overflow the import form',
        description:
          'The chosen file name wraps instead of pushing the form wider than the dialog.',
      },
      {
        type: 'improved',
        title: 'Security dependency updates',
        description:
          'Updated frontend and server dependencies (including Next.js, PDF.js, Vitest and the Go toolchain/base images) to patch published security advisories.',
      },
    ],
  },
  {
    version: 'v1.10.0',
    date: 'August 18, 2026',
    summary:
      'Periodic goals (quarterly, every N months), recurring transactions that end, category-group budget shares, and more.',
    isLatest: false,
    items: [
      {
        type: 'new',
        title: 'Periodic goals: quarterly, every 6 months, or every N months',
        description:
          'Two new goal types — Periodic Allocation Target and Periodic Available Target — repeat on a rhythm you choose (a quarter, 6 months, or any 2–120 months) from a start date, with the goal amount applying to each cycle. The editor previews the current cycle and its target date. Yearly goals keep their target date and can repeat every year as before.',
      },
      {
        type: 'new',
        title: 'Recurring transactions can end',
        description:
          'A recurring transaction can now stop on a date or after a set number of occurrences — handy for loans, instalment plans and fixed-term subscriptions.',
      },
      {
        type: 'new',
        title: 'Category group percentages',
        description:
          "Turn on Settings → Budget Settings → Category Group Percentages to see each group's share of everything assigned in the month next to its name (Needs 50% / Wants 30% / Savings 20%).",
      },
      {
        type: 'new',
        title: 'Underfunded goals total in the budget context panel',
        description:
          'The Summary card now shows how much your goals still need this month, for the selected categories or the whole budget.',
      },
      {
        type: 'improved',
        title: 'Goal progress is cycle-aware everywhere',
        description:
          'The budget table, mobile category headers and the dashboard glance now measure recurring and target-date goals over their full cycle, matching the goal card. Assignment history is no longer capped at 12 months. Two long-standing yearly-cycle bugs are fixed: target dates on the 31st produced 11-month cycles, and Feb 29 targets rolled into March.',
      },
      {
        type: 'fixed',
        title: 'Shift-click multi-select in the desktop budget table',
        description:
          'Holding Shift while ticking category checkboxes now selects the whole range; shift-clicking rows no longer smears a text selection across the table.',
      },
    ],
  },
  {
    version: 'v1.9.3',
    date: 'August 18, 2026',
    summary:
      "Changing a recurring transaction's cadence now reschedules its upcoming occurrences, and sidebar sections can be collapsed.",
    isLatest: false,
    items: [
      {
        type: 'fixed',
        title: 'Recurring cadence changes reschedule upcoming occurrences',
        description:
          'Editing a recurring transaction from monthly to quarterly (or any other cadence) kept the previously generated upcoming dates and only added new ones after them. Pending occurrences are now regenerated from the new schedule; already posted or skipped ones are left untouched.',
      },
      {
        type: 'fixed',
        title: 'Due dates are labelled by day',
        description:
          'An occurrence due today no longer shows as "18 hours ago" by the evening. Due labels now read today, tomorrow, in N days, or N days ago.',
      },
      {
        type: 'fixed',
        title: 'Sidebar sections stay collapsed',
        description:
          'Collapsing Accounts, Reports, or Settings in the desktop sidebar while on one of its pages immediately re-expanded it. Sections now only auto-open when you navigate into them.',
      },
    ],
  },
  {
    version: 'v1.9.2',
    date: 'August 16, 2026',
    summary: '"Set memo" automation rules now work, and rule runs can be undone one after another.',
    isLatest: false,
    items: [
      {
        type: 'fixed',
        title: 'Rules with a "Set memo" action now update the memo',
        description:
          'A rule whose action set the memo text was silently ignored — running it reported zero transactions affected, and when combined with "Set category" only the category changed. Set memo now applies (and can be undone) like every other action.',
      },
      {
        type: 'fixed',
        title: 'Undo earlier rule runs',
        description:
          "After undoing a rule's most recent run, the run before it can now be undone as well. Previously only a single run per rule could ever be reverted.",
      },
      {
        type: 'fixed',
        title: 'Rule run history lists newest runs first',
        description:
          'Runs triggered within the same second no longer appear out of order in the history drawer.',
      },
    ],
  },
  {
    version: 'v1.9.1',
    date: 'August 12, 2026',
    summary: 'Ready to Assign now counts money moved in from your off-budget accounts.',
    isLatest: false,
    items: [
      {
        type: 'fixed',
        title: 'Transfers from off-budget accounts credit Ready to Assign',
        description:
          'Moving money from an off-budget account (savings, investments, or any tracking account) into an on-budget account now increases Ready to Assign — mirroring how transfers out to off-budget accounts already reduce it. Applies to both Cumulative and Monthly modes.',
      },
    ],
  },
  {
    version: 'v1.9.0',
    date: 'August 12, 2026',
    summary:
      'Ready to Assign can now work month-by-month like YNAB, and credit-card debt no longer hides in your budget.',
    isLatest: false,
    items: [
      {
        type: 'new',
        title: 'Monthly (YNAB-style) Ready to Assign',
        description:
          'Choose per budget how Ready to Assign is calculated. Monthly mode counts income through the month you are viewing and pulls last month’s overspending out of this month’s Ready to Assign — overspent categories reset instead of carrying a red balance forever. Cumulative (the original all-time total) stays the default; switch anytime in Settings → Budget Settings, and the Ready to Assign popover shows the full math for whichever mode is active.',
      },
      {
        type: 'new',
        title: 'Credit-card debt made visible',
        description:
          'Overspending on a credit card is now flagged in amber, distinct from cash overspend in red, because it becomes card debt rather than lost cash. Credit Card Payment categories show when they are underfunded against the card balance, and you can click through to see exactly which categories and months created the debt.',
      },
      {
        type: 'fixed',
        title: 'Split transactions in analytics',
        description:
          'Reports and analytics now expand split transactions into their individual lines, so category spending totals include money from splits.',
      },
      {
        type: 'fixed',
        title: 'Security hardening',
        description: 'Hardened API rate limiting and workspace-invite handling.',
      },
    ],
  },
  {
    version: 'v1.8.1',
    date: 'August 8, 2026',
    summary: 'Hotfix: custom exchange rates now pin account balances, as they always should have.',
    isLatest: false,
    items: [
      {
        type: 'fixed',
        title: 'Custom rates take precedence over market revaluation',
        description:
          'If a custom date-range rate covers today, account balances are now pinned to it instead of drifting with daily market rates. Adding, editing, or deleting a custom rate also trues balances up immediately instead of waiting for the next app launch.',
      },
    ],
  },
  {
    version: 'v1.8.0',
    date: 'August 8, 2026',
    summary:
      'Crypto accounts arrive, balances follow daily market rates, and exchange rates now come from an open dataset — no API key, self-hostable.',
    isLatest: false,
    items: [
      {
        type: 'new',
        title: 'Crypto accounts',
        description:
          'Track 25 cryptocurrencies — Bitcoin, Ethereum, Solana and more — each with its own icon and full 8-decimal precision. Crypto accounts are tracking-only (off-budget) by default so market swings never distort your envelopes, and they get their own Crypto section on the accounts page and in net-worth views.',
      },
      {
        type: 'new',
        title: 'Balances that follow the market',
        description:
          'Accounts held in another currency — fiat or crypto — now revalue daily to market rates, so their balance in your budget currency reflects what they are actually worth. A value-change stat on each account shows the 30-day market impact with a mini chart, and Ready to Assign follows market moves for on-budget accounts.',
      },
      {
        type: 'new',
        title: 'Daily exchange rates, no API key',
        description:
          'Exchange rates now come from an open daily dataset covering ~350 currencies including crypto — no signup, no rate limits, and self-hosters can point at their own mirror. Rates are cached per day with a configurable retention window, and when you are offline you can enter a rate by hand (prefilled with the closest cached one) — it trues up automatically when you reconnect.',
      },
      {
        type: 'new',
        title: 'Net worth by asset type',
        description:
          'The Wealth report gained a By Type view that stacks your net worth into cash, investments, crypto, retirement, real estate, other assets, and debt — so you can see composition at a glance, not just the total.',
      },
      {
        type: 'improved',
        title: 'Accounts you can tell apart',
        description:
          'Every account now carries a type-colored icon — and crypto accounts show their coin — across the sidebar, account lists, and pickers.',
      },
      {
        type: 'fixed',
        title: 'Backup reminder kept nagging on iPhone',
        description:
          'iOS Safari cancels in-flight requests the moment the download sheet appears, so backups were never recorded as done. Backups are now registered before the download starts, and the reminder respects them.',
      },
    ],
  },
  {
    version: 'v1.7.0',
    date: 'August 4, 2026',
    summary:
      'Budgero goes open source under the AGPL, and pricing gets radically simpler: $4/month or $35/year, tax included, everywhere in the world.',
    isLatest: false,
    items: [
      {
        type: 'new',
        title: 'Budgero is open source',
        description:
          'The full source code is now licensed under the AGPL-3.0, an OSI-approved open source license — read it, audit the encryption, build from source, self-host it freely. Contributions are open too: pull requests are welcome on GitHub under a DCO, with CI running on every PR.',
      },
      {
        type: 'new',
        title: 'One simple price, tax included',
        description:
          'Budgero Cloud is now $4/month or $35/year — down from $7.99/$60 — and prices are tax-inclusive worldwide: the price you see is exactly what you pay, no VAT or sales tax added at checkout. Existing subscribers have been moved to the new lower price at their next renewal, automatically.',
      },
      {
        type: 'deprecated',
        title: 'Trial rewards program retired',
        description:
          'With one flat low price there is nothing left to discount, so the earn-a-discount trial program is gone — along with the discount emails and the trial activity tracking that powered it. At $35/year, the new full price is lower than the old price with the best earned discount applied.',
      },
      {
        type: 'improved',
        title: 'A smaller privacy surface',
        description:
          'Removing the rewards program also removed its server-side behavior counters and the associated privacy toggle — there is simply nothing to track anymore. Trial reminder emails still exist, but they are plain reminders now: no codes, no pitches.',
      },
    ],
  },
  {
    version: 'v1.6.1',
    date: 'July 25, 2026',
    summary:
      "Smarter imports that read dates and signs the way your bank writes them, payee bulk management, and categories that fill themselves in from each payee's history.",
    isLatest: false,
    items: [
      {
        type: 'new',
        title: 'Category memory for payees',
        description:
          "When you add a transaction for a payee you've used before, the category pre-fills with whatever you chose last time — marked with an amber ring so you can tell it apart from rule autofills. Explicit autofill rules still win, your own picks always win, and you can turn it off under Settings → Automation Rules.",
      },
      {
        type: 'new',
        title: 'Bulk payee management',
        description:
          'Manage Payees now has checkboxes: select several payees — or every unused one with a single click — and remove them in one confirmed action, with one undo step. The confirmation tells you how many transactions are affected before you commit.',
      },
      {
        type: 'improved',
        title: 'Update notifications for self-hosted servers',
        description:
          'Your server now notices when a newer Budgero release is available and shows a banner in the app. The check is anonymous and can be disabled entirely with UPDATE_CHECK_DISABLED=true.',
      },
      {
        type: 'fixed',
        title: 'Imports no longer stamp every transaction with today’s date',
        description:
          'Date columns carrying a timestamp ("31/01/2024 12:30") or compact dates ("20240131") now parse correctly instead of silently falling back to the import date. When a date genuinely can’t be read, the preview now says so loudly instead of failing quietly.',
      },
      {
        type: 'fixed',
        title: 'Import amounts keep their sign in more formats',
        description:
          'Amounts like "$-54.20", Unicode minus signs from PDF statements, and the European whole-amount style "12,–" now import with the correct sign, so spending no longer occasionally lands as income.',
      },
      {
        type: 'fixed',
        title: 'Shared workspace reliability',
        description:
          'Workspaces created on older versions now open reliably, the audit log survives deleting a budget, and locked shared workspaces show accurate messaging instead of a dead-end subscribe prompt.',
      },
    ],
  },
  {
    version: 'v1.6.0',
    date: 'July 23, 2026',
    summary:
      'A rebuilt Analytics experience: question-based reports, a scenario planner for stress-testing your finances, and smoother charts everywhere.',
    items: [
      {
        type: 'new',
        title: 'Prebuilt reports, rebuilt around your questions',
        description:
          'The Prebuilt page now answers the questions a household actually asks: Wealth (am I growing?), Spending (where does it go?), In vs Out (within our means?), Plan vs Reality (did the budget hold?), Money Map, and Ledger. Each report opens with plain-language insights computed from your data, and the Wealth forecast shows an honest 95% confidence band with real statistics.',
      },
      {
        type: 'new',
        title: 'Scenario Planner',
        description:
          "Stress-test your finances: start from your selected accounts' balance, scale monthly income and spending with sliders, drop in dated one-off inflows or outflows (a car repair, a bonus), and see exactly when — or whether — your balance would break. Choose between four baseline models, from flat average to seasonal patterns, and save scenarios to revisit later.",
      },
      {
        type: 'new',
        title: 'Plan vs Reality report',
        description:
          'The report only a budgeting app can make: what you assigned each month against what you actually spent, which categories chronically run over their assignment, and how well your goals are being funded.',
      },
      {
        type: 'new',
        title: 'Categories on recurring transfers to off-budget accounts',
        description:
          'A recurring transfer that leaves your budget (like monthly investing) can now book as spending in a category of your choice, instead of always reducing Ready to Assign.',
      },
      {
        type: 'new',
        title: 'Automatic reverse exchange rates',
        description:
          'Adding a custom exchange rate now shows the computed reverse rate and creates it as its own entry by default — no more entering both directions by hand.',
      },
      {
        type: 'improved',
        title: 'Faster, theme-native charts everywhere',
        description:
          'Every chart in the app moved to a new rendering engine: noticeably smoother interactions, tooltips and colors that follow all five themes and your chosen typeface, and a consistent visual language across analytics, dashboards, and AI-generated charts.',
      },
      {
        type: 'improved',
        title: 'Date range picker',
        description:
          "Explicit Start and End fields above the calendar — click a field, then a date, and you always know which end you're setting. Presets no longer truncate.",
      },
      {
        type: 'fixed',
        title: 'Saved report and AI chart date errors',
        description:
          'Dashboard widgets and AI charts whose queries compared dates with typed DATE literals failed with a binder error. They run again, including previously saved ones.',
      },
      {
        type: 'fixed',
        title: 'Theme toggle reverting itself',
        description:
          "Switching light/dark could silently revert if the preference save hadn't reached the server yet. Your choice now sticks.",
      },
      {
        type: 'fixed',
        title: 'Layout polish for monospace themes',
        description:
          'Badges, toggles, and dropdowns no longer truncate or wrap awkwardly under the wider monospace typefaces.',
      },
    ],
  },
  {
    version: 'v1.5.4',
    date: 'July 18, 2026',
    summary:
      'Precision fixes for no-decimal currency formats, zero-balance reconciliation, and self-host CLI repairs.',
    items: [
      {
        type: 'fixed',
        title: 'Amount entry under no-decimal display formats',
        description:
          'With a whole-number display format selected (like RSD 4,585), edit fields silently dropped cents: decimals couldn\'t be typed, editing an amount truncated its fraction, and split transactions with a fractional remainder showed "Remaining 0" while refusing to save. Edit surfaces now always accept and show full precision — your display format stays whole-number everywhere else.',
      },
      {
        type: 'fixed',
        title: 'Reconciling accounts with zero balance',
        description:
          'Confirming a balance of 0 in the reconcile dialog never enabled the Reconcile button. Entering the seeded value now counts as confirming it, so empty accounts can be reconciled again.',
      },
      {
        type: 'fixed',
        title: 'Currency symbols during onboarding',
        description:
          'Picking a currency from the full-list dropdown (rather than the quick-pick tiles) showed "$" on the accounts, goal, and summary steps regardless of your choice. All 168 currencies now display their correct symbol or code.',
      },
      {
        type: 'fixed',
        title: 'Self-host admin CLI',
        description:
          'Admin commands (list-users, reset-password, …) opened a fresh empty database instead of the server\'s, reporting "user not found" for accounts that exist. They now target the self-host database, and errors print once instead of twice.',
      },
      {
        type: 'improved',
        title: 'Sidebar shows active accounts first',
        description:
          'When the account list is truncated behind "Show All", accounts with a zero balance are now hidden first, so accounts you actually use stay visible.',
      },
    ],
  },
  {
    version: 'v1.5.3',
    date: 'July 15, 2026',
    summary: 'Recurring transfers between accounts, smarter YNAB imports, and security hardening.',
    items: [
      {
        type: 'new',
        title: 'Recurring transfers',
        description:
          "Recurring transactions now support a third type alongside Income and Bill: Transfer. Schedule money to move between two accounts on a cadence — both sides show up in each account's register and upcoming panel, cross-currency amounts are converted automatically, and marking an occurrence ready posts both sides as a regular linked transfer.",
      },
      {
        type: 'new',
        title: 'Create recurring transactions from existing ones',
        description:
          'Select a transaction on the All Transactions page and turn it into a recurring template straight from the toolbar — the editor opens prefilled with the amount, account, and category. Previously this was only available on individual account pages.',
      },
      {
        type: 'improved',
        title: 'YNAB export guide is front and center',
        description:
          'The export instructions now open by default when importing from YNAB, appear during onboarding, and link to the full guide — so the format settings that make an import lossless are hard to miss.',
      },
      {
        type: 'improved',
        title: 'Security hardening',
        description:
          'The offline mutation queue and your remembered master password are now encrypted at rest under a non-extractable device key, and key handling has been tightened across the board.',
      },
      {
        type: 'fixed',
        title: 'US date formats in YNAB imports',
        description:
          'YNAB exports using MM/DD/YYYY dates were parsed day-first, silently shifting transaction dates. Budgero now detects the date order from the file itself, so imports come through correctly regardless of your YNAB date format.',
      },
      {
        type: 'fixed',
        title: 'Push API panel on mobile',
        description:
          'The "Show Budget, Account, Category & Payee IDs" button no longer overflows its card on small screens.',
      },
    ],
  },
  {
    version: 'v1.5.2',
    date: 'July 10, 2026',
    summary: 'Timezone-safe date handling across app and core.',
    items: [
      {
        type: 'fixed',
        title: 'Timezone-safe date handling',
        description:
          'Dates could shift by one day depending on your timezone — affecting month labels, spending charts, date filters, statement imports, and recurring schedules. All date handling is now timezone-safe. If you use recurring transactions, take a moment to confirm your bill dates are still correct.',
      },
      {
        type: 'improved',
        title: 'Offline access for trial and lifetime users',
        description:
          'Trial and lifetime plans now include the offline entitlement, so the app keeps working without a connection for the full length of your plan.',
      },
    ],
  },
  {
    version: 'v1.5.1',
    date: 'July 8, 2026',
    summary: 'Fixes a self-host login loop introduced in v1.5.0 — all self-hosters should upgrade.',
    items: [
      {
        type: 'fixed',
        title: 'Self-host login loop',
        description:
          'Signing in on a self-hosted instance could immediately bounce back to the login screen even with correct credentials. Sessions are now established reliably after signing in.',
      },
      {
        type: 'fixed',
        title: 'Failed sign-ins now show an error',
        description:
          'Entering a wrong username or password on a self-hosted instance now shows an invalid-credentials message instead of silently reloading the page.',
      },
    ],
  },
  {
    version: 'v1.5.0',
    date: 'July 8, 2026',
    summary:
      'Budgero goes source-available: a precision money engine, opt-in analytics, hardened multi-device sync that delivers imports everywhere instantly, and a long list of fixes.',
    items: [
      {
        type: 'new',
        title: 'Budgero is source-available',
        description:
          'The Budgero source code is now published on GitHub. Development history is public from this release onward, and self-hosters can build straight from source.',
      },
      {
        type: 'new',
        title: 'Integer-precision money engine',
        description:
          'Every amount is now stored, computed, and synced as integer milliunits — no more floating-point drift in balances, goals, or currency conversions. Existing budgets migrate automatically, and devices on older versions are prompted to update before syncing.',
      },
      {
        type: 'new',
        title: 'Analytics is now opt-in',
        description:
          'Product analytics is disabled by default for new accounts and undecided devices. Trial-reward signals moved behind their own separate toggle, and all Google tracking has been removed.',
      },
      {
        type: 'new',
        title: 'Fully self-contained app',
        description:
          'Fonts, flag icons, the PDF worker, and the SQLite engine are now bundled with the app — zero runtime CDN dependencies, so Budgero works fully offline and self-hosted instances never call out.',
      },
      {
        type: 'new',
        title: 'Credit-card payment insights',
        description:
          'The CC Payment category popover now shows the card balance, flags over-assignment with a warning badge, and offers a one-click reduction back to Ready to Assign.',
      },
      {
        type: 'new',
        title: 'Support Budgero with a donation',
        description:
          'A new donate page (pay-what-you-want) is linked from the website and from the About page on self-hosted builds.',
      },
      {
        type: 'improved',
        title: 'Imports reach all your devices instantly',
        description:
          'YNAB imports and database restores now propagate live to your other open devices — previously they stayed invisible (and could even be overwritten) until a reload.',
      },
      {
        type: 'improved',
        title: 'Sync engine hardening',
        description:
          'Mutations are delivered at-least-once with server acknowledgements, version gaps are detected and repaired, snapshot uploads are debounced and bound to their exact log position, and restores re-apply queued local changes safely.',
      },
      {
        type: 'improved',
        title: 'Server security hardening',
        description:
          'Login rate-limiting, a registration toggle for self-hosted instances, a stricter Content-Security-Policy, WebSocket origin checks, and fail-closed authorization checks.',
      },
      {
        type: 'improved',
        title: 'Faster bulk operations',
        description:
          'Auto-assign and cover-overspending use a single batch operation, and bulk transaction edits refresh the UI once instead of per row.',
      },
      {
        type: 'fixed',
        title: 'YNAB import puts income in Income',
        description:
          'Starting balances, wages, and balance adjustments ("Inflow: Ready to Assign") imported into Uncategorized instead of Income. New imports categorize them correctly.',
      },
      {
        type: 'fixed',
        title: 'Startup and workspace-join hangs',
        description:
          'Fixed a race that could park the app forever on "Opening your local workspace", and another that left invite redemptions stuck on "Loading budgets…" until a manual reload.',
      },
      {
        type: 'fixed',
        title: 'Currency display consistency',
        description:
          'Amount labels and account-currency fallbacks follow your budget’s display currency (some spots assumed USD), and transfer legs keep their value when you override an exchange rate.',
      },
      {
        type: 'fixed',
        title: 'Clearer "Apply last month" feedback',
        description:
          'Applying last month’s assignments when nothing was assigned last month now says so, instead of showing a misleading "select at least one category" error.',
      },
      {
        type: 'fixed',
        title: 'Empty workspaces no longer trap you',
        description:
          'The "Create Your First Budget" screen now lets you switch to any of your other workspaces, so opening a workspace without budgets no longer forces you to create one there just to get into the app.',
      },
    ],
  },
  {
    version: 'v1.4.20',
    date: 'June 29, 2026',
    summary:
      'Today’s transactions stop showing the upcoming flag, your number format updates live, and a mobile layout fix for the upcoming-transactions total.',
    items: [
      {
        type: 'fixed',
        title: 'Today’s transactions are no longer marked upcoming',
        description:
          'Transactions dated today no longer pick up the “upcoming” flag in your transaction lists — including when you leave Budgero open past midnight.',
      },
      {
        type: 'fixed',
        title: 'Number format updates instantly on account pages',
        description:
          'Changing your budget’s number format now updates the amounts shown on individual account pages right away, instead of only after a reload.',
      },
      {
        type: 'fixed',
        title: 'Upcoming total stays on one line on mobile',
        description:
          'In an account’s Upcoming transactions header on mobile, the amount and its +/− sign no longer wrap onto separate lines.',
      },
    ],
  },
  {
    version: 'v1.4.19',
    date: 'June 27, 2026',
    summary:
      'A quick Add Transaction button, in-app feedback, and a batch of fixes across budgeting, undo, the spending overview, and large imports.',
    items: [
      {
        type: 'new',
        title: 'Add a transaction from anywhere',
        description:
          'A new Add Transaction button in the desktop header opens the add form from any page, including budget planning, so you no longer need to know the keyboard shortcut. The shortcut (⌘⌥T / Ctrl+Alt+T) is shown right on the button.',
      },
      {
        type: 'new',
        title: 'Send feedback from inside the app',
        description:
          'A built-in feedback widget lets you share ideas and report issues without leaving Budgero — open it from the feedback buttons in the app or the About links.',
      },
      {
        type: 'new',
        title: 'See your database size',
        description:
          'The Data Management page in Settings now shows how much space your local database is using.',
      },
      {
        type: 'new',
        title: 'Bring your own AI provider',
        description:
          'If you use Budgero’s optional AI assistant, you can now connect a cloud provider with your own API key — your data only leaves your device when you choose this. The assistant can also run budget analytics, draw charts, and edit transactions for you.',
      },
      {
        type: 'improved',
        title: 'Cleaner transaction quick view',
        description:
          'Opening a transaction from the spending overview now shows a single, clean card — no more nested box-in-a-box or a stray collapse button that did nothing.',
      },
      {
        type: 'improved',
        title: 'Tidier budget header on mobile',
        description:
          'On smaller screens the budget header stacks into a full-width Ready to Assign with a centered month switcher, so it stays readable.',
      },
      {
        type: 'fixed',
        title: 'Image attachments in AI chat',
        description:
          'Attaching an image to the assistant now works in the hosted app — it was previously blocked by a browser security policy.',
      },
      {
        type: 'fixed',
        title: 'Labels in the spending overview',
        description:
          'The quick-view editor opened from the spending overview now shows the transaction’s actual label instead of always showing “No label.”',
      },
      {
        type: 'fixed',
        title: 'Remembering “No label”',
        description:
          'With “Remember last category, payee, account” turned on, saving a transaction with no label is now remembered, instead of re-applying your previous label to the next one.',
      },
      {
        type: 'fixed',
        title: 'Undo from the activity log refreshes instantly',
        description:
          'Undoing a change from the activity log now updates the screen right away, instead of needing a manual reload.',
      },
      {
        type: 'fixed',
        title: 'Budget category stays put',
        description:
          'Collapsing or expanding groups, and switching months, no longer loses or jumps away from the category you had selected.',
      },
      {
        type: 'fixed',
        title: 'Chart date labels no longer clipped',
        description:
          'Rotated date labels along the bottom of charts now have room to render fully instead of being cut off.',
      },
      {
        type: 'fixed',
        title: 'Reliable saving of large changes',
        description:
          'Fixed a crash that could happen when encrypting very large changes, such as importing a big file.',
      },
    ],
  },
  {
    version: 'v1.4.18',
    date: 'June 19, 2026',
    summary:
      'Search your account lists, plus reliability fixes for reconciliation and CSV imports.',
    items: [
      {
        type: 'new',
        title: 'Search your account lists',
        description:
          'Filter your accounts by name in the sidebar and on the All Accounts page. Search appears automatically once you have enough accounts, and the mobile account dropdown is now capped so long lists stay manageable.',
      },
      {
        type: 'fixed',
        title: 'More reliable reconciliation',
        description:
          'Reconcile now targets your actual balance as of today instead of a balance that bakes in future-dated transactions, so the adjustment matches what you expect. The difference updates live as you type, a matching balance no longer shows a phantom "-0.00", and the dialog layout is cleaned up on mobile.',
      },
      {
        type: 'fixed',
        title: 'Imports no longer drop rows',
        description:
          'Fixed an issue where some rows could be silently skipped during a CSV import, and account balances now recalculate correctly when you undo an import.',
      },
    ],
  },
  {
    version: 'v1.4.17',
    date: 'June 17, 2026',
    summary:
      'Reorder your accounts, see recurring transactions projected into your register and reports, fund goals in a click, and a fresh settings guide.',
    items: [
      {
        type: 'new',
        title: 'Reorder your accounts',
        description:
          'Set the order accounts appear in the sidebar and mobile navigation from Settings → Appearance. Use the up/down arrows to move an account a step at a time; on-budget and off-budget accounts are ordered separately.',
      },
      {
        type: 'new',
        title: 'Cashflow projections in your register and reports',
        description:
          'Extend an account register or a report past today and Budgero projects your unconfirmed recurring transactions inline — read-only rows marked with a badge, flowing into a running balance so you can see where an account is heading. Reports gain Next 30 days and Next 3 months presets.',
      },
      {
        type: 'new',
        title: 'Fund a goal in one click',
        description:
          'New quick actions in the category context panel let you fully fund a goal, or pull back overfunding, without doing the math yourself.',
      },
      {
        type: 'improved',
        title: 'Collapsible payoff simulator',
        description:
          'The debt payoff simulator now collapses to a compact payoff summary and remembers whether you left it open, so the page stays focused until you want the details.',
      },
      {
        type: 'improved',
        title: 'Overspending quick action',
        description:
          'A category with a negative Available now offers a one-click action to cover the overspending. Pull the money from Ready to Assign or from any other category that has Available to spare, right from the popover.',
      },
      {
        type: 'improved',
        title: 'Clearer upcoming and projected icons',
        description:
          'Upcoming and projected transactions now use calendar and repeat icons instead of a sparkle, making it obvious at a glance which entries are scheduled versus recurring.',
      },
      {
        type: 'improved',
        title: 'New settings guide in the docs',
        description:
          'A Personalizing Budgero guide now documents themes and fonts, desktop and mobile budget table layouts, account order, the default home page, privacy mode, installing the app, and the over-assignment toggle.',
      },
      {
        type: 'fixed',
        title: 'No more phantom over-assignment popup',
        description:
          'Amounts are rounded before the over-assignment check, so a rounding remainder no longer triggers an overage warning for an overage of 0.00.',
      },
      {
        type: 'fixed',
        title: 'Marked-ready recurring entries leave the upcoming panel',
        description:
          "Occurrences you've already marked ready no longer linger in the account's upcoming panel, and the panel now surfaces the next genuinely due occurrence.",
      },
      {
        type: 'fixed',
        title: 'More accurate yearly goal pacing',
        description:
          'Yearly goal progress is now cycle-aware with an even-split pace and pace-based overfunding, so the amount needed this month reflects where you actually are in the year.',
      },
    ],
  },
  {
    version: 'v1.4.16',
    date: 'June 11, 2026',
    summary:
      'Editable split totals, an upcoming-transactions card that knows about scheduled one-offs, and a round of credit-card, privacy, and recurring fixes.',
    items: [
      {
        type: 'new',
        title: "Edit a split transaction's total",
        description:
          'The original amount is no longer locked while editing splits. Change the total right in the split editor — on desktop and mobile — and re-balance the lines; the transaction updates in one save.',
      },
      {
        type: 'new',
        title: 'Upcoming transactions card covers scheduled one-offs',
        description:
          'The dashboard card now shows future-dated transactions you entered manually (up to 3 months ahead) alongside the next charge of each recurring series, and says exactly how far it looks. Tap a recurring item to jump to its account, or a scheduled one to edit it on the spot.',
      },
      {
        type: 'improved',
        title: 'Faster transfers',
        description:
          'Removed an artificial delay in transfer processing — moving money between accounts now completes about a second faster.',
      },
      {
        type: 'fixed',
        title: 'Privacy mode masks every number on the budgeting screen',
        description:
          'Toggling the privacy mask sometimes left amounts unmasked (or stuck masked) in the budgeting view, goal text, the assign menu, and the spending drawer. The toggle now applies everywhere, instantly.',
      },
      {
        type: 'fixed',
        title: 'Recurring transactions always post on their due date',
        description:
          'Marking an occurrence ready from the account page dated the transaction today instead of its due date. Both surfaces now post on the due date, as promised in the confirmation dialog.',
      },
      {
        type: 'fixed',
        title: 'Split credit-card spending funds the CC Payment category',
        description:
          'Credit-card spending recorded as a split transaction contributed nothing to "Funded from spending", leaving the CC Payment category negative after a payment even when fully budgeted.',
      },
      {
        type: 'fixed',
        title: 'Debt categories created when an account becomes a credit card or loan',
        description:
          "Changing an existing account's type to credit card or loan now creates its CC Payment or Liabilities category, just like creating the account with that type from the start.",
      },
      {
        type: 'fixed',
        title: 'CC and loan category links survive account edits',
        description:
          'Saving the account edit form could silently detach a credit card or loan from its payment category, breaking rename syncing. Links are now preserved through edits and renames.',
      },
    ],
  },
  {
    version: 'v1.4.15',
    date: 'June 10, 2026',
    summary:
      'Payee and label spending charts in Reports, a denser Planning page, and a batch of transaction and goal fixes.',
    items: [
      {
        type: 'new',
        title: 'Payee and label spending charts',
        description:
          'Reports now include donut charts breaking down your spending by payee and by label, alongside the existing category view.',
      },
      {
        type: 'improved',
        title: 'Denser, more polished Planning page',
        description:
          'A compact toolbar with the Ready-to-Assign chip and month navigation, tighter table rows, and smarter side-panel cards mean more of your budget fits on screen at once.',
      },
      {
        type: 'fixed',
        title: 'Split transactions on budgets created without starter categories',
        description:
          'Adding a split transaction on a budget created with "create default categories" unchecked failed with an error. Every budget now includes the few built-in categories Budgero relies on, and existing budgets repair themselves automatically.',
      },
      {
        type: 'fixed',
        title: 'Split totals are clearly read-only on desktop',
        description:
          "A split transaction's total is the sum of its lines, so the parent amount field is now read-only with a short explainer instead of silently ignoring edits.",
      },
      {
        type: 'fixed',
        title: 'Decimal goal targets on desktop',
        description: 'The goal target amount field on desktop now accepts decimal values.',
      },
      {
        type: 'fixed',
        title: 'Trial rewards no longer blocked by declining cookies',
        description:
          'Declining the analytics cookie banner also stopped trial-reward progress from being recorded. Reward progress is functional and contains no personal data, so it is now tracked regardless of cookie choice.',
      },
    ],
  },
  {
    version: 'v1.4.14',
    date: 'June 8, 2026',
    summary:
      'A faster month picker in Planning, onboarding refinements, and a YNAB transfer-import fix.',
    items: [
      {
        type: 'new',
        title: 'Tell us how you found Budgero',
        description:
          'A quick, optional question during onboarding asks where you heard about us, so we know where to focus.',
      },
      {
        type: 'improved',
        title: 'Jump between months faster in Planning',
        description:
          'The month label in Planning is now a picker: click it to open a year-and-month grid and jump straight to any month, instead of stepping through one at a time.',
      },
      {
        type: 'improved',
        title: 'New accounts open to Planning',
        description:
          'New sign-ups now land on the Planning view by default. You can change your starting page anytime in Settings → Appearance → Default Home.',
      },
      {
        type: 'improved',
        title: 'Clearer file picker for YNAB import',
        description:
          'The YNAB import dialog now shows an upload icon and the name of the file you selected.',
      },
      {
        type: 'fixed',
        title: 'YNAB transfers now import correctly',
        description:
          'Importing a YNAB export now categorizes both sides of an account transfer as transfers, instead of leaving the outgoing side Uncategorized.',
      },
    ],
  },
  {
    version: 'v1.4.13',
    date: 'June 5, 2026',
    summary: 'Bug fixes for category reassignment and multi-currency credit-card payments.',
    items: [
      {
        type: 'fixed',
        title: 'Category deletions no longer duplicate assignments',
        description:
          'When deleting a category and transferring its assignments to another category that already had an assignment for the same month, the amounts are now merged into a single row instead of creating a duplicate. This prevents the target category from showing doubled (or tripled) values in the budget.',
      },
      {
        type: 'fixed',
        title: 'Multi-currency credit-card payments now convert correctly',
        description:
          'Using the quick Pay button on a CC Payment row to pay from an account with a different currency now converts the amount from budget currency to each account currency independently. Previously, paying a USD card from a EUR account could send the wrong converted amount, leading to unexpected overspending or underpayment in the CC Payment category.',
      },
    ],
  },
  {
    version: 'v1.4.12',
    date: 'May 14, 2026',
    summary: 'Credit-card payment polish in Planning and an in-app feedback widget.',
    items: [
      {
        type: 'new',
        title: 'Send feedback from inside the app',
        description:
          'A new icon in the header opens a small dialog for bug reports, ideas, and praise. We see the message along with your screen path and app version so we can act on it. Available on the hosted plan.',
      },
      {
        type: 'new',
        title: 'Pay a credit card from the Planning view',
        description:
          'Clicking the Available amount on a CC Payment row now opens a focused popover: pick a source account, confirm the amount, hit Pay. Budgero records the transfer in one shot — no need to detour through the transactions screen.',
      },
      {
        type: 'new',
        title: 'See card payments at a glance',
        description:
          "Clicking the Activity amount on a CC Payment row opens a list of this month's transfers covering that card, with a running total and per-row delete.",
      },
      {
        type: 'improved',
        title: 'Paper theme: radio buttons are visible again',
        description:
          'On the Appearance settings page and other pickers, the selection circles were nearly invisible against the cream background. They now mirror the checkbox treatment — clear outline when unselected, dark fill with a white dot when selected.',
      },
      {
        type: 'fixed',
        title: 'Credit-card available amounts are now per-card',
        description:
          "When you had multiple credit cards on budget, every card's CC Payment row showed the same Available amount — the funded total was being summed across all cards instead of attributed to the card that did the spending. Each card now shows what was funded by its own purchases (split proportionally when several cards shared a category).",
      },
    ],
  },
  {
    version: 'v1.4.11',
    date: 'May 4, 2026',
    summary:
      'Trial rewards: earn up to 35% off the yearly plan by building real budgeting habits. Plus a longer trial, more import formats, and bug fixes.',
    items: [
      {
        type: 'new',
        title: 'Trial rewards — earn up to 35% off the yearly plan',
        description:
          'Build real budgeting habits during your trial and unlock a discount on the yearly plan: 10% for logging transactions on 7 of your first 10 days (Foundation), 20% for reconciling an account and funding a goal (Discipline), and 35% for using the budget across two calendar months (Persistence). Earned discounts apply automatically at checkout for 24 months.',
      },
      {
        type: 'new',
        title: 'Free trial extended to 35 days',
        description:
          'New signups now get 35 days to try Budgero, up from 14. More time to import accounts, build a budget, and see whether the manual workflow clicks for you.',
      },
      {
        type: 'new',
        title: 'Import OFX, QFX, QIF, and CAMT.053 statements',
        description:
          'In addition to CSV, the import flow now reads OFX/QFX (most US banks), QIF (legacy Quicken exports), and CAMT.053 XML (European bank statements). Latin-1 encoded files are detected automatically.',
      },
      {
        type: 'new',
        title: 'Budget switcher grouped by workspace',
        description:
          'When you have access to multiple workspaces the budget picker now groups budgets under their workspace, with inline workspace switching from the same menu.',
      },
      {
        type: 'fixed',
        title: 'Move money back to Ready to Assign',
        description:
          'Picking "Ready to Assign" as the destination in the move-money popover now enables the Move button. Previously the button stayed disabled and the move was impossible.',
      },
      {
        type: 'fixed',
        title: 'Yearly goal status no longer shows amber when on track',
        description:
          "The status dot in the budget planner now uses the same calculation as the goal-progress card, so a yearly goal with this month's milestone met shows green instead of amber.",
      },
      {
        type: 'fixed',
        title: 'Under/overfunded filters work correctly for yearly goals',
        description:
          "The category filter chips on the budget planner now correctly identify under- and overfunded yearly goals based on this month's milestone, not the full annual target.",
      },
    ],
  },
  {
    version: 'v1.4.10',
    date: 'April 27, 2026',
    summary: 'New onboarding flow, workspace sharing, and consent banner.',
    items: [
      {
        type: 'new',
        title: 'Guided onboarding for new accounts',
        description:
          'A 13-step flow walks new users through the zero-based budgeting idea, master password, currency, accounts, categories, a starter goal, and theme. Existing users are unaffected.',
      },
      {
        type: 'new',
        title: 'Share a workspace via /join links',
        description:
          'Workspace owners can invite collaborators with a zero-knowledge /join URL — the secret rides in the URL fragment so the server never sees it. Brand-new invitees get a shortened 3-step onboarding that joins the existing workspace instead of creating a new one.',
      },
      {
        type: 'new',
        title: 'Cookie consent banner',
        description:
          'A Klaro-powered consent banner now runs across the marketing site and app. PostHog stays uninitialized until the visitor accepts.',
      },
    ],
  },
  {
    version: 'v1.4.9',
    date: 'April 21, 2026',
    summary: 'Redesigned goals with four clear goal types.',
    items: [
      {
        type: 'new',
        title: 'Four clear goal types',
        description:
          'Goals now come in four self-explanatory types: Monthly Available Target, Monthly Allocation Target, Yearly Allocation Target, and Yearly Available Target. The old spending/savings toggle is gone — pick what you actually want to track and the math follows.',
      },
      {
        type: 'new',
        title: 'Recurring yearly goals',
        description:
          'Annual expenses like car registration or insurance can now recur automatically. Set the target date once — the goal resets each year and carries planning forward without manual intervention.',
      },
      {
        type: 'improved',
        title: 'Clearer goal progress',
        description:
          'Goal cards now show exactly how much to allocate this month instead of a confusing "pace" number that didn\'t match remaining progress. The final month displays what you need to complete the goal, not an inflated target.',
      },
      {
        type: 'fixed',
        title: 'Goal progress correctly counts historical assignments and spending',
        description:
          'Yearly goals now properly include assignments from earlier months in their cycle when viewing later months. Yearly Allocation goals track cumulative assignments and stop decreasing when you spend; Yearly Available goals track the balance toward the target date as expected.',
      },
      {
        type: 'fixed',
        title: 'Auto-assign "Fund Goals" uses the correct monthly amount',
        description:
          'The Fund Goals button now assigns the actual monthly milestone for yearly goals instead of attempting to fund the entire remaining target at once.',
      },
      {
        type: 'fixed',
        title: 'Currency code no longer defaults to USD in goal messages',
        description:
          "Goal status messages now consistently use your budget's currency throughout, including the final-month prompt.",
      },
      {
        type: 'fixed',
        title: 'Security updates',
        description: 'Updated Go runtime and dependencies to address upstream security advisories.',
      },
    ],
  },
  {
    version: 'v1.4.8',
    date: 'April 14, 2026',
    summary: 'Master password setting now follows you across devices, plus security updates.',
    items: [
      {
        type: 'improved',
        title: 'Master password setting syncs across devices',
        description:
          'Your master password mode (memory/session) and retention now sync via your account, so the setting follows you to every device. Fixes an issue where the unlock prompt could reappear on every reload when the setting came from another device. Your password itself is never stored on the server.',
      },
      {
        type: 'fixed',
        title: 'Security updates',
        description:
          'Updated Go runtime and database migration library to patch dependency vulnerabilities. Applies to both the cloud and self-hosted builds.',
      },
    ],
  },
  {
    version: 'v1.4.7',
    date: 'April 9, 2026',
    summary: 'Major PDF import improvements, plus a page size selector for transaction lists.',
    items: [
      {
        type: 'improved',
        title: 'More reliable PDF statement imports',
        description:
          'Multi-page statements now import in full, column detection handles messy layouts much better, and credit card statements with yearless dates (like "Oct 25") are detected — with a new "Default year" input so you can pin them to the correct year.',
      },
      {
        type: 'new',
        title: 'Skip rows and exclude individual transactions on import',
        description:
          'The configure step lets you drop banner rows from the top of a file and uncheck specific transactions before importing. Hold Shift and click a checkbox to toggle a range.',
      },
      {
        type: 'new',
        title: 'Page size setting on transaction lists',
        description:
          'Account and All Transactions pages now have a rows-per-page selector (10, 20, 50, 100), remembered across sessions.',
      },
      {
        type: 'fixed',
        title: 'Dates no longer imported into the future',
        description:
          'Date parsing now strictly honors the configured format, fixing a bug where strings like "10.03.2026" in DD.MM.YYYY could be mis-parsed as October and land in the future.',
      },
    ],
  },
  {
    version: 'v1.4.6',
    date: 'April 8, 2026',
    summary:
      'Account archiving lands, Budgero Core is officially deprecated, plus fixes for budget rounding, backup grace period, and a stuck UI after deleting a budget.',
    items: [
      {
        type: 'new',
        title: 'Archive accounts',
        description:
          'You can now archive accounts you no longer use. Archived accounts are hidden from navigation and pickers but stay in the budget so historical transactions and reports remain intact.',
      },
      {
        type: 'deprecated',
        title: 'Budgero Core is now deprecated',
        description:
          'The standalone Budgero Core (browser-only, offline-first) edition is officially deprecated. Existing Core users can keep using it, but all new development is focused on the encrypted cloud and self-host editions. Marketing links and the dedicated Core build flavor have been removed.',
      },
      {
        type: 'fixed',
        title: 'Budget amount rounding',
        description:
          'Budget amounts now round consistently so values that were previously off by a sub-cent due to floating-point math display correctly.',
      },
      {
        type: 'fixed',
        title: 'UI unresponsive after deleting a budget',
        description:
          'Resolved an issue where the page could become unclickable after deleting a budget because a leftover pointer-events lock was not cleared.',
      },
      {
        type: 'improved',
        title: 'Backup grace period for new users',
        description:
          'New users now get their first backup grace window aligned to their backup frequency, avoiding spurious "backup overdue" warnings shortly after sign-up.',
      },
    ],
  },
  {
    version: 'v1.4.5',
    date: 'March 25, 2026',
    summary:
      'Fixed negative-zero budget displays and corrected planning activity details for category inflows.',
    items: [
      {
        type: 'fixed',
        title: 'Negative-zero budget amounts',
        description:
          'Budget and dashboard amount formatting now normalizes values that round to zero so covered overspending no longer appears as `-0.00`.',
      },
      {
        type: 'fixed',
        title: 'Planning activity inflow details',
        description:
          'The Planning activity drawer and quick-view popup now show the correct positive amount and category metadata for inflow transactions assigned to a category.',
      },
    ],
  },
  {
    version: 'v1.4.4',
    date: 'March 18, 2026',
    summary:
      'Improved startup reliability, fixed self-host sync duplication after re-login, and tightened recovery around guarded app boot flows.',
    items: [
      {
        type: 'fixed',
        title: 'Fixed self-host duplicate data after logout/login',
        description:
          'Budgero no longer replays the full mutation log after restoring a fresh server snapshot, which prevented duplicate data from appearing after signing back in.',
      },
      {
        type: 'fixed',
        title: 'Fixed startup stalls on encryption key check',
        description:
          'Resolved a startup race that could leave the app stuck on the "Checking your encryption key" screen after logging out and back in.',
      },
      {
        type: 'fixed',
        title: 'Improved guarded startup recovery',
        description:
          'Startup now recovers more reliably when auth, workspace loading, and master-password checks update in quick succession.',
      },
    ],
  },
  {
    version: 'v1.4.3',
    date: 'March 5, 2026',
    summary:
      'Improved desktop transaction selection, fixed category import deduplication, and polished self-host transition guidance.',
    items: [
      {
        type: 'improved',
        title: 'Desktop transaction multi-select controls',
        description:
          'Desktop transaction lists now support Ctrl/Cmd toggle selection, Shift range selection, row-click selection, and a header checkbox to select or clear the current page.',
      },
      {
        type: 'fixed',
        title: 'Category import deduplication',
        description:
          'Transaction imports now map category names to existing categories first and reuse a single import category group, preventing duplicate category/group creation per row.',
      },
      {
        type: 'fixed',
        title: 'Self-host transition link update',
        description:
          'Updated self-host transition messaging to point to the correct destination link for sunset guidance.',
      },
    ],
  },
  {
    version: 'v1.4.2',
    date: 'March 4, 2026',
    summary:
      'Improved startup resilience, sync recovery, and runtime currency stability, plus the new Paper default theme for a cleaner app experience.',
    items: [
      {
        type: 'improved',
        title: 'Paper theme is now the default app experience',
        description:
          'New users now default to the Paper theme preset, with improved form-control contrast and legibility updates across key input surfaces.',
      },
      {
        type: 'improved',
        title: 'Startup guards and offline recovery hardening',
        description:
          'App startup flow was consolidated into a unified guard chain with stronger service readiness handling and smoother offline recovery states.',
      },
      {
        type: 'fixed',
        title: 'Sync and mutation cursor recovery',
        description:
          'Runtime sync now handles startup catch-up and mutation cursor recovery more reliably, reducing stalled or inconsistent sync states after reconnect.',
      },
      {
        type: 'fixed',
        title: 'Server WASM delivery reliability',
        description:
          'Server static delivery now skips gzip for WASM assets and test mode no longer depends on bundled web dist output, improving runtime stability and CI reliability.',
      },
    ],
  },
  {
    version: 'v1.4.1',
    date: 'February 27, 2026',
    summary:
      'Polished the mobile bottom navigation UI for a cleaner and more consistent experience.',
    items: [
      {
        type: 'improved',
        title: 'Mobile bottom navigation polish',
        description:
          'Refined mobile bottom navigation spacing and active-state styling to improve visual clarity in PWA and mobile views.',
      },
    ],
  },
  {
    version: 'v1.4.0',
    date: 'February 25, 2026',
    summary:
      'New warranty tracking feature for managing product warranties with receipt photos, expiry monitoring, and transaction linking.',
    items: [
      {
        type: 'new',
        title: 'Warranty tracking',
        description:
          'Track product warranties with names, expiry dates, amounts, and optional notes. Upload or capture receipt photos directly from your camera, link warranties to existing transactions with auto-filled amounts, and monitor active, expiring, and expired warranties at a glance.',
      },
      {
        type: 'fixed',
        title: 'Bug fixes and stability improvements',
        description: 'Various fixes to sync, backup persistence, and workspace setup reliability.',
      },
    ],
  },
  {
    version: 'v1.3.1',
    date: 'February 24, 2026',
    summary:
      'Expanded DuckDB reporting ergonomics with a normalized transactions analytics view, richer Explorer tooling, and a mobile layout fix for custom dashboards.',
    items: [
      {
        type: 'improved',
        title: 'Normalized transactions analytics view',
        description:
          'Added a prebuilt `transactions_analytics` DuckDB view with denormalized account/category/group/payee/label fields, snake_case naming, and date buckets for week, month, quarter, and year.',
      },
      {
        type: 'improved',
        title: 'Explorer schema and query workflow',
        description:
          'Explorer now surfaces DuckDB views in the schema sidebar, supports schema search, distinguishes view/analytics objects visually, and includes expanded premade analytics queries.',
      },
      {
        type: 'fixed',
        title: 'Custom dashboards mobile navbar overlap',
        description:
          'Custom Dashboards now reserve bottom safe-area space on mobile so content stays above the navigation bar and remains fully reachable.',
      },
    ],
  },
  {
    version: 'v1.3.0',
    date: 'February 20, 2026',
    summary:
      'Introduced custom dashboards, visual privacy mode, and DuckDB-powered reporting with improved SQL authoring.',
    items: [
      {
        type: 'new',
        title: 'Custom dashboards for reports',
        description:
          'You can now pin Explorer charts to budget-scoped custom dashboards, reorder and resize widgets, and manage multiple dashboard pages across desktop and mobile.',
      },
      {
        type: 'new',
        title: 'Global privacy mode for numbers',
        description:
          'Added a global header toggle to mask numeric values across calculator cells and key amount surfaces, with values revealed while actively editing.',
      },
      {
        type: 'improved',
        title: 'DuckDB report execution',
        description:
          'Read-only report queries now run through DuckDB for analytics-oriented SQL support, and Explorer quick queries were updated for DuckDB compatibility.',
      },
      {
        type: 'improved',
        title: 'SQL editor completion for reporting',
        description:
          'Explorer SQL editor now uses a DuckDB-oriented dialect and schema-aware completion for more relevant keywords, functions, and table/column suggestions.',
      },
    ],
  },
  {
    version: 'v1.2.13',
    date: 'February 19, 2026',
    summary:
      'Introduced first-class transaction labels with settings management, label-aware search, and a new spending-by-label report.',
    items: [
      {
        type: 'new',
        title: 'Transaction labels with color',
        description:
          'You can now create, edit, and delete labels in Settings, each with a name and color, and assign one label per transaction.',
      },
      {
        type: 'improved',
        title: 'Label picker in transaction workflows',
        description:
          'Transaction forms and transaction lists now include a dedicated label picker with color cues across desktop and mobile views.',
      },
      {
        type: 'new',
        title: 'Spending by label report',
        description:
          'Prebuilt Reports now include spending grouped by label, including an Unlabeled bucket for transactions without labels.',
      },
      {
        type: 'improved',
        title: 'Label-aware semantic search',
        description:
          'Transaction search now supports label tokens like `label:Travel` and includes label names in plain-text matching.',
      },
    ],
  },
  {
    version: 'v1.2.12',
    date: 'February 18, 2026',
    summary:
      'Fixed collaboration access edge cases, backup settings regressions, restored self-host admin access checks, and improved workspace switching and PWA install guidance.',
    items: [
      {
        type: 'fixed',
        title: 'Collaboration-only workspace writes',
        description:
          'Users with collaboration access can now upload workspace blobs and update master-password and backup settings without a paid subscription, restoring normal shared-workspace sync behavior.',
      },
      {
        type: 'fixed',
        title: 'Collaboration access cleanup on member removal',
        description:
          'When an owner removes a user from their last shared workspace membership, collaboration access is now revoked automatically. Access stays enabled when the user remains a member in other workspaces.',
      },
      {
        type: 'fixed',
        title: 'Backup settings persistence',
        description:
          'Updating backup reminder frequency no longer clears the last downloaded timestamp, and recording a database backup no longer resets reminder frequency back to 7 days.',
      },
      {
        type: 'fixed',
        title: 'Self-host admin access guard',
        description:
          'Self-host admin access checks now resolve correctly during initialization and profile loading, preventing false "Admin Access Required" screens for valid admin accounts.',
      },
      {
        type: 'fixed',
        title: 'Workspace switch budget-name refresh',
        description:
          'Switching workspaces now refreshes the displayed budget name immediately, so the header stays in sync without requiring a manual page reload.',
      },
      {
        type: 'improved',
        title: 'PWA install guidance on non-native browsers',
        description:
          'When automatic install prompts are unavailable (including iOS and unsupported browsers), Budgero now shows clear manual install instructions instead of hiding install guidance.',
      },
    ],
  },
  {
    version: 'v1.2.11',
    date: 'February 17, 2026',
    summary:
      'Added flexible transaction import delimiters and fixed dashboard drilldowns to include split spending.',
    items: [
      {
        type: 'new',
        title: 'Flexible transaction import delimiters',
        description:
          'Transaction imports now accept tab-separated and semicolon-separated files in addition to standard CSV, making it easier to import data exported from more banks and tools.',
      },
      {
        type: 'fixed',
        title: 'Dashboard drilldown split spending',
        description:
          'Dashboard drilldowns now include split spending values correctly, so category and spending breakdowns stay accurate when transactions are split across multiple categories.',
      },
    ],
  },
  {
    version: 'v1.2.10',
    date: 'February 14, 2026',
    summary: 'Stabilized workspace switching with improved budget guard and reconnect transitions.',
    items: [
      {
        type: 'fixed',
        title: 'Workspace switch stability',
        description:
          'Budget guard and reconnect transitions during workspace switching are now more stable, preventing race conditions and UI flicker when moving between budgets.',
      },
    ],
  },
  {
    version: 'v1.2.9',
    date: 'February 11, 2026',
    summary:
      'Major runtime architecture refactor for faster app loading, custom currency rates now apply to transfers, and calculator sheet accessibility improvements.',
    items: [
      {
        type: 'improved',
        title: 'Faster app loading',
        description:
          'The app runtime has been restructured with a new internal architecture, deduplicated modules, and streamlined coordination, resulting in noticeably faster app loading times.',
      },
      {
        type: 'fixed',
        title: 'Custom currency rates apply to transfers',
        description:
          'Custom currency exchange rates set by users now correctly apply to transfers as well, ensuring consistent rate usage across all transaction types.',
      },
      {
        type: 'improved',
        title: 'Calculator sheet accessibility',
        description:
          'Improved accessibility on the calculator sheet for better screen reader support and keyboard navigation.',
      },
    ],
  },
  {
    version: 'v1.2.8',
    date: 'February 10, 2026',
    summary:
      'Appearance preferences now sync to your server profile, the mobile spending drawer opens faster, mobile panels migrated to native Drawer, and self-hosted auth properly handles expired sessions.',
    items: [
      {
        type: 'new',
        title: 'Server-synced appearance preferences',
        description:
          'Your theme, color mode, and appearance settings are now persisted to your server profile, so preferences follow you across devices and browser sessions.',
      },
      {
        type: 'improved',
        title: 'Mobile panels migrated to Drawer',
        description:
          'Major mobile panels — including spending, calculator, chat, debt payoff, budget context, and budgeting — now use the native Drawer component instead of Sheet for a smoother, more consistent swipe experience.',
      },
      {
        type: 'improved',
        title: 'Faster mobile spending drawer',
        description:
          'Reduced open-time jank on the mobile spending drawer for a smoother, more responsive budgeting experience on phones.',
      },
      {
        type: 'fixed',
        title: 'Session expired state for self-host auth',
        description:
          'Self-hosted instances now correctly show a session expired state when receiving a 401, instead of silently failing or getting stuck.',
      },
      {
        type: 'fixed',
        title: 'Budget table drag behavior across layouts',
        description:
          'Drag-and-drop for reordering categories now works consistently across all budget table layouts, preventing misaligned drops and ghost rows.',
      },
      {
        type: 'improved',
        title: 'Unified mobile swipe quick actions',
        description:
          'Swipe-to-reveal quick actions on mobile budget rows now use a consistent style and behavior across all layouts.',
      },
      {
        type: 'fixed',
        title: 'Mobile spending drawer stability',
        description:
          'The mobile spending drawer no longer flickers, closes unexpectedly, or has elements disappearing on scroll. Fixed GPU compositing issues that caused broken rendering on Android Chrome and other mobile browsers. Closing a nested dialog (quick view, delete confirmation, reassign category) no longer dismisses the parent drawer.',
      },
      {
        type: 'fixed',
        title: 'Self-host blob storage path',
        description:
          'Blob storage on self-hosted instances now aligns with the DB_PATH setting, so uploaded files are stored next to the database instead of in the default working directory.',
      },
      {
        type: 'fixed',
        title: 'PWA shortcut launches',
        description:
          'PWA shortcuts now reliably deliver their intent to the running app via the Launch Handler API and hand off navigation to an existing app instance, preventing blank launches that required re-entering the master password.',
      },
      {
        type: 'improved',
        title: 'Faster blob downloads and auth caching',
        description:
          'Server-side blob downloads are now streamed more efficiently and Clerk JSON Web Keys are cached by key ID, reducing latency on authenticated requests.',
      },
      {
        type: 'fixed',
        title: 'Custom currency rate mutations',
        description:
          'Custom currency exchange rate edits now route through the sync engine correctly, fixing failures when updating rates in multi-device setups.',
      },
      {
        type: 'improved',
        title: 'Background provider sync',
        description:
          'Third-party provider sync in SaaS mode has been moved off the profile request into an hourly background loop, reducing latency on profile loads and keeping provider data fresh automatically.',
      },
    ],
  },
  {
    version: 'v1.2.7',
    date: 'February 8, 2026',
    summary:
      'Fixed account balance floating-point drift when deleting all transactions, and streamlined exchange rate selector display.',
    items: [
      {
        type: 'improved',
        title: 'Exchange rate selector',
        description:
          'The exchange rate selector now shows only the flag and currency code for a cleaner, more compact display.',
      },
      {
        type: 'fixed',
        title: 'Zero balance after deleting all transactions',
        description:
          'Deleting all transactions from an account could leave a tiny floating-point residual (e.g. -0.00) instead of exact zero, which blocked account deletion. The balance is now recalculated from scratch when the last transaction is removed.',
      },
    ],
  },
  {
    version: 'v1.2.6',
    date: 'February 7, 2026',
    summary:
      'Custom exchange rates for multi-currency budgets, polished desktop dashboard layout, and floating-point rounding fixes for monetary values.',
    items: [
      {
        type: 'new',
        title: 'Custom exchange rates',
        description:
          'Define your own exchange rates for multi-currency transactions. A new settings page lets you manage custom rates, and exchange rate details now appear in transaction forms, mobile cards, and the desktop transaction table.',
      },
      {
        type: 'improved',
        title: 'Desktop dashboard layout',
        description:
          'Polished the desktop dashboard visual hierarchy with better spacing and layout, and widened the sidebar with improved scrollbar and account list styling.',
      },
      {
        type: 'fixed',
        title: 'Monetary value rounding',
        description:
          'Budget monetary values are now properly rounded to avoid floating-point display noise like $10.000000001.',
      },
    ],
  },
  {
    version: 'v1.2.5',
    date: 'February 7, 2026',
    summary:
      'New curated theme system with Phosphor, Mesa, and Obsidian themes, improved mobile budget table readability, redesigned compact toolbar, polished account pages, and self-host admin copy fixes.',
    items: [
      {
        type: 'new',
        title: 'Curated theme system',
        description:
          'Replaced the old generic themes with three distinctive new options: Phosphor (retro CRT terminal), Mesa (warm southwestern desert), and Obsidian (luxury dark with copper accents). Themes now support single-mode locking so dark-only and light-only themes auto-apply their color mode.',
      },
      {
        type: 'improved',
        title: 'Mobile budget table readability',
        description:
          'Budget table columns now auto-size to content instead of using fixed widths, preventing financial numbers from overlapping or truncating on small screens.',
      },
      {
        type: 'improved',
        title: 'Compact budget toolbar layout',
        description:
          'Ready to Assign is now centered in its own row with the month selector on a separate row below for better clarity on mobile.',
      },
      {
        type: 'improved',
        title: 'Account pages and dashboard polish',
        description:
          'Streamlined account pages, summary cards, dashboard widgets, and transaction list for improved responsiveness and readability.',
      },
      {
        type: 'fixed',
        title: 'Self-host admin copy',
        description:
          'Admin user management now correctly references "username" instead of "email" throughout the self-hosted interface.',
      },
    ],
  },
  {
    version: 'v1.2.4',
    date: 'January 28, 2026',
    summary:
      'Fix overlay disappearing issue, add AllowOverAssignment budget preference, persist analytics opt-out in SaaS, and improve mobile iOS safe area handling.',
    items: [
      {
        type: 'fixed',
        title: 'Overlay disappearing issue',
        description:
          'Fixed an issue where overlays would disappear unexpectedly during interactions, ensuring consistent user experience across all components.',
      },
      {
        type: 'new',
        title: 'AllowOverAssignment budget preference',
        description:
          'Added new budget preference to control whether over-assignment is allowed, giving users more flexibility in their budgeting workflow.',
      },
    ],
  },
  {
    version: 'v1.2.3',
    date: 'January 28, 2026',
    summary:
      'Analytics opt-out preference now persists across sign-outs, and the mobile budget context button respects iOS safe areas.',
    items: [
      {
        type: 'improved',
        title: 'Persistent analytics opt-out',
        description:
          'Your analytics preference is now saved to your account instead of just browser storage. The setting survives sign-outs and syncs across devices.',
      },
      {
        type: 'fixed',
        title: 'iOS safe area on mobile budget button',
        description:
          'The floating budget context button on mobile now accounts for the iOS safe area inset, preventing it from being obscured by the home indicator.',
      },
    ],
  },
  {
    version: 'v1.2.2',
    date: 'January 27, 2026',
    summary:
      'Future overspending warnings protect your budget, off-budget transfers support category selection, and compact layout controls are fixed.',
    items: [
      {
        type: 'new',
        title: 'Future overspending warning',
        description:
          'Reducing an assignment or moving money now checks all future months for that category. If any month would go negative, a confirmation dialog lists the affected months and their projected balances before you proceed.',
      },
      {
        type: 'new',
        title: 'Category selection for off-budget transfers',
        description:
          'Transfers to off-budget accounts can now be assigned to a category, giving you more control over how off-budget money movement is tracked in your budget.',
      },
      {
        type: 'fixed',
        title: 'Compact mobile header controls',
        description:
          'The collapse-all and hidden categories toggle buttons now appear correctly in the compact mobile budget header.',
      },
    ],
  },
  {
    version: 'v1.2.1',
    date: 'January 26, 2026',
    summary:
      'Category ordering now persists to the database, hidden categories stay organized, and move money is available everywhere.',
    items: [
      {
        type: 'new',
        title: 'Hidden categories feature',
        description:
          'Hide categories you no longer need without deleting them. Hidden categories are grouped separately and always appear at the bottom of your budget table.',
      },
      {
        type: 'improved',
        title: 'Category ordering persists to database',
        description:
          'Drag-and-drop category ordering is now saved to your database instead of browser storage. Your custom order syncs across devices and survives browser cache clears.',
      },
      {
        type: 'improved',
        title: 'Move money available in all layouts',
        description:
          'The move money popover is now accessible from the Available column in compact and table mobile layouts, matching the functionality of the default card view.',
      },
      {
        type: 'fixed',
        title: 'Amount filter pills show correct labels',
        description:
          'Filter pills for amount searches now display the correct operator labels and support the equal operator for exact amount matching.',
      },
    ],
  },
  {
    version: 'v1.2.0',
    date: 'January 21, 2026',
    summary:
      'Smarter transaction search with natural language queries, a dedicated All Transactions page, and date range improvements.',
    items: [
      {
        type: 'new',
        title: 'Semantic search for transactions',
        description:
          'Search transactions using natural language like "last 30 days outflows groceries". The search bar now understands date ranges, transaction types (inflows/outflows/transfers), and category names—combining them into instant filters.',
      },
      {
        type: 'new',
        title: 'All Transactions page',
        description:
          'View and search across every transaction in your budget from one place. Access it directly from the sidebar on desktop or under Accounts on mobile.',
      },
      {
        type: 'new',
        title: 'All Time date preset',
        description:
          'The date range selector now includes an "All Time" option so you can quickly view your complete transaction history without setting custom dates.',
      },
      {
        type: 'improved',
        title: 'Data export from subscription screen',
        description:
          'You can now export your budget data directly from the subscription required screen, ensuring you always have access to your financial information.',
      },
      {
        type: 'improved',
        title: 'Split transaction dialog',
        description:
          'The split details popup on desktop is now wider with better table formatting, making it easier to review and edit transaction splits.',
      },
      {
        type: 'improved',
        title: 'Date range presets on mobile',
        description:
          'Date range preset buttons now wrap properly on smaller screens, preventing layout overflow and improving touch targets.',
      },
    ],
  },
  {
    version: 'v1.1.1',
    date: 'January 16, 2026',
    summary:
      'Reliability improvements for offline mode, multi-currency editing, and self-hosted authentication.',
    items: [
      {
        type: 'fixed',
        title: 'Offline mode no longer hammers the server',
        description:
          'Fixed an issue where the app would repeatedly attempt to fetch the profile when the server was unreachable. The app now waits for connectivity status before making requests.',
      },
      {
        type: 'improved',
        title: 'Smarter offline detection',
        description:
          'Offline state is now detected using the connectivity service health probe instead of parsing error messages, making detection more reliable across different network conditions.',
      },
      {
        type: 'fixed',
        title: 'Multi-currency transaction editing',
        description:
          'Fixed a bug where editing multi-currency transactions would incorrectly use the inverse of the exchange rate, causing incorrect converted amounts.',
      },
      {
        type: 'fixed',
        title: 'Self-host admin re-login',
        description:
          'Fixed a bug where logging back in with the same admin credentials on self-hosted instances would fail after the initial session.',
      },
    ],
  },
  {
    version: 'v1.1.0',
    date: 'January 15, 2026',
    summary:
      'Smarter automation with autofill rules, expanded rule conditions and actions, reorganized settings, and new privacy controls.',
    items: [
      {
        type: 'new',
        title: 'Autofill rules',
        description:
          'Create rules that automatically fill in transaction fields as you type. Set up patterns like "when payee contains Starbucks, set category to Coffee" and watch fields populate instantly.',
      },
      {
        type: 'improved',
        title: 'Extended rule conditions and actions',
        description:
          'Rules now support memo and payee fields for both conditions and actions. Match transactions by payee name, automatically set payees, or transform memos with regex patterns.',
      },
      {
        type: 'improved',
        title: 'Reorganized settings',
        description:
          'Settings have been restructured into clearer sections, making it easier to find display preferences, account options, and app configuration.',
      },
      {
        type: 'new',
        title: 'Privacy controls',
        description:
          'A new Privacy section in settings lets you control usage analytics. Disable anonymous usage tracking anytime if you prefer complete data privacy.',
      },
    ],
  },
  {
    version: 'v1.0.12',
    date: 'January 6, 2026',
    summary:
      'New account types for better tracking, a visual asset history chart, and fixes to dashboard balance calculations.',
    items: [
      {
        type: 'new',
        title: 'Investment & Retirement account types',
        description:
          'Track your brokerage accounts, 401(k), IRA, and pension funds separately from other assets. Each type has its own color and icon for clearer organization.',
      },
      {
        type: 'new',
        title: 'Asset history chart',
        description:
          'A new History tab on the Accounts page shows a stacked bar chart of your assets and liabilities over the last 24 months, with net worth comparison.',
      },
      {
        type: 'fixed',
        title: 'Dashboard balance shows cash only',
        description:
          'The dashboard balance card now correctly shows only cash accounts (checking, savings, cash), excluding credit cards and loans for a clearer picture of spendable money.',
      },
      {
        type: 'improved',
        title: 'Separate account groupings',
        description:
          'Real Estate, Other Assets, Investments, and Retirement accounts now appear in their own sections on the Accounts page instead of being grouped together.',
      },
    ],
  },
  {
    version: 'v1.0.11',
    date: 'January 5, 2026',
    summary:
      'Debt account handling is now unified and smarter. Linked categories stay in sync with account names, and transfers update their memos automatically when you rename accounts.',
    items: [
      {
        type: 'improved',
        title: 'Unified debt account handling',
        description:
          'Credit cards, loans, and mortgages now all use the same per-account linked category system, making debt tracking consistent across account types.',
      },
      {
        type: 'fixed',
        title: 'Linked categories sync with account names',
        description:
          'Renaming a debt account now automatically updates its linked category name, keeping your budget organized without manual edits.',
      },
      {
        type: 'fixed',
        title: 'Transfer memos update on account rename',
        description:
          'When you rename an account, existing transfer memos now reflect the new name so your transaction history stays accurate.',
      },
      {
        type: 'improved',
        title: 'Linked categories cleaned up on account deletion',
        description:
          'Deleting a debt account now automatically removes its linked category, preventing orphaned categories from cluttering your budget.',
      },
      {
        type: 'improved',
        title: 'Protected linked categories',
        description:
          'Linked categories can no longer be accidentally deleted while their associated debt account exists. A clear error message guides you to delete the account first.',
      },
    ],
  },
  {
    version: 'v1.0.10',
    date: 'January 2, 2026',
    summary:
      'Recurring transactions now use the same calculator-style numpad as the rest of the app for a consistent input experience.',
    items: [
      {
        type: 'fixed',
        title: 'Recurring transaction form uses numpad input',
        description:
          'The recurring transaction form now uses the custom numpad input instead of the browser default number field, matching the rest of the app and improving mobile usability.',
      },
    ],
  },
  {
    version: 'v1.0.9',
    date: 'December 27, 2025',
    summary:
      'Budgero Self-Host arrives for teams who want full control, alongside a refined mobile budgeting experience with new table layouts and calculator-style inputs.',
    items: [
      {
        type: 'new',
        title: 'Budgero Self-Host',
        description:
          'Deploy Budgero on your own infrastructure with Docker. Full end-to-end encryption, complete data ownership, and no reliance on external services.',
      },
      {
        type: 'new',
        title: 'Calculator-Style Number Inputs',
        description:
          'All amount fields now feature a dedicated numpad with expression support. Type "100 + 50" or "1000 * 0.3" and let Budgero do the math.',
      },
      {
        type: 'new',
        title: 'Mobile Budget Table Layouts',
        description:
          'Choose between card, compact, and table views for your budget on mobile. Switch layouts from the toolbar to match how you prefer to work.',
      },
      {
        type: 'improved',
        title: 'Cleaner Empty State Handling',
        description:
          'Zero values now display as empty fields when editing, reducing clutter and making it faster to enter new amounts without clearing placeholder text.',
      },
    ],
  },
  {
    version: 'v1.0.8',
    date: 'December 15, 2025',
    summary:
      'Experimental AI features come to Budgero with local LLM integration, intelligent auto-categorization, receipt scanning, and a built-in chat assistant—all running privately on your device.',
    items: [
      {
        type: 'new',
        title: 'Local LLM Integration (Experimental)',
        description:
          'Connect Budgero to local language models via Ollama or LM Studio. Your financial conversations stay private with local models.',
      },
      {
        type: 'new',
        title: 'AI-Powered Auto Categorization (Experimental)',
        description:
          'Let AI suggest categories for new transactions based on payee, memo, and your existing spending patterns. Review suggestions before applying.',
      },
      {
        type: 'new',
        title: 'AI-Powered Receipt Scanner (Experimental)',
        description:
          'Snap a photo of any receipt and let AI extract the merchant, amount, and date. Works with your local LLM for complete privacy.',
      },
      {
        type: 'new',
        title: 'AI Chat Assistant (Experimental)',
        description:
          'Ask questions about your budget in natural language. Get insights on spending trends, category breakdowns, and budget health without leaving the app.',
      },
      {
        type: 'new',
        title: 'Voice Transaction Logging (Experimental)',
        description:
          'Speak your transactions naturally and let local Whisper models transcribe them. Say "coffee at Starbucks for $5.50" and Budgero handles the rest—completely offline.',
      },
    ],
  },
  {
    version: 'v1.0.7',
    date: 'November 27, 2025',
    summary:
      'Programmatic access arrives with the Push API and Python SDK, plus a new Audit Log to track every change across your budget.',
    items: [
      {
        type: 'new',
        title: 'Push API',
        description:
          'Add transactions programmatically from external scripts, automations, or services. Generate an API token in Settings, encrypt your payload, and push directly to your budget.',
      },
      {
        type: 'new',
        title: 'Python SDK',
        description:
          'A first-party Python client for the Push API with built-in AES-256-GCM encryption. Install via pip and start automating transaction imports in minutes.',
      },
      {
        type: 'new',
        title: 'Audit Log',
        description:
          'Track every mutation across your budget in a new Settings page. See timestamps, operation details, and origin (local vs remote), with one-click undo for reversible actions.',
      },
    ],
  },
  {
    version: 'v1.0.6',
    date: 'November 22, 2025',
    summary:
      'The Add Transaction form now remembers your choices, plays nicely on touch, and responds to the shortcuts you expect.',
    items: [
      {
        type: 'improved',
        title: 'Remembers your last transaction details',
        description:
          'Budgero now saves your most recent payee, account, and category so repeat entries start prefilled and faster.',
      },
      {
        type: 'new',
        title: 'Touch-friendly numpad input',
        description:
          'A dedicated numeric keypad appears on touchscreens across the app, making amount entry smoother on phones and tablets.',
      },
      {
        type: 'new',
        title: 'Global shortcut to Add Transaction',
        description:
          'Press Ctrl + Alt + T (⌘ + ⌥ + T on macOS) from anywhere to open the transaction form without leaving the keyboard.',
      },
      {
        type: 'improved',
        title: 'Ctrl + ⏎ / ⌘ + ⏎ submits the form',
        description:
          'Finish new transactions with Ctrl + ⏎ (⌘ + ⏎ on macOS) so keyboard flows match the rest of Budgero’s dialogs.',
      },
    ],
  },
  {
    version: 'v1.0.5',
    date: 'November 19, 2025',
    summary:
      'Global drag-and-drop imports, smarter split transaction views, and hardened authentication logic make this release smoother and more reliable for everyone.',
    items: [
      {
        type: 'new',
        title: 'Global Drag-and-Drop Imports',
        description:
          'You can now drag and drop CSV or PDF files anywhere in the app to trigger an import, making it faster to bring in your data.',
      },
      {
        type: 'improved',
        title: 'Improved Split Transaction Visibility',
        description:
          'Split transactions now display correctly in quick views and have a polished layout on mobile cards, ensuring complex spending is easy to read on any device.',
      },
      {
        type: 'fixed',
        title: 'Authentication & Offline Stability',
        description:
          'Fixed issues with offline guard fallbacks and forced sign-out on expired tokens to ensure your session state remains consistent and secure.',
      },
      {
        type: 'improved',
        title: 'Backup language matches the app',
        description:
          'Self-host references were renamed to “Budgero Backup” across the import flow and docs, so new teams always see the terminology used in product.',
      },
    ],
  },
  {
    version: 'v1.0.4',
    date: 'November 13, 2025',
    summary:
      'PWA updates now feel intentional: manual checks report back instantly and the in-app prompt only appears when a new build is ready to install.',
    items: [
      {
        type: 'improved',
        title: 'Streamlined app update flow',
        description:
          'Manual update checks surface clear status toasts and only prompt when a fresh build is available, so you always know whether Budgero pulled down anything new.',
      },
      {
        type: 'fixed',
        title: 'Stopped repeated reload loops',
        description:
          'Resolved a bug where the old update overlay reloaded the PWA multiple times after an install, keeping the refresh to a single, predictable pass.',
      },
    ],
  },
  {
    version: 'v1.0.1',
    date: 'November 11, 2025',
    summary:
      'Transaction splits, the planning table, and the account list all get quality-of-life polish so budgeting is clearer the moment you open the app.',
    items: [
      {
        type: 'improved',
        title: 'Smarter transaction split handling',
        description:
          'Split rows now respect category changes, show clearer totals, and keep amounts in sync so you can break up purchases without surprise leftovers.',
      },
      {
        type: 'improved',
        title: 'Planning page table refresh',
        description:
          'The compact table view received spacing, typography, and highlight tweaks that make monthly plans easier to scan on both desktop and tablet widths.',
      },
      {
        type: 'new',
        title: 'Account balances in the sidebar',
        description:
          'Every account now surfaces its current balance right inside the sidebar list, giving you instant context while you jump between budgets.',
      },
    ],
  },
  {
    version: 'v1.0.0',
    date: 'October 24, 2025',
    summary:
      'Budgero 1.0 launches with Budgero Core (free) plus refreshed pricing and marketing assets for the full encrypted app.',
    items: [
      {
        type: 'new',
        title: 'Budgero Core (free)',
        description:
          'A browser-based, offline-first edition that keeps your budget in OPFS. No account required, perfect for single-device workflows.',
      },
      {
        type: 'new',
        title: 'Pricing refresh & marketing site',
        description:
          'Updated budgero.app with Core vs Full comparison, revised FAQs, and a new pricing table highlighting the 14-day trial for paid plans.',
      },
      {
        type: 'improved',
        title: 'Service worker and install prompts for Core',
        description:
          'Core now registers a PWA service worker, precaching assets so the experience works offline and can be installed like an app.',
      },
    ],
  },
  {
    version: 'v0.9.0',
    date: 'October 10, 2025',
    summary:
      'Shared budgets arrive for households while desktop polish keeps setup steps and background updates out of the way.',
    items: [
      {
        type: 'new',
        title: 'Shared budgets and invites',
        description:
          'Spin up shared budget spaces, invite collaborators, and mirror assignments live so couples and teams stay perfectly in sync.',
      },
      {
        type: 'improved',
        title: 'Desktop skips onboarding overlays',
        description:
          'The Electron build now bypasses the onboarding tour entirely, letting experienced users jump straight into their budgets.',
      },
      {
        type: 'improved',
        title: 'Simpler desktop About page',
        description:
          'We removed the manual service worker update button from desktop settings to avoid confusing actions that do not apply to native builds.',
      },
    ],
  },
  {
    version: 'v0.8.0',
    date: 'October 4, 2025',
    summary:
      'Automations graduate to their own hub with recurring reminders, richer editors, and sync fixes so rules and schedules stay tidy across devices.',
    items: [
      {
        type: 'new',
        title: 'Automations hub with recurring reminders',
        description:
          'Rules and recurring transactions now live together on the Automations page, complete with desktop dialogs, mobile drawers, and notification opt-ins for Electron and PWA builds.',
      },
      {
        type: 'new',
        title: 'Create recurring items from account activity',
        description:
          'Convert any transaction selection into a recurring template straight from account toolbars, pre-filling the editor so you can schedule paycheques and bills in seconds.',
      },
      {
        type: 'improved',
        title: 'Recurring editor usability upgrades',
        description:
          'The editor adopts our calendar picker with past dates disabled, responsive card actions, and mobile drawers that prevent buttons from spilling offscreen.',
      },
      {
        type: 'fixed',
        title: 'Offline sync no longer duplicates automations',
        description:
          'Replaying queued mutations now skips reapplying local inserts, so new rules and recurring transactions appear exactly once even after reconnecting.',
      },
    ],
  },
  {
    version: 'v0.7.3',
    date: 'September 26, 2025',
    summary:
      'Minor patch that keeps your budget layout steady, smooths mid-sized screens, and tightens goal and transfer math.',
    items: [
      {
        type: 'fixed',
        title: 'Budget group visibility persists',
        description:
          'Collapsed and expanded category groups now sync to local storage so the budget table reopens exactly how you left it across reloads and tabs.',
      },
      {
        type: 'improved',
        title: 'Medium breakpoints polished',
        description:
          'Budget table and goal cards received responsive tweaks around tablet widths, preventing cramped totals and awkward wrapping.',
      },
      {
        type: 'fixed',
        title: 'Consistent goal currency formatting',
        description:
          'Goal status messages now rely on the same currency locale as the rest of the app, so progress and target amounts line up.',
      },
      {
        type: 'fixed',
        title: 'Accurate off-budget transfers',
        description:
          'Transfers directed to off-budget accounts correctly decrease Ready to Assign, keeping your cash flow math precise.',
      },
    ],
  },
  {
    version: 'v0.7.2',
    date: 'September 26, 2025',
    summary:
      'Budgero now ships with a theme gallery, letting you flip between bold palettes in a click while fresh UI tweaks keep the dashboard lighter on mobile.',
    items: [
      {
        type: 'new',
        title: 'Theme preset system',
        description:
          'Introduced selectable presets with persistence so you can swap Budgero’s look without losing your preferred light or dark mode.',
      },
      {
        type: 'new',
        title: 'Five new Budgero looks',
        description:
          'Choose from Twitter Blue, Paper, Neo Brutalism, Bubblegum, or DOOM 64—each tuned with custom OKLCH tokens, fonts, shadows, and sidebar accents.',
      },
      {
        type: 'improved',
        title: 'Smarter theme switcher',
        description:
          'The appearance picker now previews palettes, manages data-theme attributes, and keeps light/dark controls close at hand.',
      },
      {
        type: 'fixed',
        title: 'Unstuck mobile date headers',
        description:
          'Dashboard transaction headers scroll with the list again so your view stays focused on the entries you are reviewing.',
      },
    ],
  },
  {
    version: 'v0.7.1',
    date: 'September 24, 2025',
    summary:
      'Prebuilt analytics gets a mobile-friendly overhaul, compact charts, and drill-down pivots that surface every transaction behind the numbers.',
    items: [
      {
        type: 'new',
        title: 'Prebuilt analytics responsive refresh',
        description:
          'Metric cards, chart filters, and detailed views now wrap neatly on smaller screens, leaving room for the mobile bottom nav and preventing cards from spilling offscreen.',
      },
      {
        type: 'improved',
        title: 'Compact chart axes',
        description:
          'Income vs Expense and Spending Over Time charts adopted compact K/M formatting and wider plotting areas so big budgets stay readable at a glance.',
      },
      {
        type: 'new',
        title: 'Category pivot drill-down',
        description:
          'Click any monthly total to pop open a curated list of the underlying transactions, complete with account, memo, and amount details filtered by date, category, and accounts.',
      },
      {
        type: 'improved',
        title: 'Filter consistency & presets',
        description:
          'Shared multi-select account/category controls keep filters aligned across analytics cards, and date presets now focus on 14/30/90-day windows for quick comparisons.',
      },
    ],
  },
  {
    version: 'v0.6.1',
    date: 'September 23, 2025',
    summary:
      'Budget tables now adapt cleanly across viewports and onboarding stays out of the way once you are finished.',
    items: [
      {
        type: 'improved',
        title: 'Responsive budget layout refresh',
        description:
          'Category rows, group headers, and totals received a slimmer, stacked layout so memos truncate gracefully, metrics hug the right edge, and the table shrinks without clipping on narrow screens.',
      },
      {
        type: 'improved',
        title: 'Multi-month view access',
        description:
          'The multi-month planner is now reserved for spacious desktops (≥1600px) and each month card stretches independently, giving a clearer snapshot when you open the sheet.',
      },
      {
        type: 'improved',
        title: 'Persistent drag handles',
        description:
          'Drag-and-drop grips stay visible on desktop so reordering groups and categories is effortless, even with the tighter layout.',
      },
      {
        type: 'improved',
        title: 'PWA Install Prompt Disabled on iOS',
        description:
          'PWA install prompt from the setting page is now hidden on iOS devices as PWA installation is not supported on iOS. To install the app on iOS, users can use the "Add to Home Screen" option from the Safari share menu.',
      },
      {
        type: 'fixed',
        title: 'Onboarding respects completion',
        description:
          'Creating goals or categories no longer re-opens the onboarding flow once your profile is marked complete, keeping experienced users focused on budgeting.',
      },
    ],
  },
  {
    version: 'v0.6.0',
    date: 'September 22, 2025',
    summary:
      'Guided onboarding, smarter YNAB imports, and a polished finish to help new households feel confident in Budgero from day one.',
    items: [
      {
        type: 'new',
        title: 'Guided onboarding journey',
        description:
          'New users are welcomed with an intro screen and step-by-step guidance through master password setup, budget creation, and the essentials needed to start budgeting securely.',
      },
      {
        type: 'new',
        title: 'Celebration screen',
        description:
          'Wrapping up onboarding now lands on a dedicated “You did it!” moment that reinforces progress and highlights the next best actions.',
      },
      {
        type: 'improved',
        title: 'Contextual budget helpers',
        description:
          'Category groups, categories, goals, and assignments now light up right where work needs to happen—complete with scroll-into-view hints so nothing gets lost.',
      },
      {
        type: 'improved',
        title: 'YNAB import detection',
        description:
          'When you import from YNAB we auto-complete onboarding tasks, skip redundant walkthroughs, and keep the server in sync so you can get straight to budgeting.',
      },
      {
        type: 'new',
        title: 'Public changelog',
        description:
          'Launched this page so you can follow product updates without digging through release notes or social posts.',
      },
    ],
  },
];
