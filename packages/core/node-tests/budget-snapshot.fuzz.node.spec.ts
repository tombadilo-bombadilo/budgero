// Budget snapshot property fuzzing, budget 1 starting in cumulative RtaMode
// (ops switch modes mid-sequence; every check reads both modes). See
// budget-snapshot-fuzz.helpers.ts.
import { defineSnapshotFuzz } from './budget-snapshot-fuzz.helpers';

defineSnapshotFuzz('budget snapshot fuzz (cumulative start)', 'cumulative', 20261016);
