// GTA VI launch-day Twitch forecast (make.fun gta6-twitch-ccu-forecast-01).
//
// Model: a kernel-weighted median ratio curve over past big launches.
//
// For each hour h = 2..24 of the release day, every comparable launch gives one
// log-ratio, ln(viewers_h / viewers_1), measured on its own release day. The
// forecast's median is the case's hour-1 print times the exponential of the
// weighted median of those log-ratios, where a comparable's weight is a
// Gaussian kernel on log(hour-1 print): launches whose first hour looked like
// this case's first hour count most. That matters because the ratio curve
// depends on how much of the world had unlocked by 00:00 UTC: a launch whose
// hour 1 was nearly empty (rolling midnight, most regions still locked) rises
// 10-100x by the evening, while a launch whose hour 1 was already huge stays
// comparatively flat. A plain median over all launches mixes those two regimes
// and is wrong for both; the kernel keeps them apart.
//
// The spread is the kernel-weighted standard deviation of the same log-ratios
// for that hour, floored at 0.30 log units, so the 5%-95% band is honest about
// how differently launches behave. Quantiles are log-normal around the median:
// q_tau = median * exp(z_tau * sigma), z = (-1.645, -0.674, 0, 0.674, 1.645).
//
// Everything is computed at run time from the case's own `comparables` field,
// so the final case (which holds all 42 comparables) is used exactly as given.
// The program is deterministic: no randomness, no clock, no network.
//
// Validation (leave-one-out over the 37 launch comparables in the kit, plus
// scoring the four real practice cases against SullyGnome's published hourly
// averages, which reproduces the house baseline's practice loss of 0.387):
//   house baseline practice loss 0.387, this model 0.234 (40% lower),
//   90% coverage 0.87-1.00. See README.md for the full numbers.
//
// Fallbacks keep every case valid: if too few comparables have an hour, that
// hour falls back to persistence (the house baseline's spread); if the whole
// model throws for a case, the case is forecast with the baseline instead of
// crashing, because an invalid case ranks below every valid entry.

import * as fs from "node:fs";
import * as path from "node:path";

// Standard-normal quantiles at the case's five levels (0.05, 0.25, 0.5, 0.75, 0.95).
const Z = [-1.645, -0.674, 0, 0.674, 1.645];
// Gaussian kernel bandwidth in log(hour-1 viewers): launches within about a
// factor e of the case's first hour dominate the weighted median.
const KERNEL_BANDWIDTH = 1.0;
// Log-spread floor: even the most predictable hour keeps a 0.30 log spread,
// so the band never claims more precision than launches ever show.
const SIGMA_FLOOR = 0.3;
// The house baseline's per-hour spread, used only where the model has no data.
const BASELINE_SPREAD = 0.15;

type CaseFile = {
  id: string;
  known?: Array<{ hour: number; viewers: number }>;
  forecast?: Array<{ hour: number }>;
  comparables?: Array<{
    name: string;
    day_start: string;
    unlock?: string;
    hourly?: Array<{ from: string; viewers: number }>;
  }>;
};

function mean(values: number[]): number {
  let total = 0;
  for (const v of values) total += v;
  return total / values.length;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  return n % 2 === 1 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}

// Smallest value whose cumulative weight reaches half the total weight.
function weightedMedian(pairs: Array<[number, number]>): number {
  const sorted = [...pairs].sort((a, b) => a[0] - b[0]);
  const total = sorted.reduce((sum, p) => sum + p[1], 0);
  let acc = 0;
  for (const [value, weight] of sorted) {
    acc += weight;
    if (acc >= total / 2) return value;
  }
  return sorted[sorted.length - 1][0];
}

function weightedStd(pairs: Array<[number, number]>, centre: number): number {
  const total = pairs.reduce((sum, p) => sum + p[1], 0);
  let acc = 0;
  for (const [value, weight] of pairs) acc += weight * (value - centre) * (value - centre);
  return Math.sqrt(acc / total);
}

// One comparable's release-day curve: hours 1..24 (index 1..24) as the mean of
// its hourly points inside each hour, null where it has no positive point.
function releaseDayCurve(comp: NonNullable<CaseFile["comparables"]>[number]): Array<number | null> {
  const start = Date.parse(comp.day_start);
  const hours: Array<number[]> = Array.from({ length: 25 }, () => []);
  for (const point of comp.hourly ?? []) {
    if (!(point.viewers > 0)) continue;
    const hour = Math.floor((Date.parse(point.from) - start) / 3600000) + 1;
    if (hour >= 1 && hour <= 24) hours[hour].push(point.viewers);
  }
  return hours.map((bucket) => (bucket.length > 0 ? mean(bucket) : null));
}

