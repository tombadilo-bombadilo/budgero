import { describe, expect, it } from 'vitest';

import {
  holtDampedForecast,
  holtDampedPositiveForecast,
  linearForecast,
  seasonalAverageForecast,
  tCritical95,
  tTwoSidedP,
  theilSenForecast,
} from './forecast';

describe('t distribution helpers', () => {
  it('matches known two-sided p-values', () => {
    // Reference values from standard t tables.
    expect(tTwoSidedP(2.228, 10)).toBeCloseTo(0.05, 3);
    expect(tTwoSidedP(1.812, 10)).toBeCloseTo(0.1, 2);
    expect(tTwoSidedP(2.086, 20)).toBeCloseTo(0.05, 3);
    expect(tTwoSidedP(0, 10)).toBeCloseTo(1, 6);
  });

  it('matches known critical values', () => {
    expect(tCritical95(10)).toBeCloseTo(2.228, 2);
    expect(tCritical95(20)).toBeCloseTo(2.086, 2);
    expect(tCritical95(120)).toBeCloseTo(1.98, 2);
  });
});

describe('linearForecast', () => {
  it('recovers a perfect linear trend with p ≈ 0 and R² = 1', () => {
    const values = [10, 20, 30, 40, 50, 60];
    const fit = linearForecast(values, 2);
    expect(fit).not.toBeNull();
    expect(fit!.slope).toBeCloseTo(10, 8);
    expect(fit!.intercept).toBeCloseTo(10, 8);
    expect(fit!.rSquared).toBeCloseTo(1, 8);
    expect(fit!.points[0].predicted).toBeCloseTo(70, 6);
    expect(fit!.points[1].predicted).toBeCloseTo(80, 6);
  });

  it('produces sane inference on noisy data', () => {
    // y = 5 + 2x + fixed noise
    const noise = [0.3, -0.5, 0.2, 0.4, -0.1, -0.4, 0.25, -0.15, 0.1, -0.1];
    const values = noise.map((e, i) => 5 + 2 * i + e);
    const fit = linearForecast(values, 3)!;
    expect(fit.slope).toBeCloseTo(2, 1);
    expect(fit.pValue).toBeLessThan(0.001);
    expect(fit.rSquared).toBeGreaterThan(0.99);
    // Prediction intervals widen with the horizon and contain the point.
    expect(fit.points[2].upper95 - fit.points[2].lower95).toBeGreaterThan(
      fit.points[0].upper95 - fit.points[0].lower95
    );
    for (const point of fit.points) {
      expect(point.lower95).toBeLessThan(point.predicted);
      expect(point.upper95).toBeGreaterThan(point.predicted);
    }
  });

  it('reports an insignificant slope for flat noise', () => {
    const values = [100.2, 99.8, 100.1, 99.9, 100.05, 99.95, 100.1, 99.9];
    const fit = linearForecast(values, 1)!;
    expect(fit.pValue).toBeGreaterThan(0.05);
  });

  it('returns null for tiny or degenerate series', () => {
    expect(linearForecast([1, 2, 3], 2)).toBeNull();
    expect(linearForecast([], 2)).toBeNull();
  });
});

describe('theilSenForecast', () => {
  it('recovers a clean trend and shrugs off one outlier month', () => {
    const clean = [10, 20, 30, 40, 50, 60];
    const fit = theilSenForecast(clean, 2)!;
    expect(fit.slope).toBeCloseTo(10, 8);
    expect(fit.points[0]).toBeCloseTo(70, 6);

    const withOutlier = [10, 20, 300, 40, 50, 60];
    const robust = theilSenForecast(withOutlier, 1)!;
    // OLS slope here would be dragged far off; Theil–Sen stays near 10.
    expect(robust.slope).toBeGreaterThan(7);
    expect(robust.slope).toBeLessThan(13);
  });

  it('returns null for tiny series', () => {
    expect(theilSenForecast([1, 2, 3], 1)).toBeNull();
  });
});

describe('seasonalAverageForecast', () => {
  it('predicts each future month from its calendar-month history', () => {
    const monthKeys = ['2025-01', '2025-02', '2025-12', '2026-01', '2026-02', '2026-12'];
    const values = [100, 50, 400, 120, 70, 440];
    const out = seasonalAverageForecast(values, monthKeys, ['2027-01', '2027-12', '2027-06']);
    expect(out[0]).toBeCloseTo(110, 6); // Januaries: (100+120)/2
    expect(out[1]).toBeCloseTo(420, 6); // Decembers: (400+440)/2
    expect(out[2]).toBeCloseTo(196.666, 2); // June unseen → overall mean
  });
});

describe('holtDampedForecast', () => {
  it('follows a clean trend with damped continuation', () => {
    const values = [10, 20, 30, 40, 50, 60, 70, 80];
    const fit = holtDampedForecast(values, 3)!;
    // First step continues near the trend (damping shaves a little off).
    expect(fit.points[0]).toBeGreaterThan(85);
    expect(fit.points[0]).toBeLessThanOrEqual(90.5);
    // Damping: successive increments shrink.
    const inc1 = fit.points[1] - fit.points[0];
    const inc2 = fit.points[2] - fit.points[1];
    expect(Math.abs(inc2)).toBeLessThan(Math.abs(inc1));
  });

  it('stays near the mean for flat noisy data', () => {
    const values = [100, 102, 98, 101, 99, 100, 101, 99, 100, 100];
    const fit = holtDampedForecast(values, 6)!;
    for (const point of fit.points) {
      expect(point).toBeGreaterThan(90);
      expect(point).toBeLessThan(110);
    }
  });

  it('returns null for tiny series', () => {
    expect(holtDampedForecast([1, 2, 3, 4], 2)).toBeNull();
  });
});

describe('holtDampedPositiveForecast', () => {
  it('never crosses zero on a declining money series and plateaus positive', () => {
    // Additive Holt on this series would go negative within a few steps.
    const values = [800, 700, 600, 500, 400, 300];
    const points = holtDampedPositiveForecast(values, 60)!;
    for (const point of points) {
      expect(point).toBeGreaterThan(0);
    }
    // Damping: the far tail settles instead of continuing to collapse.
    const tailDrop = Math.abs(points[59] - points[54]);
    const headDrop = Math.abs(points[5] - points[0]);
    expect(tailDrop).toBeLessThan(headDrop);
  });
});
