import { useLingui } from '@lingui/react/macro';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  HOME_DEFAULT_ORIGIN,
  seededWidgetId,
  type CustomDashboard,
  type CustomDashboardWidget,
  type CustomDashboardWithWidgets,
} from '@budgero/core/browser';
import { useRuntime } from '@shared/runtime/runtime-provider';
import { getErrorMessage } from '@shared/lib/errors';
import { latestUndoId, runUndoGroup, useUndoStore } from '@shared/mutations/UndoStore';
import { newOpRowId } from '@shared/mutations/op-code-registry/shared';
import {
  BUILTIN_CARDS,
  BUILTIN_CARD_KEYS,
  BUILTIN_CHART_ID,
  BUILTIN_ROW_SPAN,
  builtinKeyOf,
  builtinReportId,
  defaultHomeDashboard,
  defaultHomeWidgets,
  defaultWidgetId,
  hasPhoneOrder,
  homeCopyName,
  isDefaultHomeDashboard,
  isHiddenOn,
  mergeVisibleOrder,
  orderedFor,
  pickHomeCopy,
  uniqueDashboardName,
  type BuiltinCardKey,
  type Platform,
} from '@widgets/dashboard/builtin/builtin-cards';
import type { BuiltinCardChoice } from './components/AddToDashboardDialog';

type Exec = (op: string, payload: Record<string, unknown>) => Promise<unknown>;

/** Where an edit lands: the stored dashboard, and the stored ID of a widget shown. */
interface Target {
  dashboardId: string;
  widgetId: (shownId: string) => string;
  widgets: CustomDashboardWidget[];
}

/**
 * The ops that store the default home as a real dashboard: the built-in cards
 * in the default layout (both platforms), made the budget's home. Returns the
 * stored ID of each default card.
 */
export async function materializeDefaultHome(input: {
  exec: Exec;
  budgetId: number;
  name: string;
  takenNames: string[];
  labelOf: (key: BuiltinCardKey) => string;
}): Promise<Target> {
  const dashboardId = newOpRowId();
  await input.exec('customDashboards.create', {
    id: dashboardId,
    budgetId: input.budgetId,
    // Dashboard names are unique per budget, also on builds before 1.21: a
    // short tag from the ID keeps two devices' copies apart (shown without it).
    name: uniqueDashboardName(homeCopyName(input.name, dashboardId), input.takenNames),
    origin: HOME_DEFAULT_ORIGIN,
  });
  const ids = new Map<string, string>();
  const widgets: CustomDashboardWidget[] = [];
  for (const [index, seed] of defaultHomeWidgets().entries()) {
    // Pairs this card with the same card of another device's copy.
    const id = seededWidgetId(dashboardId, seed.key);
    ids.set(defaultWidgetId(seed.key), id);
    await input.exec('customDashboardWidgets.add', {
      id,
      dashboardId,
      reportId: builtinReportId(seed.key),
      chartId: BUILTIN_CHART_ID,
      desktopLayout: seed.desktopLayout,
      mobileLayout: seed.mobileLayout,
      // The title builds without built-in cards show.
      titleOverride: input.labelOf(seed.key),
      seed: true,
    });
    widgets.push({
      id,
      dashboardId,
      reportId: builtinReportId(seed.key),
      chartId: BUILTIN_CHART_ID,
      sortOrder: index,
      desktopLayout: seed.desktopLayout,
      mobileLayout: seed.mobileLayout,
      createdAt: '',
      updatedAt: '',
    });
  }
  await input.exec('customDashboards.update', { id: dashboardId, isHome: true });
  return { dashboardId, widgetId: (shownId) => ids.get(shownId) ?? shownId, widgets };
}

/**
 * Make an earlier customised home the home again and map the default cards
 * shown to its widgets (by card).
 */
export async function reuseHomeCopy(exec: Exec, copy: CustomDashboardWithWidgets): Promise<Target> {
  await exec('customDashboards.update', { id: copy.id, isHome: true });
  const byKey = new Map<string, string>();
  for (const widget of copy.widgets) {
    const key = builtinKeyOf(widget);
    if (key && !byKey.has(key)) byKey.set(key, widget.id);
  }
  return {
    dashboardId: copy.id,
    widgetId: (shownId) =>
      shownId.startsWith('default:') ? (byKey.get(shownId.slice(8)) ?? shownId) : shownId,
    widgets: copy.widgets,
  };
}

