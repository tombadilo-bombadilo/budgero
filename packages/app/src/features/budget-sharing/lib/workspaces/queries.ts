import { spaceApi } from '@shared/api/api-client';

export const BUDGET_SPACES_QUERY_KEY = ['budget-spaces'] as const;

export function getBudgetSpacesQueryOptions() {
  return {
    queryKey: BUDGET_SPACES_QUERY_KEY,
    queryFn: () => spaceApi.listSpaces(),
    staleTime: 30_000,
  };
}
