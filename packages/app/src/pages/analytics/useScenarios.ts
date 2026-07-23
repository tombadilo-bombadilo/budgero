import { useMutation } from '@tanstack/react-query';
import { useRuntime } from '@shared/runtime/runtime-provider';
import { useSpaceQuery } from '@shared/api/useSpaceQuery';
import type { ScenarioRecord } from '@budgero/core/browser';
import type { ScenarioOneOff } from './analytics-model';

export type ScenarioModel = 'average' | 'linear' | 'robust' | 'seasonal' | 'holt';

/** App-owned payload shape stored as JSON in the scenarios table. */
export interface ScenarioPayload {
  version: 1;
  /** Baseline fit for future income/spending. */
  model: ScenarioModel;
  /** Slider percentages (100 = unchanged). */
  incomePct: number;
  spendingPct: number;
  horizon: number;
  oneOffs: ScenarioOneOff[];
}

export const DEFAULT_SCENARIO_PAYLOAD: ScenarioPayload = {
  version: 1,
  model: 'average',
  incomePct: 100,
  spendingPct: 100,
  horizon: 24,
  oneOffs: [],
};

const SCENARIO_MODELS: ScenarioModel[] = ['average', 'linear', 'robust', 'seasonal', 'holt'];

export function parseScenarioPayload(raw: string): ScenarioPayload {
  try {
    const parsed = JSON.parse(raw) as Partial<ScenarioPayload> & { useForecast?: boolean };
    // Legacy payloads stored a boolean forecast toggle.
    const legacyModel: ScenarioModel | undefined =
      parsed.model === undefined && parsed.useForecast !== undefined
        ? parsed.useForecast
          ? 'linear'
          : 'average'
        : undefined;
    const model = parsed.model ?? legacyModel ?? 'average';
    return {
      ...DEFAULT_SCENARIO_PAYLOAD,
      ...parsed,
      version: 1,
      model: SCENARIO_MODELS.includes(model) ? model : 'average',
      oneOffs: Array.isArray(parsed.oneOffs) ? parsed.oneOffs : [],
    };
  } catch {
    return DEFAULT_SCENARIO_PAYLOAD;
  }
}

export function useScenarios(budgetId: number) {
  return useSpaceQuery<ScenarioRecord[]>({
    key: ['scenarios', budgetId],
    enabled: budgetId > 0,
    queryFn: (services) => services.scenarios.listScenarios(budgetId),
  });
}

export function useSaveScenario() {
  const runtime = useRuntime();
  return useMutation<
    ScenarioRecord,
    Error,
    { id?: string; budgetId: number; name: string; payload: ScenarioPayload }
  >({
    mutationFn: async ({ id, budgetId, name, payload }) => {
      const { result } = await runtime.mutationsRouter().execute<ScenarioRecord>({
        op: 'scenarios.save',
        payload: { id, budgetId, name, payload: JSON.stringify(payload) },
        meta: { label: 'useSaveScenario' },
      });
      return result;
    },
  });
}

export function useDeleteScenario() {
  const runtime = useRuntime();
  return useMutation<void, Error, { id: string }>({
    mutationFn: async ({ id }) => {
      await runtime.mutationsRouter().execute({
        op: 'scenarios.delete',
        payload: { id },
        meta: { label: 'useDeleteScenario' },
      });
    },
  });
}