interface EditorOptions {
  /** The dashboard shown: a stored one, or the default home (stored on its first edit). */
  dashboard: CustomDashboardWithWidgets | null | undefined;
  budgetId: number;
  platform: Platform;
  /** All of the budget's dashboards (names must stay unique). */
  dashboards: CustomDashboard[];
  /** The home page: an edit also makes the shown dashboard the home. */
  claimHome?: boolean;
}

/**
 * Every edit a dashboard view makes, shared by the home page and custom
 * dashboards. On the default home, the first edit stores the default layout
 * as a dashboard and then applies the edit, as one undo step.
 */
export function useDashboardEditor({
  dashboard,
  budgetId,
  platform,
  dashboards,
  claimHome = false,
}: EditorOptions) {
  const { t } = useLingui();
  const runtime = useRuntime();

  const exec: Exec = async (op, payload) => {
    const { result } = await runtime.mutationsRouter().execute<unknown>({
      op,
      payload,
      meta: { label: 'useDashboardEditor' },
    });
    return result;
  };

  const labelOf = (key: BuiltinCardKey) => t(BUILTIN_CARDS[key].label);

  // The default home is stored by the first edit (a dozen ops). Edits made
  // meanwhile (a double click, two fast drags) wait for that one copy instead
  // of storing another; the view keeps the default layout until it is whole.
  const pendingHome = useRef<Promise<Target> | null>(null);
  const [materializing, setMaterializing] = useState(false);
  useEffect(() => {
    if (!materializing && dashboard && !isDefaultHomeDashboard(dashboard)) {
      pendingHome.current = null;
    }
  }, [dashboard, materializing]);

  /** A stored target with its widgets as they are now (earlier edits applied). */
  const current = (target: Target): Target => ({
    ...target,
    widgets:
      runtime.services().customDashboards.getDashboard(target.dashboardId)?.widgets ??
      target.widgets,
  });

  const storeDefaultHome = async (): Promise<Target> => {
    // A customised home left from before is taken up again; only without
    // one is the default layout stored as a new dashboard.
    const copy = pickHomeCopy(dashboards);
    const stored = copy ? runtime.services().customDashboards.getDashboard(copy.id) : null;
    return stored
      ? reuseHomeCopy(exec, stored)
      : materializeDefaultHome({
          exec,
          budgetId,
          name: t`Home`,
          takenNames: dashboards.map((item) => item.name),
          labelOf,
        });
  };

  // Undo entries made by this edit session, so Cancel can take them back.
  const session = useRef(new Set<string>());
  const remember = () => {
    const id = latestUndoId();
    if (id) session.current.add(id);
  };

  const edit = async (label: string, work: (target: Target) => Promise<void>) => {
    if (!dashboard) return;
    try {
      await editInner(label, work);
      remember();
    } catch (error) {
      toast.error(getErrorMessage(error, t`Could not save the dashboard`));
    }
  };

  const editInner = async (label: string, work: (target: Target) => Promise<void>) => {
    if (!dashboard) return;
    if (pendingHome.current) {
      await work(current(await pendingHome.current));
      return;
    }
    if (isDefaultHomeDashboard(dashboard)) {
      let settle!: { resolve: (target: Target) => void; reject: (error: unknown) => void };
      const shared = new Promise<Target>((resolve, reject) => {
        settle = { resolve, reject };
      });
      shared.catch(() => undefined);
      pendingHome.current = shared;
      setMaterializing(true);
      try {
        await runUndoGroup(label, async () => {
          let target: Target;
          try {
            target = await storeDefaultHome();
          } catch (error) {
            settle.reject(error);
            throw error;
          }
          settle.resolve(target);
          await work(target);
        });
      } catch (error) {
        if (pendingHome.current === shared) pendingHome.current = null;
        throw error;
      } finally {
        setMaterializing(false);
      }
      return;
    }
    const target: Target = {
      dashboardId: dashboard.id,
      widgetId: (id) => id,
      widgets: dashboard.widgets,
    };
    if (claimHome && !dashboard.isHome) {
      // The home page shows a customised home nobody has set as home:
      // editing it makes it the home, in the same undo step.
      await runUndoGroup(label, async () => {
        await exec('customDashboards.update', { id: dashboard.id, isHome: true });
        await work(target);
      });
      return;
    }
    await work(target);
  };

  /** Start an edit session (entering edit mode). */
  const beginSession = () => {
    session.current = new Set();
  };

  /**
   * Undo this session's edits, newest first, stopping at any other change
   * on top of them (that one is left alone, and so is what lies below it).
   */
  const cancelSession = async () => {
    try {
      for (;;) {
        const { past } = useUndoStore.getState();
        const top = past[past.length - 1];
        if (!top || !session.current.has(top.id)) break;
        session.current.delete(top.id);
        await useUndoStore.getState().undo();
      }
    } catch (error) {
      toast.error(getErrorMessage(error, t`Could not undo the changes`));
    }
  };

  const byId = (target: Target, shownId: string) =>
    target.widgets.find((widget) => widget.id === target.widgetId(shownId));

  const reorderOn = async (target: Target, visibleIds: string[], on: Platform) => {
    const visible = visibleIds.map(target.widgetId);
    if (on === 'mobile' && hasPhoneOrder(target.widgets)) {
      // A dashboard made from the default home keeps its own phone order.
      const order = mergeVisibleOrder(
        orderedFor(target.widgets, 'mobile').map((widget) => widget.id),
        visible
      );
      for (const [index, id] of order.entries()) {
        const widget = target.widgets.find((item) => item.id === id);
        if (!widget || widget.mobileLayout.order === index) continue;
        await exec('customDashboardWidgets.update', {
          id,
          dashboardId: target.dashboardId,
          mobileLayout: { size: widget.mobileLayout.size, order: index },
        });
      }
      return;
    }
    await exec('customDashboardWidgets.reorder', {
      dashboardId: target.dashboardId,
      orderedIds: mergeVisibleOrder(
        target.widgets.map((widget) => widget.id),
        visible
      ),
    });
  };

  const reorder = (visibleIds: string[]) =>
    edit(t`Move a card`, async (target) => {
      if (platform === 'mobile' && hasPhoneOrder(target.widgets)) {
        await runUndoGroup(t`Move a card`, () => reorderOn(target, visibleIds, platform));
        return;
      }
      await reorderOn(target, visibleIds, platform);
    });

  const remove = (shownId: string) =>
    edit(t`Remove a card`, async (target) => {
      await exec('customDashboardWidgets.delete', { id: target.widgetId(shownId) });
    });

  const updateDesktopLayout = (
    shownId: string,
    patch: Partial<{ colSpan: number; rowSpan: number }>
  ) =>
    edit(t`Resize a card`, async (target) => {
      const widget = byId(target, shownId);
      if (!widget) return;
      await exec('customDashboardWidgets.update', {
        id: widget.id,
        dashboardId: target.dashboardId,
        desktopLayout: {
          colSpan: patch.colSpan ?? widget.desktopLayout.colSpan,
          rowSpan: patch.rowSpan ?? widget.desktopLayout.rowSpan,
        },
      });
    });

  const updateMobileSize = (shownId: string, size: 's' | 'm' | 'l') =>
    edit(t`Resize a card`, async (target) => {
      await exec('customDashboardWidgets.update', {
        id: target.widgetId(shownId),
        dashboardId: target.dashboardId,
        mobileLayout: { size },
      });
    });

  const addQuestion = (input: { reportId: string; chartId: string; titleOverride?: string }) =>
    edit(t`Add a question`, async (target) => {
      await exec('customDashboardWidgets.add', {
        dashboardId: target.dashboardId,
        reportId: input.reportId,
        chartId: input.chartId,
        ...(input.titleOverride ? { titleOverride: input.titleOverride } : {}),
      });
    });

  const addBuiltin = (key: BuiltinCardKey) =>
    edit(t`Add a card`, async (target) => {
      // A card this platform hides (the other platform's) is shown instead of doubled.
      const hidden = target.widgets.find(
        (widget) => builtinKeyOf(widget) === key && isHiddenOn(widget, platform)
      );
      if (hidden) {
        await runUndoGroup(t`Add a card`, async () => {
          if (platform === 'desktop') {
            await exec('customDashboardWidgets.update', {
              id: hidden.id,
              dashboardId: target.dashboardId,
              desktopLayout: { ...hidden.desktopLayout, hidden: false },
            });
            await exec('customDashboardWidgets.reorder', {
              dashboardId: target.dashboardId,
              orderedIds: [
                ...target.widgets.filter((w) => w.id !== hidden.id).map((w) => w.id),
                hidden.id,
              ],
            });
          } else {
            const last = Math.max(
              -1,
              ...target.widgets.map((widget) => widget.mobileLayout.order ?? -1)
            );
            await exec('customDashboardWidgets.update', {
              id: hidden.id,
              dashboardId: target.dashboardId,
              mobileLayout: {
                size: hidden.mobileLayout.size,
                hidden: false,
                ...(hasPhoneOrder(target.widgets) ? { order: last + 1 } : {}),
              },
            });
          }
        });
        return;
      }
      await exec('customDashboardWidgets.add', {
        dashboardId: target.dashboardId,
        reportId: builtinReportId(key),
        chartId: BUILTIN_CHART_ID,
        desktopLayout: { colSpan: BUILTIN_CARDS[key].colSpan, rowSpan: BUILTIN_ROW_SPAN },
        mobileLayout: {
          size: 'm',
          ...(hasPhoneOrder(target.widgets)
            ? {
                order:
                  Math.max(-1, ...target.widgets.map((widget) => widget.mobileLayout.order ?? -1)) +
                  1,
              }
            : {}),
        },
        titleOverride: labelOf(key),
      });
    });

  const replaceQuestion = (shownId: string, input: { reportId: string; chartId: string }) =>
    edit(t`Choose another question`, async (target) => {
      await exec('customDashboardWidgets.update', {
        id: target.widgetId(shownId),
        dashboardId: target.dashboardId,
        reportId: input.reportId,
        chartId: input.chartId,
      });
    });

  /** The built-in cards for the add dialog, marking those this platform already shows. */
  const builtinChoices = (): BuiltinCardChoice[] =>
    BUILTIN_CARD_KEYS.map((key) => ({
      key,
      label: labelOf(key),
      description: t(BUILTIN_CARDS[key].description),
      onDashboard: Boolean(
        dashboard?.widgets.some(
          (widget) => builtinKeyOf(widget) === key && !isHiddenOn(widget, platform)
        )
      ),
    }));

  return {
    /** The default home is being stored by the first edit. */
    materializing,
    beginSession,
    cancelSession,
    /** What to draw: the default layout until the stored copy is complete. */
    view:
      materializing && dashboard && !isDefaultHomeDashboard(dashboard)
        ? defaultHomeDashboard(budgetId, '')
        : dashboard,
    reorder,
    remove,
    updateDesktopLayout,
    updateMobileSize,
    addQuestion,
    addBuiltin: (key: string) =>
      (BUILTIN_CARD_KEYS as readonly string[]).includes(key)
        ? addBuiltin(key as BuiltinCardKey)
        : Promise.resolve(),
    replaceQuestion,
    builtinChoices,
  };
}

