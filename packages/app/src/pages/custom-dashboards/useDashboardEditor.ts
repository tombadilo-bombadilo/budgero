import { useLingui } from '@lingui/react/macro';
import { toast } from 'sonner';
import {
  HOME_DEFAULT_ORIGIN,
  type CustomDashboard,
  type CustomDashboardWidget,
  type CustomDashboardWithWidgets,
} from '@budgero/core/browser';
import { useRuntime } from '@shared/runtime/runtime-provider';
import { getErrorMessage } from '@shared/lib/errors';
import { runUndoGroup } from '@shared/mutations/UndoStore';
import { newOpRowId } from '@shared/mutations/op-code-registry/shared';
import {
  BUILTIN_CARDS,
  BUILTIN_CARD_KEYS,
  BUILTIN_CHART_ID,
  BUILTIN_ROW_SPAN,
  builtinKeyOf,
  builtinReportId,
  defaultHomeWidgets,
  defaultWidgetId,
  hasPhoneOrder,
  isDefaultHomeDashboard,
  isHiddenOn,
  mergeVisibleOrder,
  orderedFor,
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
    name: uniqueDashboardName(input.name, input.takenNames),
    origin: HOME_DEFAULT_ORIGIN,
  });
  const ids = new Map<string, string>();
  const widgets: CustomDashboardWidget[] = [];
  for (const [index, seed] of defaultHomeWidgets().entries()) {
    const id = newOpRowId();
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

interface EditorOptions {
  /** The dashboard shown: a stored one, or the default home (stored on its first edit). */
  dashboard: CustomDashboardWithWidgets | null | undefined;
  budgetId: number;
  platform: Platform;
  /** All of the budget's dashboards (names must stay unique). */
  dashboards: CustomDashboard[];
}

/**
 * Every edit a dashboard view makes, shared by the home page and custom
 * dashboards. On the default home, the first edit stores the default layout
 * as a dashboard and then applies the edit, as one undo step.
 */
export function useDashboardEditor({ dashboard, budgetId, platform, dashboards }: EditorOptions) {
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

  const edit = async (label: string, work: (target: Target) => Promise<void>) => {
    if (!dashboard) return;
    try {
      if (isDefaultHomeDashboard(dashboard)) {
        await runUndoGroup(label, async () => {
          const target = await materializeDefaultHome({
            exec,
            budgetId,
            name: t`Home`,
            takenNames: dashboards.map((item) => item.name),
            labelOf,
          });
          await work(target);
        });
        return;
      }
      await work({
        dashboardId: dashboard.id,
        widgetId: (id) => id,
        widgets: dashboard.widgets,
      });
    } catch (error) {
      toast.error(getErrorMessage(error, t`Could not save the dashboard`));
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
    /** Back to the default home; the dashboard stays as it is. */
    unsetHome: (dashboardId: string) =>
      guard(() => exec('customDashboards.update', { id: dashboardId, isHome: false })),
    /** Back to the default home; a dashboard made from it on its first edit is removed. */
    resetHome: (home: CustomDashboard) =>
      guard(() =>
        home.origin === HOME_DEFAULT_ORIGIN
          ? exec('customDashboards.delete', { id: home.id })
          : exec('customDashboards.update', { id: home.id, isHome: false })
      ),
  };
}
