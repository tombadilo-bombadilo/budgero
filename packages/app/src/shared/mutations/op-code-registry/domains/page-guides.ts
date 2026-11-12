import { S, type OpCodeEntry } from '../shared';

/**
 * Page guides a workspace member has seen (core PageGuidesService). Adds only,
 * so marks from several devices merge; not undoable and not in the audit log.
 */
export const pageGuideOps = {
  'pageGuides.markSeen': {
    execute: async (args) => {
      const services = S() as {
        pageGuides?: { markSeen(userId: string, guideIds: readonly string[]): string[] };
      };
      if (!services.pageGuides) throw new Error('pageGuides service not available');
      const added = services.pageGuides.markSeen(
        args.userId as string,
        args.guides as readonly string[]
      );
      return { added };
    },
    invalidates: [['pageGuidesSeen']],
    history: false,
  },
} satisfies Record<string, OpCodeEntry>;
