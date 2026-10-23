import type {
  BankFeedSettings,
  BankLinkInput,
  BankProvider,
  BankReviewInput,
  BankReviewStatus,
  BankSyncRecordInput,
  EnableBankingConfig,
  EnableBankingSession,
} from '@budgero/core/browser';
import { S, type OpCodeEntry } from '../shared';

const BANK_SYNC_KEYS = [['bankSync', '*']];

export const bankSyncOps = {
  'bankSync.saveConnection': {
    execute: async (args) =>
      S().bankSync.saveConnection(args.budgetId as number, args.accessUrl as string),
    invalidates: BANK_SYNC_KEYS,
  },
  'bankSync.saveEnableBankingConnection': {
    execute: async (args) =>
      S().bankSync.saveEnableBankingConnection(
        args.budgetId as number,
        args.config as Omit<EnableBankingConfig, 'sessions'>
      ),
    invalidates: BANK_SYNC_KEYS,
  },
  'bankSync.saveEnableBankingSession': {
    execute: async (args) => {
      S().bankSync.saveEnableBankingSession(
        args.budgetId as number,
        args.session as EnableBankingSession
      );
    },
    invalidates: BANK_SYNC_KEYS,
  },
  'bankSync.removeEnableBankingSession': {
    execute: async (args) => {
      S().bankSync.removeEnableBankingSession(args.budgetId as number, args.sessionId as string);
    },
    invalidates: BANK_SYNC_KEYS,
  },
  'bankSync.deleteConnection': {
    execute: async (args) => {
      // Ops recorded before per-provider connections carry no provider: SimpleFIN.
      S().bankSync.deleteConnection(
        args.budgetId as number,
        (args.provider as BankProvider | undefined) ?? 'simplefin'
      );
    },
    invalidates: BANK_SYNC_KEYS,
  },
  'bankSync.saveLink': {
    execute: async (args) => {
      S().bankSync.saveLink(args.input as BankLinkInput);
    },
    invalidates: BANK_SYNC_KEYS,
  },
  'bankSync.updateLinkSettings': {
    execute: async (args) => {
      S().bankSync.updateLinkSettings(args.accountId as number, args.settings as BankFeedSettings);
    },
    invalidates: BANK_SYNC_KEYS,
  },
  'bankSync.deleteLink': {
    execute: async (args) => {
      S().bankSync.deleteLink(args.accountId as number);
    },
    invalidates: BANK_SYNC_KEYS,
  },
  'bankSync.recordSync': {
    execute: async (args) => {
      S().bankSync.recordSync(args.input as BankSyncRecordInput);
    },
    invalidates: BANK_SYNC_KEYS,
  },
  'bankSync.addReviews': {
    execute: async (args) => {
      S().bankSync.addReviews(args.reviews as BankReviewInput[]);
    },
    invalidates: BANK_SYNC_KEYS,
  },
  'bankSync.setReviewStatus': {
    execute: async (args) => {
      S().bankSync.setReviewStatus(args.id as number, args.status as BankReviewStatus);
    },
    invalidates: BANK_SYNC_KEYS,
    undo: {
      capture: async (args) => ({ previous: S().bankSync.getReviewStatus(args.id as number) }),
      build: (args, _result, before) => {
        const previous = (before as { previous?: BankReviewStatus | null } | undefined)?.previous;
        return previous && previous !== args.status
          ? [
              {
                op: 'bankSync.setReviewStatus',
                args: { budgetId: args.budgetId, id: args.id, status: previous },
              },
            ]
          : [];
      },
    },
  },
} satisfies Record<string, OpCodeEntry>;