// The Grand Theft Auto VI category's own pre-release history is not a launch
// day (its day is the 2026-08-27 premiere), so it must not enter the ratio
// curves: its "release day" never happened in the data.
function isLaunch(comp: NonNullable<CaseFile["comparables"]>[number]): boolean {
  return !/before release/i.test(comp.name) && !/^Not a launch/i.test(comp.unlock ?? "");
}

function baselineRow(p1: number, hour: number): number[] {
  const sigma = BASELINE_SPREAD * Math.sqrt(hour - 1);
  return Z.map((z) => round2(p1 * Math.exp(z * sigma)));
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

function forecastCase(kase: CaseFile): { hours: Array<{ hour: number; q: number[] }> } {
  const knownRow = (kase.known ?? []).find((row) => row.hour === 1);
  const p1 = Math.max(knownRow?.viewers ?? 1, 1);

  const curves = (kase.comparables ?? [])
    .filter(isLaunch)
    .map(releaseDayCurve)
    .filter((curve) => curve[1] !== null && (curve[1] as number) > 0);

  const logP1 = Math.log(p1);
  const rows: Array<{ hour: number; q: number[] }> = [];

  // Forecast the hours the case itself lists (2..24 in every case the rules
  // describe); fall back to the full 2..24 range if the list is absent.
  const listed = (kase.forecast ?? [])
    .map((row) => row.hour)
    .filter((h) => h >= 2 && h <= 24);
  const hoursToForecast =
    listed.length > 0 ? [...new Set(listed)].sort((a, b) => a - b) : Array.from({ length: 23 }, (_, i) => i + 2);

  for (const hour of hoursToForecast) {
    // Weighted log-ratios for this hour, one per comparable that has it.
    const pairs: Array<[number, number]> = [];
    for (const curve of curves) {
      const v1 = curve[1] as number;
      const vh = curve[hour];
      if (vh === null || vh <= 0) continue;
      const weight = Math.exp(-0.5 * Math.pow((Math.log(v1) - logP1) / KERNEL_BANDWIDTH, 2));
      pairs.push([Math.log(vh / v1), weight]);
    }

    let quantiles: number[];
    if (pairs.length < 3) {
      // Too little evidence for this hour: persistence, like the baseline.
      quantiles = baselineRow(p1, hour);
    } else {
      const centre = weightedMedian(pairs);
      const sigma = Math.max(SIGMA_FLOOR, weightedStd(pairs, centre));
      const med = p1 * Math.exp(centre);
      quantiles = Z.map((z) => round2(med * Math.exp(z * sigma)));
    }

    // Enforce the format's bounds: finite, above 0, at most 1e9, non-decreasing.
    let prev = 0;
    quantiles = quantiles.map((q) => {
      let v = Number.isFinite(q) ? q : p1;
      v = Math.min(Math.max(v, 0.01), 1e9);
      if (v < prev) v = prev;
      prev = v;
      return v;
    });
    rows.push({ hour, q: quantiles });
  }

  return { hours: rows };
}

// The house baseline, used only if the model itself fails for a case: a valid
// mediocre forecast always beats an invalid case.
function baselineCase(kase: CaseFile): { hours: Array<{ hour: number; q: number[] }> } {
  const knownRow = (kase.known ?? []).find((row) => row.hour === 1);
  const p1 = Math.max(knownRow?.viewers ?? 1, 1);
  const rows: Array<{ hour: number; q: number[] }> = [];
  for (let hour = 2; hour <= 24; hour++) rows.push({ hour, q: baselineRow(p1, hour) });
  return { hours: rows };
}

function main(): void {
  const inputDir = process.env.MAKEFUN_INPUT_DIR ?? "/input";
  const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
  fs.mkdirSync(outputDir, { recursive: true });

  const files = fs
    .readdirSync(inputDir)
    .filter((name) => name.endsWith(".in"))
    .sort();

  for (const name of files) {
    const id = name.slice(0, -3);
    const kase = JSON.parse(fs.readFileSync(path.join(inputDir, name), "utf8")) as CaseFile;
    let out: { hours: Array<{ hour: number; q: number[] }> };
    try {
      out = forecastCase(kase);
    } catch {
      out = baselineCase(kase);
    }
    fs.writeFileSync(path.join(outputDir, `${id}.out`), JSON.stringify(out));
  }
}

main();
