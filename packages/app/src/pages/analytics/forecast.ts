/**
 * Honest linear forecast: OLS regression over a monthly series with real
 * inference — slope standard error, two-sided p-value from the t
 * distribution, R², and per-step 95% PREDICTION intervals (not the narrower
 * mean-response band). Pure math, unit tested; no library.
 */

export interface ForecastPoint {
  /** Steps after the last observed point (1-based). */
  step: number;
  predicted: number;
  lower95: number;
  upper95: number;
}

export interface LinearForecast {
  slope: number;
  intercept: number;
  /** Standard error of the slope. */
  slopeSE: number;
  /** Two-sided p-value for H0: slope = 0. */
  pValue: number;
  rSquared: number;
  /** Residual degrees of freedom (n − 2). */
  df: number;
  points: ForecastPoint[];
}

/** Regularized incomplete beta function I_x(a, b) via continued fraction. */
function incompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  // Use the symmetry I_x(a,b) = 1 − I_{1−x}(b,a) where the CF converges best.
  if (x > (a + 1) / (a + b + 2)) {
    return 1 - incompleteBeta(1 - x, b, a);
  }
  const lnFront =
    logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x);
  const front = Math.exp(lnFront) / a;
  // Lentz's algorithm for the continued fraction.
  const EPS = 1e-12;
  let f = 1;
  let c = 1;
  let d = 0;
  for (let i = 0; i <= 200; i += 1) {
    const m = Math.floor(i / 2);
    let numerator: number;
    if (i === 0) {
      numerator = 1;
    } else if (i % 2 === 0) {
      numerator = (m * (b - m) * x) / ((a + 2 * m - 1) * (a + 2 * m));
    } else {
      numerator = -((a + m) * (a + b + m) * x) / ((a + 2 * m) * (a + 2 * m + 1));
    }
    d = 1 + numerator * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    d = 1 / d;
    c = 1 + numerator / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    f *= c * d;
    if (Math.abs(1 - c * d) < EPS) break;
  }
  return front * (f - 1);
}

