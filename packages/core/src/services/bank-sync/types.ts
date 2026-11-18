import type { ImportIdentity } from '../import/duplicate-planner.js';

/** SimpleFIN protocol payloads — https://www.simplefin.org/protocol.html */
export interface SimpleFINOrganization {
  domain?: string;
  'sfin-url': string;
  name?: string;
  url?: string;
  id?: string;
}

export interface SimpleFINTransaction {
  id: string;
  /** Unix seconds; 0 while pending. */
  posted: number;
  amount: string;
  description: string;
  payee?: string;
  memo?: string;
  transacted_at?: number;
  pending?: boolean;
}

export interface SimpleFINAccount {
  org: SimpleFINOrganization;
  id: string;
  name: string;
  currency: string;
  balance: string;
  'available-balance'?: string;
  'balance-date': number;
  transactions?: SimpleFINTransaction[];
}

export interface SimpleFINAccountSet {
  errors: string[];
  accounts: SimpleFINAccount[];
}

export type BankProvider = 'simplefin' | 'enablebanking';

/** Provider-neutral bank row, so every feed shares the same dedupe planner. */
export interface BankTransaction {
  /** Stable per account; part of the import operation ID. */
  id: string;
  /** YYYY-MM-DD in the user's local calendar. */
  date: string;
  /** 'HH:MM' of `date`, only when the bank gives a real time (not a 00:00/12:00 placeholder). */
  time?: string;
  /** Signed milli-units: positive is an inflow. */
  amount: number;
  payee: string;
  memo: string;
  /** Pending rows are never imported; banks often re-key them once booked. */
  pending: boolean;
  /** ISO timestamp the bank posted it, when the provider gives one (SimpleFIN). */
  postedAt?: string;
  /** Raw fields a linked account's settings can choose from. */
  fields?: BankTransactionFields;
}

export interface BankTransactionFields {
  /** The other party: merchant, payer or payee as the bank names it. */
  counterparty?: string;
  /** Free text: SimpleFIN's description, Enable Banking's remittance information. */
  description?: string;
  /** YYYY-MM-DD the bank booked or posted it. */
  bookingDate?: string;
  /** YYYY-MM-DD the purchase happened. */
  transactionDate?: string;
  /** YYYY-MM-DD the money moved (Enable Banking). */
  valueDate?: string;
  /** 'HH:MM' that goes with each date above, when the bank sends a real time. */
  bookingTime?: string;
  transactionTime?: string;
  valueTime?: string;
}

/** Which bank field becomes a transaction's date. `auto` is the provider's default. */
export type BankDateField = 'auto' | 'booking' | 'transaction' | 'value';
export type BankPayeeField = 'auto' | 'counterparty' | 'description';
export type BankMemoField = 'auto' | 'description' | 'counterparty' | 'none';

/** Per linked account; stored in the budget and synced like any other setting. */
export interface BankFeedSettings {
  /** Import pending transactions as uncleared, settling them once booked. */
  importPending: boolean;
  date: BankDateField;
  payee: BankPayeeField;
  memo: BankMemoField;
  /** Title-case payee names the bank sends in ALL CAPS. */
  tidyPayees: boolean;
}

/** One authorized Enable Banking session: a bank login good for ~180 days. */
export interface EnableBankingSession {
  sessionId: string;
  /** `logo` is Enable Banking's official logo URL, when the bank list had one. */
  aspsp: { name: string; country: string; logo?: string };
  /** ISO timestamp the consent expires. */
  validUntil: string;
  accounts: EnableBankingSessionAccount[];
  createdAt: string;
}

export interface EnableBankingSessionAccount {
  /** Changes with every session; only used for API calls. */
  uid: string;
  /** Stable across sessions; used as the link's ExternalAccountID. */
  hash: string;
  name: string;
  currency: string;
  iban?: string;
}

/** Stored encrypted in the budget, exactly like the SimpleFIN access URL. */
export interface EnableBankingConfig {
  appId: string;
  privateKeyPem: string;
  appName?: string;
  environment?: 'SANDBOX' | 'PRODUCTION';
  sessions: EnableBankingSession[];
}

export interface BankConnection {
  ID: number;
  BudgetID: number;
  Provider: BankProvider;
  AccessURL: string;
  /** Provider settings as JSON; `{}` for SimpleFIN. */
  ConfigJSON: string;
  LastSyncAt: string | null;
  LastError: string | null;
  CreatedAt: string;
}

export interface BankLink {
  ID: number;
  BudgetID: number;
  /** Which connection feeds this link. */
  Provider: BankProvider;
  AccountID: number;
  ExternalAccountID: string;
  ExternalName: string;
  OrgName: string;
  /** YYYY-MM-DD; bank rows dated earlier are never imported. */
  ImportFrom: string;
  LastSyncAt: string | null;
  LastBalance: number | null;
  LastBalanceDate: string | null;
  /** BankFeedSettings as JSON; `{}` means defaults. */
  SettingsJSON: string;
}

export interface BankLinkInput {
  budgetId: number;
  /** Defaults to SimpleFIN, the only provider before per-provider connections. */
  provider?: BankProvider;
  accountId: number;
  externalAccountId: string;
  externalName: string;
  orgName: string;
  importFrom: string;
}

export interface BankSyncRecordInput {
  budgetId: number;
  /** Defaults to SimpleFIN for ops recorded before per-provider connections. */
  provider?: BankProvider;
  at: string;
  error: string | null;
  /** A null balance still stamps LastSyncAt but keeps the last known balance. */
  links: { accountId: number; balance: number | null; balanceDate: string | null }[];
}

export type BankReviewStatus = 'pending' | 'resolved' | 'dismissed';

export interface BankReviewInput {
  budgetId: number;
  accountId: number;
  identity: ImportIdentity;
  candidateTransactionId: number | null;
}

export interface BankReview {
  ID: number;
  BudgetID: number;
  AccountID: number;
  OperationID: string;
  identity: ImportIdentity;
  candidate: {
    id: number;
    date: string;
    inflow: number;
    outflow: number;
    payee: string;
    memo: string;
  } | null;
  CreatedAt: string;
}

export interface BankImportPlanInput {
  budgetId: number;
  accountId: number;
  currency: string;
  link: Pick<BankLink, 'ExternalAccountID' | 'ImportFrom'>;
  /** Defaults to SimpleFIN, whose operation IDs predate this field. */
  provider?: BankProvider;
  /** The link's feed settings; defaults when omitted. */
  settings?: BankFeedSettings;
  transactions: BankTransaction[];
  /** True when this bank row was imported before, even if the ledger copy was deleted since. */
  wasImported: (identity: ImportIdentity) => boolean;
}

export interface BankImportPlan {
  imports: ImportIdentity[];
  reviews: BankReviewInput[];
  /** Rows the bank re-issued under a new ID: attach the new identity instead of importing. */
  rekeys: { identity: ImportIdentity; transactionId: number }[];
  /**
   * Imported pending rows the bank has now booked: update the existing
   * transaction to the booked values and mark it cleared. `previous` is the
   * pending identity, so user edits to payee or memo can be kept.
   */
  settles: { identity: ImportIdentity; previous: ImportIdentity; transactionId: number }[];
  /** Imported pending rows the bank dropped without booking (e.g. a released hold). */
  removals: number[];
  skipped: number;
}
