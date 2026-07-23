import { useState, useEffect, useMemo, useCallback } from 'react';
import type { ChartConfiguration } from '@budgero/core/browser';
import { QueryResult, processChartData, getValueKey } from './chart-viewer.utils';

interface UseChartViewerStateProps {
  queryResult: QueryResult;
  chartConfig: ChartConfiguration;
}

export function useChartViewerState({ queryResult, chartConfig }: UseChartViewerStateProps) {
  const [hiddenGroups, setHiddenGroups] = useState<Set<string>>(new Set());
  const [isSmallScreen, setIsSmallScreen] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia
      ? window.matchMedia('(max-width: 640px)').matches
      : window.innerWidth < 640;
  });

  // Track screen size to enable mobile-specific data presentation (Top-N)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(max-width: 640px)');
    const handler = (e: MediaQueryListEvent | MediaQueryList) =>
      setIsSmallScreen('matches' in e ? e.matches : (e as MediaQueryList).matches);
    // Initial sync for some browsers
    void Promise.resolve().then(() => {
      setIsSmallScreen(mq.matches);
    });
    mq.addEventListener('change', handler as (e: MediaQueryListEvent) => void);
    return () => {
      mq.removeEventListener('change', handler as (e: MediaQueryListEvent) => void);
    };
  }, []);

  // Use a dedicated value key for pie charts to avoid clobbering label fields
  const valueKey = useMemo(
    () => getValueKey(chartConfig.chartType, chartConfig.yAxisColumn),
    [chartConfig.chartType, chartConfig.yAxisColumn]
  );

  const { chartData, groups } = useMemo(() => {
    return processChartData(queryResult, chartConfig, valueKey, isSmallScreen);
  }, [queryResult, chartConfig, valueKey, isSmallScreen]);

  const toggleGroup = useCallback((group: string) => {
    setHiddenGroups((prev) => {
      const newHidden = new Set(prev);
      if (newHidden.has(group)) {
        newHidden.delete(group);
      } else {
        newHidden.add(group);
      }
      return newHidden;
    });
  }, []);

  const visibleGroups = useMemo(() => {
    return groups.filter((group) => !hiddenGroups.has(group));
  }, [groups, hiddenGroups]);

  return {
    hiddenGroups,
    valueKey,
    chartData,
    groups,
    visibleGroups,
    toggleGroup,
  };
}
