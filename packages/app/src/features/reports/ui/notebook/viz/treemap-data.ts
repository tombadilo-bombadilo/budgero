/**
 * Treemap tiles from a question result: one tile per value of the first
 * grouping, or (with a second grouping) parents holding their children.
 * Tile sizes follow the pie rule (pieSliceValues): values of one sign by
 * magnitude, and with mixed signs the negative values get no tile.
 */
import type { BreakoutColumn, QuestionColumn } from '@features/reports/lib/question';
import type { QueryResult } from '@shared/lib/sql/report-query-executor';
import { pieSliceValues } from './series';
import { OTHER_VALUE } from './transforms';

export interface TreemapNode {
  /** Stable identity (hidden key + value). */
  id: string;
  /** Raw grouping value (OTHER_VALUE for the folded rest). */
  value: unknown;
  /** Hidden key of the value (drill-through), when the result has one. */
  key?: unknown;
  /** The metric as computed (may be negative). */
  amount: number;
  /** Tile size (≥ 0). */
  size: number;
  children?: TreemapNode[];
}

export interface TreemapData {
  parent: BreakoutColumn;
  child: BreakoutColumn | null;
  metric: QuestionColumn;
  nodes: TreemapNode[];
  /** Sum of all tile sizes (the "total" shares are of). */
  total: number;
  /** Values folded into "Other" past the top N, 0 when none. */
  otherCount: number;
  /** Values left without a tile (negative among positives). */
  negativeCount: number;
}

const toNumber = (value: unknown) => {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

const identity = (value: unknown, key: unknown) =>
  `${key === undefined ? '' : String(key ?? '')}\u0000${String(value ?? '')}`;

export function buildTreemap(
  result: QueryResult,
  columns: QuestionColumn[],
  topN?: number
): TreemapData | null {
  const breakouts = columns.filter(
    (column): column is BreakoutColumn => column.kind === 'breakout'
  );
  const metric = columns.find((column) => column.kind === 'aggregation' && !column.derived);
  const [parent, child = null] = breakouts;
  if (!parent || !metric) return null;
  const index = new Map(result.columns.map((name, position) => [name, position]));
  const at = (column: QuestionColumn | null) => (column ? index.get(column.key) : undefined);
  const keyAt = (column: QuestionColumn | null) =>
    column ? index.get(`${column.key}__key`) : undefined;
  const parentIndex = at(parent);
  const childIndex = at(child);
  const metricIndex = at(metric);
  if (parentIndex === undefined || metricIndex === undefined) return null;
  if (child && childIndex === undefined) return null;
  const parentKey = keyAt(parent);
  const childKey = keyAt(child);

  // Leaves in first-seen order: (parent, child) or parent alone.
  const parents = new Map<string, { node: TreemapNode; leaves: Map<string, TreemapNode> }>();
  for (const row of result.rows) {
    const pValue = row[parentIndex];
    const pKey = parentKey === undefined ? undefined : row[parentKey];
    const pId = identity(pValue, pKey);
    let entry = parents.get(pId);
    if (!entry) {
      entry = {
        node: {
          id: pId,
          value: pValue,
          ...(pKey !== undefined ? { key: pKey } : {}),
          amount: 0,
          size: 0,
        },
        leaves: new Map(),
      };
      parents.set(pId, entry);
    }
    const amount = toNumber(row[metricIndex]);
    entry.node.amount += amount;
    if (child && childIndex !== undefined) {
      const cValue = row[childIndex];
      const cKey = childKey === undefined ? undefined : row[childKey];
      const cId = `${pId}\u0001${identity(cValue, cKey)}`;
      const leaf = entry.leaves.get(cId) ?? {
        id: cId,
        value: cValue,
        ...(cKey !== undefined ? { key: cKey } : {}),
        amount: 0,
        size: 0,
      };
      leaf.amount += amount;
      entry.leaves.set(cId, leaf);
    }
  }

  const all = Array.from(parents.values());
  const leaves = child
    ? all.flatMap((entry) => Array.from(entry.leaves.values()))
    : all.map((entry) => entry.node);
  const sizes = pieSliceValues(leaves.map((leaf) => leaf.amount));
  leaves.forEach((leaf, position) => {
    leaf.size = sizes[position];
  });
  const negativeCount = leaves.filter((leaf) => leaf.size === 0 && leaf.amount < 0).length;
  const bySize = (a: TreemapNode, b: TreemapNode) => b.size - a.size;

  let nodes: TreemapNode[] = all
    .map(({ node, leaves: own }) => {
      if (!child) return node;
      const children = Array.from(own.values())
        .filter((leaf) => leaf.size > 0)
        .sort(bySize);
      return { ...node, size: children.reduce((sum, leaf) => sum + leaf.size, 0), children };
    })
    .filter((node) => node.size > 0)
    .sort(bySize);

  let otherCount = 0;
  if (topN && nodes.length > topN) {
    const folded = nodes.slice(topN);
    otherCount = folded.length;
    nodes = [
      ...nodes.slice(0, topN),
      {
        id: OTHER_VALUE,
        value: OTHER_VALUE,
        amount: folded.reduce((sum, node) => sum + node.amount, 0),
        size: folded.reduce((sum, node) => sum + node.size, 0),
      },
    ];
  }
  return {
    parent,
    child,
    metric,
    nodes,
    total: nodes.reduce((sum, node) => sum + node.size, 0),
    otherCount,
    negativeCount,
  };
}
