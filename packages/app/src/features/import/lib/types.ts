/**
 * SimpleFIN Protocol Types
 * @see https://www.simplefin.org/protocol.html
 */

export interface SimpleFINOrganization {
  /** Domain of the financial institution */
  domain?: string;
  /** SimpleFIN ID for the organization */
  'sfin-url'?: string;
  /** Human-readable name */
  name?: string;
  /** URL for the organization's website */
  url?: string;
}

export interface SimpleFINTransaction {
  /** Unique identifier within the account */
  id: string;
  /** UNIX timestamp when transaction posted (0 if pending) */
  posted: number;
  /** Amount as numeric string - positive for deposits, negative for withdrawals */
  amount: string;
  /** Human-readable transaction description */
  description: string;
  /** UNIX timestamp when transaction occurred (optional) */
  transacted_at?: number;
  /** True if transaction hasn't posted yet */
  pending?: boolean;
  /** Additional server-specific data */
  extra?: Record<string, unknown>;
}

export interface SimpleFINAccount {
  /** Financial institution details */
  org: SimpleFINOrganization;
  /** Unique identifier within organization */
  id: string;
  /** Human-readable account name */
  name: string;
  /** ISO 4217 currency code */
  currency: string;
  /** Current account balance as numeric string */
  balance: string;
  /** Available funds (optional) */
  'available-balance'?: string;
  /** UNIX timestamp when balance was last updated */
  'balance-date': number;
  /** Recent transaction history */
  transactions?: SimpleFINTransaction[];
  /** Additional server-specific data */
  extra?: Record<string, unknown>;
}

export interface SimpleFINAccountSet {
  /** Array of user-displayable error strings */
  errors: string[];
  /** Array of account objects */
  accounts: SimpleFINAccount[];
}

export interface SimpleFINCredentials {
  /** The access URL returned after claiming the setup token */
  accessUrl: string;
  /** When the credentials were created */
  createdAt: number;
}
