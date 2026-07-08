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
};

export const changelogEntries: ChangelogEntry[] = [
  {
    version: 'v1.5.0',
    date: 'July 8, 2026',
    summary:
      'Budgero goes source-available: a precision money engine, opt-in analytics, hardened multi-device sync that delivers imports everywhere instantly, and a long list of fixes.',
    isLatest: true,
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
    summary:
      'Bug fixes for category reassignment and multi-currency credit-card payments.',
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
    summary:
      'Credit-card payment polish in Planning and an in-app feedback widget.',
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
          "Clicking the Available amount on a CC Payment row now opens a focused popover: pick a source account, confirm the amount, hit Pay. Budgero records the transfer in one shot — no need to detour through the transactions screen.",
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
          'Goal status messages now consistently use your budget\'s currency throughout, including the final-month prompt.',
      },
      {
        type: 'fixed',
        title: 'Security updates',
        description:
          'Updated Go runtime and dependencies to address upstream security advisories.',
      },
    ],
  },
  {
    version: 'v1.4.8',
    date: 'April 14, 2026',
    summary:
      'Master password setting now follows you across devices, plus security updates.',
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
    summary:
      'Major PDF import improvements, plus a page size selector for transaction lists.',
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
