import type { ConversationSummary } from '@prisma/client';

export interface SummarySourceState {
  _max: {
    sequence: number | null;
    updatedAt: Date | null;
  };
  _count: {
    _all: number;
  };
}

export function summaryIsStale(
  summary: Pick<
    ConversationSummary,
    'sourceMaxSequence' | 'sourceMessageCount' | 'sourceLatestMessageUpdatedAt'
  >,
  sourceState: SummarySourceState,
): boolean {
  return summary.sourceMaxSequence === null ||
    summary.sourceMessageCount === null ||
    summary.sourceLatestMessageUpdatedAt === null ||
    summary.sourceMaxSequence !== (sourceState._max.sequence ?? 0) ||
    summary.sourceMessageCount !== sourceState._count._all ||
    summary.sourceLatestMessageUpdatedAt.getTime() !==
      (sourceState._max.updatedAt?.getTime() ?? 0);
}
