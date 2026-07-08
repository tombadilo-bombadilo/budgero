export type DocsTopic = {
  id: string;
  title: string;
  summary: string;
  takeaways: string[];
};

export type DocsSection = {
  id: string;
  title: string;
  description: string;
  topics: DocsTopic[];
};

export const docsSections: DocsSection[] = [
  {
    id: 'getting-started',
    title: 'Getting started',
    description:
      'Lay the groundwork for a secure, zero-based budget. These guides help you set up the essentials so Budgero feels tailored to your household from day one.',
    topics: [
      {
        id: 'zero-based-budgeting',
        title: 'Zero-based budgeting',
        summary:
          'Connect the zero-based budgeting methodology to Budgero tools so every unit of income gets a job the moment it arrives.',
        takeaways: [
          'Core tenets of zero-based budgeting and why they matter',
          'How Ready to Assign, categories, and goals implement the method',
          'Ways Budgero reports and reconciliations keep the plan on track',
        ],
      },
      {
        id: 'self-hosting-guide',
        title: 'Self-Hosting Guide',
        summary:
          'Deploy Budgero on your own infrastructure with Docker or native binaries. Configure authentication, database, and optional integrations.',
        takeaways: [
          'Deploy using Docker, Docker Compose, or native binaries',
          'Configure JWT secrets, database paths, and environment variables',
          'Set up currency conversion API and user management',
        ],
      },
      {
        id: 'budget-currency',
        title: 'Budget currency',
        summary:
          'Choose the currency that drives your dashboards, reports, and readiness to assign. Accounts in other currencies sync using Budgero’s built-in converter.',
        takeaways: [
          'How budget currency affects analytics and cash-flow charts',
          'When to change the currency and what happens to historic data',
          'Ways to handle households that earn in multiple currencies',
        ],
      },
      {
        id: 'ready-to-assign',
        title: 'Ready to assign',
        summary:
          'See how new money arrives in Budgero, how it flows into ready to assign, and why giving every unit a job keeps you on-plan.',
        takeaways: [
          'How inflows, transfers, and reimbursements update ready to assign',
          'Tips for reconciling cash and credit accounts without double counting',
          'Common reasons the balance might be negative and how to fix it fast',
        ],
      },
      {
        id: 'personalizing-budgero',
        title: 'Personalizing Budgero',
        summary:
          'Make Budgero look and behave the way you want — themes and fonts, budget table and home-page layouts, privacy mode, installing the app, and the over-assignment toggle.',
        takeaways: [
          'The five themes, light/dark control, and the Budgero Classic font picker',
          'Budget table layouts for desktop and mobile, account order, and the default home page',
          'Privacy mode, installing Budgero as an app, and the over-assignment behaviour toggle',
        ],
      },
    ],
  },
  {
    id: 'budget-basics',
    title: 'Budget building blocks',
    description:
      'Learn the core mechanics of Budgero’s zero-based budgeting model, from structuring category groups to planning long-term goals.',
    topics: [
      {
        id: 'category-groups',
        title: 'Category groups',
        summary:
          'Structure your budget around the priorities that matter most. Group recurring bills, true expenses, and savings targets into categories that match your rhythms.',
        takeaways: [
          'Recommended blueprint for monthly, quarterly, and annual expenses',
          'How groups and categories influence rollovers and reports',
          'Creating defaults vs. building a budget from scratch',
        ],
      },
      {
        id: 'categories',
        title: 'Categories',
        summary:
          'Translate real-life jobs for your money into actionable categories with clear intentions and budgets you can check at a glance.',
        takeaways: [
          'Setting targets and notes so teammates know the plan',
          'When to archive vs. delete and what happens to history',
          'Making room for seasonal spend without losing sight of fixed bills',
        ],
      },
      {
        id: 'goals',
        title: 'Goals',
        summary:
          'Use Budgero goals to stay accountable to future spending. Dial in amounts, timelines, and funding automation that match the way you save.',
        takeaways: [
          'Goal types and when to use monthly vs. target date amounts',
          'How progress bars, streaks, and reminders keep goals on track',
          'Linking assignments and goals so funding is always intentional',
        ],
      },
      {
        id: 'assign-money',
        title: 'Assigning money',
        summary:
          'Follow the workflow for moving funds from ready to assign into the categories that need them, with tips for smoothing out cash-flow dips.',
        takeaways: [
          'Keyboard shortcuts and multi-select for power users',
          'Resolving overspending and reclaiming funds after returns',
          'Balancing long-term goals with urgent, short-term needs',
        ],
      },
    ],
  },
  {
    id: 'accounts-and-imports',
    title: 'Accounts & imports',
    description:
      'Keep every account in sync and understand how Budgero treats historical data so your reports always reflect reality across currencies.',
    topics: [
      {
        id: 'accounts',
        title: 'Accounts',
        summary:
          'Add checking, savings, cash, credit, and investment accounts with confidence. Learn how balances, currencies, and reconciliation work together.',
        takeaways: [
          'Choosing the right account types for tracking accuracy',
          'Managing multi-currency budgets with live conversion rates',
          'Reconciliation workflow and how to fix mismatched balances',
        ],
      },
      {
        id: 'multi-currency',
        title: 'Multi-currency',
        summary:
          'Hold accounts in 168 currencies inside one budget. Learn how conversion works, where rates come from, and how to override them when reality disagrees.',
        takeaways: [
          'How every foreign transaction stores both an original and a converted amount',
          'The rate hierarchy: per-transaction overrides, custom rates, fetched rates, manual rates',
          'Workflows for matching statements, travel spending, and offline budgeting',
        ],
      },
      {
        id: 'debt-tracking',
        title: 'Debt tracking',
        summary:
          'Track credit cards, loans, and mortgages in Budgero. Learn how each debt type affects your budget differently and how to pay down debt intentionally.',
        takeaways: [
          'Understand how credit cards differ from loans and mortgages',
          'Learn why credit card payments are budget-neutral while loan payments count as spending',
          'Master debt payoff by budgeting for loan categories',
        ],
      },
      {
        id: 'ynab-import',
        title: 'YNAB import',
        summary:
          'Import your YNAB data without losing momentum. Understand what comes over, how Budgero handles goals, and how onboarding changes for existing budgets.',
        takeaways: [
          'Data types we import automatically vs. what stays in YNAB',
          'Mapping categories, accounts, and assignments for a clean start',
          'Marking onboarding complete and skipping redundant steps',
        ],
      },
      {
        id: 'csv-import',
        title: 'CSV import & export',
        summary:
          'Bring in transaction history from your banks or accounting system and export backups you can use for tax season or deeper analysis.',
        takeaways: [
          'Formatting CSV columns so Budgero recognizes payees and notes',
          'Avoiding duplicate transactions when combining with manual entry',
          'Exporting filtered reports for accountants and stakeholders',
        ],
      },
    ],
  },
  {
    id: 'collaboration',
    title: 'Collaboration & privacy',
    description:
      'Share budgets with your household while keeping zero-knowledge promises intact. Learn how permissions and encryption safeguards your data.',
    topics: [
      {
        id: 'master-password',
        title: 'Master password',
        summary:
          'Understand why your master password never leaves your device and learn best practices for keeping it safe and memorable.',
        takeaways: [
          'Why Budgero uses zero-knowledge encryption',
          'How to create a strong passphrase that you will still remember',
          'What to do if you want to rotate the master password later',
        ],
      },
      {
        id: 'sharing',
        title: 'Sharing budgets',
        summary:
          'Invite partners or teammates, assign roles, and stay in sync without sacrificing control over sensitive information.',
        takeaways: [
          'Role-based access and what each role can edit or approve',
          'Auditing changes with activity history and notification settings',
          'How encryption keys are shared securely between members',
        ],
      },
      {
        id: 'security',
        title: 'Security model',
        summary:
          'Dig into Budgero’s end-to-end encryption design, master password safeguards, and how we keep support hands off your raw financial data.',
        takeaways: [
          'How encryption keys are derived and stored locally',
          'What metadata the server can see and what stays client-side',
          'Steps we take to keep your data safe even if you lose a device',
        ],
      },
      {
        id: 'offline',
        title: 'Offline mode',
        summary:
          'Budget on flights or rural getaways. Understand how Budgero queues changes, resolves conflicts, and keeps ledgers consistent once you reconnect.',
        takeaways: [
          'How offline edits are synced and merged automatically',
          'Best practices when multiple people go offline simultaneously',
          'What to expect with attachment uploads and large imports offline',
        ],
      },
    ],
  },
  {
    id: 'integrations',
    title: 'Integrations & API',
    description:
      'Automate Budgero by sending encrypted transactions from other systems. Use the Push API to keep your budget up to date without manual imports.',
    topics: [
      {
        id: 'recurring-transactions',
        title: 'Recurring transactions',
        summary:
          'Plan bills, paycheques, and future spending before they happen — recurring schedules with reminders, future-dated one-offs, and the dashboard card that shows both.',
        takeaways: [
          'How recurring templates, occurrences, and the Mark ready flow work together',
          'Scheduling a one-off future transaction straight from the transaction form',
          'What the dashboard Upcoming transactions card shows and how far it looks ahead',
        ],
      },
      {
        id: 'rules-engine',
        title: 'Rules Engine',
        summary:
          'Automate transaction cleanup with rules — match on payee, memo, amount, or account, then categorize, rename, and adjust automatically.',
        takeaways: [
          'The three rule modes — Continuous, One Time, and Autofill — and when each runs',
          'Every condition and action available, and how multiple rules combine',
          'Retro runs, run history, and the one-click undo safety net',
        ],
      },
      {
        id: 'push-api',
        title: 'Push API',
        summary:
          'Send encrypted transactions directly into your budget via a bearer token and queue that deduplicates requests with message IDs.',
        takeaways: [
          'Generate a Push API token and export your encryption key from Settings > Integrations > Push API',
          'Encrypt a transactions.add payload (or let the Python SDK handle it) and POST it to /api/v1/push',
          'Monitor the push queue and stats from the app or via the SDK to confirm processing',
        ],
      },
      {
        id: 'push-api-email-bridge',
        title: 'Email bridge (no coding)',
        summary:
          'Set up a local, zero-knowledge bridge that reads bank alert emails and pushes transactions into Budgero without sharing bank credentials.',
        takeaways: [
          'Install Python/VS Code, create a .env with your email app password and Budgero Push API credentials',
          'Use the starter bridge script plus AI-generated parsing to map your bank’s emails into transactions',
          'Test in dry-run mode, then automate daily to keep Budgero updated privately',
        ],
      },
    ],
  },
];
