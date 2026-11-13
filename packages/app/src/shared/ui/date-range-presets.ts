import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';

export type PresetKey =
  | 'last14Days'
  | 'last30Days'
  | 'last90Days'
  | 'monthToDate'
  | 'lastMonth'
  | 'yearToDate'
  | 'lastYear'
  | 'allTime'
  | 'next30Days'
  | 'next3Months';

/** Preset labels of the date range picker; the page guide's picture shows the same words. */
export const PRESET_LABELS: Record<PresetKey, MessageDescriptor> = {
  last14Days: msg`Last 14 days`,
  last30Days: msg`Last 30 days`,
  last90Days: msg`Last 90 days`,
  monthToDate: msg`Month to date`,
  lastMonth: msg`Last month`,
  yearToDate: msg`Year to date`,
  lastYear: msg`Last year`,
  allTime: msg`All time`,
  next30Days: msg`Next 30 days`,
  next3Months: msg`Next 3 months`,
};