/**
 * The op that stops a dashboard being the home: the customised home (a copy
 * of the default) becomes the home again if there is one, else nothing is.
 */
export function stopUsingAsHomeOp(
  dashboardId: string,
  dashboards: CustomDashboard[]
): { op: string; args: Record<string, unknown> } {
  const copy = pickHomeCopy(dashboards, dashboardId);
  return copy
    ? { op: 'customDashboards.update', args: { id: copy.id, isHome: true } }
    : { op: 'customDashboards.update', args: { id: dashboardId, isHome: false } };
}

/** Home page choice: which dashboard the home page shows. */
export function useHomeActions() {
  const { t } = useLingui();
  const runtime = useRuntime();
  const exec: Exec = async (op, payload) => {
    const { result } = await runtime.mutationsRouter().execute<unknown>({
      op,
      payload,
      meta: { label: 'useHomeActions' },
    });
    return result;
  };
  const guard = async (work: () => Promise<unknown>) => {
    try {
      await work();
    } catch (error) {
      toast.error(getErrorMessage(error, t`Could not change the home page`));
      throw error;
    }
  };
  return {
    /** Show this dashboard on the home page. */
    makeHome: (dashboardId: string) =>
      guard(() => exec('customDashboards.update', { id: dashboardId, isHome: true })),
    /**
     * Stop showing this dashboard on the home page: the home goes back to what
     * it was, the customised home if there is one, else the default layout.
     */
    unsetHome: (dashboardId: string, dashboards: CustomDashboard[]) =>
      guard(() => {
        const call = stopUsingAsHomeOp(dashboardId, dashboards);
        return exec(call.op, call.args);
      }),
    /** Back to the default layout: every customised copy of it is removed (one undo step). */
    resetHome: (dashboards: CustomDashboard[]) =>
      guard(() =>
        runUndoGroup(t`Reset to default`, async () => {
          for (const dashboard of dashboards) {
            if (dashboard.origin === HOME_DEFAULT_ORIGIN) {
              await exec('customDashboards.delete', { id: dashboard.id });
            }
          }
        })
      ),
  };
}