function logGamma(z: number): number {
  // Lanczos approximation.
  const g = [
    676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (z < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  }
  const x = z - 1;
  let acc = 0.99999999999980993;
  for (let i = 0; i < g.length; i += 1) acc += g[i] / (x + i + 1);
  const t = x + g.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(acc);
}

/** Two-sided p-value for a t statistic with `df` degrees of freedom. */
export function tTwoSidedP(t: number, df: number): number {
  if (df <= 0) return 1;
  const x = df / (df + t * t);
  return incompleteBeta(x, df / 2, 0.5);
}

/** Inverse of the two-sided t quantile at 95% (t such that P(|T|>t)=0.05). */
export function tCritical95(df: number): number {
  if (df <= 0) return Infinity;
  // Bisection on the monotone p-value; ample bounds for any df ≥ 1.
  let lo = 0;
  let hi = 1000;
  for (let i = 0; i < 100; i += 1) {
    const mid = (lo + hi) / 2;
    if (tTwoSidedP(mid, df) > 0.05) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return (lo + hi) / 2;
}

/**
 * Fit y = a + b·x over x = 0..n−1 and project `horizon` steps ahead.
 * Returns null when there are fewer than 4 points or no variance to fit.
 */
export function linearForecast(values: number[], horizon: number): LinearForecast | null {
  const n = values.length;
  if (n < 4) return null;
  const xMean = (n - 1) / 2;
  const yMean = values.reduce((sum, v) => sum + v, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i += 1) {
    sxx += (i - xMean) ** 2;
    sxy += (i - xMean) * (values[i] - yMean);
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  const intercept = yMean - slope * xMean;

  let sse = 0;
  let sst = 0;
  for (let i = 0; i < n; i += 1) {
    sse += (values[i] - (intercept + slope * i)) ** 2;
    sst += (values[i] - yMean) ** 2;
  }
  const df = n - 2;
  const sigma2 = sse / df;
  const slopeSE = Math.sqrt(sigma2 / sxx);
  const tStat = slopeSE > 0 ? slope / slopeSE : Infinity;
  const pValue = slopeSE > 0 ? tTwoSidedP(Math.abs(tStat), df) : 0;
  const rSquared = sst > 0 ? 1 - sse / sst : 1;
  const tCrit = tCritical95(df);

  const points: ForecastPoint[] = [];
  for (let step = 1; step <= horizon; step += 1) {
    const x0 = n - 1 + step;
    const predicted = intercept + slope * x0;
    // Prediction interval: new-observation variance, not mean-response.
    const se = Math.sqrt(sigma2 * (1 + 1 / n + (x0 - xMean) ** 2 / sxx));
    points.push({
      step,
      predicted,
      lower95: predicted - tCrit * se,
      upper95: predicted + tCrit * se,
    });
  }

  return { slope, intercept, slopeSE, pValue, rSquared, df, points };
}

// ---------------------------------------------------------------------------
// Alternative baseline models for the scenario planner

export interface SimpleTrend {
  slope: number;
  intercept: number;
  points: number[];
}

/**
 * Theil–Sen robust trend: slope = median of all pairwise slopes, intercept =
 * median of (y − slope·x). Outlier months (a one-off tax bill, a bonus)
 * barely move it, unlike OLS. No distributional inference — it's a point
 * forecast.
 */
export function theilSenForecast(values: number[], horizon: number): SimpleTrend | null {
  const n = values.length;
  if (n < 4) return null;
  const slopes: number[] = [];
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      slopes.push((values[j] - values[i]) / (j - i));
    }
  }
  const slope = median(slopes);
  const intercept = median(values.map((value, index) => value - slope * index));
  return {
    slope,
    intercept,
    points: Array.from({ length: horizon }, (_, step) => intercept + slope * (n - 1 + step + 1)),
  };
}

/**
 * Seasonal average: each future month predicted as the mean of the SAME
 * calendar month in history (Decembers predict December). Falls back to the
 * overall mean for calendar months with no history. Only meaningful with
 * ≥ 12 months of history — callers should gate on that.
 */
export function seasonalAverageForecast(
  values: number[],
  monthKeys: string[],
  futureMonthKeys: string[]
): number[] {
  const byCalendarMonth = new Map<string, number[]>();
  values.forEach((value, index) => {
    const calendarMonth = monthKeys[index]?.slice(5, 7);
    if (!calendarMonth) return;
    const bucket = byCalendarMonth.get(calendarMonth) ?? [];
    bucket.push(value);
    byCalendarMonth.set(calendarMonth, bucket);
  });
  const overallMean = values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
  return futureMonthKeys.map((monthKey) => {
    const bucket = byCalendarMonth.get(monthKey.slice(5, 7));
    if (!bucket || bucket.length === 0) return overallMean;
    return bucket.reduce((sum, value) => sum + value, 0) / bucket.length;
  });
}

function median(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const list = [...sorted].sort((a, b) => a - b);
  const mid = Math.floor(list.length / 2);
  return list.length % 2 === 0 ? (list[mid - 1] + list[mid]) / 2 : list[mid];
}

export interface HoltForecast {
  alpha: number;
  beta: number;
  /** Damping φ — future trend increments shrink by φ each step. */
  phi: number;
  points: number[];
}

/**
 * Damped-trend exponential smoothing (Holt with damping) — a consistent
 * top performer on short monthly series in the M-competitions. Level and
 * trend update recursively; the forecast trend is damped by φ so it
 * flattens instead of extrapolating forever (the honest assumption for
 * household finances). α/β/φ are chosen by SSE grid search over the
 * one-step-ahead in-sample errors.
 */
export function holtDampedForecast(values: number[], horizon: number): HoltForecast | null {
  const n = values.length;
  if (n < 5) return null;

  const fitSse = (alpha: number, beta: number, phi: number): number => {
    let level = values[0];
    let trend = values[1] - values[0];
    let sse = 0;
    for (let t = 1; t < n; t += 1) {
      const prediction = level + phi * trend;
      const error = values[t] - prediction;
      sse += error * error;
      const previousLevel = level;
      level = alpha * values[t] + (1 - alpha) * (previousLevel + phi * trend);
      trend = beta * (level - previousLevel) + (1 - beta) * phi * trend;
    }
    return sse;
  };

  let best = { alpha: 0.5, beta: 0.1, phi: 0.9, sse: Infinity };
  for (let alpha = 0.1; alpha <= 0.9; alpha += 0.1) {
    for (let beta = 0.05; beta <= 0.5; beta += 0.05) {
      for (let phi = 0.8; phi <= 0.98; phi += 0.03) {
        const sse = fitSse(alpha, beta, phi);
        if (sse < best.sse) best = { alpha, beta, phi, sse };
      }
    }
  }

  // Re-run the recursion with the winning parameters to get final state.
  const { alpha, beta, phi } = best;
  let level = values[0];
  let trend = values[1] - values[0];
  for (let t = 1; t < n; t += 1) {
    const previousLevel = level;
    level = alpha * values[t] + (1 - alpha) * (previousLevel + phi * trend);
    trend = beta * (level - previousLevel) + (1 - beta) * phi * trend;
  }

  const points: number[] = [];
  let dampSum = 0;
  for (let step = 1; step <= horizon; step += 1) {
    dampSum += phi ** step;
    points.push(level + dampSum * trend);
  }
  return { alpha, beta, phi, points };
}

/**
 * Damped Holt for strictly-positive money series: fits in log space, so the
 * trend is MULTIPLICATIVE and the damped forecast plateaus at a positive
 * level instead of crossing zero (an additive fit on declining spending
 * happily forecasts negative money, which clamps into "spending vanishes").
 */
export function holtDampedPositiveForecast(values: number[], horizon: number): number[] | null {
  const logs = values.map((value) => Math.log1p(Math.max(0, value)));
  const fit = holtDampedForecast(logs, horizon);
  if (!fit) return null;
  return fit.points.map((point) => Math.max(0, Math.expm1(point)));
}
