// Budget snapshot property fuzzing, budget 1 starting in monthly RtaMode. See
// budget-snapshot-fuzz.helpers.ts.
import { defineSnapshotFuzz } from './budget-snapshot-fuzz.helpers';

defineSnapshotFuzz('budget snapshot fuzz (monthly start)', 'monthly', 20261017);
