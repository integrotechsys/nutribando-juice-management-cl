// Forecasting maths (no dependencies, so it can be tested on its own).
import { addDays, dow } from './dates.js';

export const sum = (arr, f = (x) => x) => arr.reduce((a, x) => a + (Number(f(x)) || 0), 0);

/** Fill every day between from..to (inclusive) with the value in `map` (0 when missing). */
export function dailySeries(map, from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push({ date: d, v: map[d] || 0 });
  return out;
}

/** Least-squares straight line through ys (x = 0..n-1). */
export function linreg(ys) {
  const n = ys.length;
  const mx = (n - 1) / 2;
  const my = sum(ys) / n;
  let num = 0, den = 0;
  ys.forEach((y, i) => { num += (i - mx) * (y - my); den += (i - mx) ** 2; });
  const slope = den ? num / den : 0;
  return { slope, intercept: my - slope * mx };
}

/**
 * Project the next `horizon` days after the last day of `series`.
 *  trend    : follow the recent up/down trend (needs 14+ days)
 *  seasonal : adjust for weekday pattern, e.g. busy weekends (needs 28+ days)
 * The trend is kept within 50%–150% of the average so one odd week cannot explode the forecast.
 */
export function project(series, horizon, { trend = true, seasonal = true } = {}) {
  const n = series.length;
  if (!n) return [];
  const ys = series.map((s) => s.v);
  const avg = sum(ys) / n;
  let slope = 0, intercept = avg;
  if (trend && n >= 14) ({ slope, intercept } = linreg(ys));

  let f = [1, 1, 1, 1, 1, 1, 1];
  if (seasonal && n >= 28 && avg > 0) {
    const sums = Array(7).fill(0), cnt = Array(7).fill(0);
    series.forEach((s) => { const d = dow(s.date); sums[d] += s.v; cnt[d]++; });
    f = sums.map((s, i) => (cnt[i] ? s / cnt[i] / avg : 1));
  }

  const out = [];
  let d = series[n - 1].date;
  for (let t = 1; t <= horizon; t++) {
    d = addDays(d, 1);
    let base = intercept + slope * (n - 1 + t);
    base = Math.min(Math.max(base, avg * 0.5), avg * 1.5);
    out.push({ date: d, v: Math.max(0, base * f[dow(d)]) });
  }
  return out;
}

export const total = (proj, days) => sum(proj.slice(0, days), (p) => p.v);
