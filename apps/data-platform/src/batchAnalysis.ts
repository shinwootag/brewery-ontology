/**
 * Pure analysis helpers for the Batch Investigation Workspace.
 *
 * All date reasoning is done by the caller against course time (COURSE_NOW),
 * which is passed in explicitly — nothing here reads the wall clock.
 */

export type SugarStatus = "ok" | "warn" | "bad";

/* ---- Shapes returned by the instance list route (raw snake_case rows) ---- */

export interface Batch {
  id: string;
  recipe_id: string | null;
  status: string;
  current_sugar_level: string | null;
  current_temperature: string | null;
  days_fermenting: number | null;
  planned_start: string | null;
  last_operator_note: string | null;
  assigned_tank_id: string | null;
  [key: string]: unknown;
}

export interface Recipe {
  id: string;
  name: string;
  target_sugar_curve: Record<string, number> | null;
  fermentation_days: number | null;
  notes: string | null;
  [key: string]: unknown;
}

export interface Tank {
  id: string;
  name: string;
  status: string;
  [key: string]: unknown;
}

export interface MaintenanceLog {
  id: string;
  target_type: string;
  target_id: string;
  type: string | null;
  status: string | null;
  notes: string | null;
  started_at: string | null;
  completed_at: string | null;
  [key: string]: unknown;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const round4 = (n: number) => Math.round(n * 1e4) / 1e4;

/**
 * Linearly interpolate the target sugar level for `day` from a sparse
 * `{ day_1: 1.05, day_4: 1.035, ... }` curve. Clamps to the first/last point
 * outside the curve's range. Returns null when the curve or day is missing.
 */
export function targetSugarAt(
  curve: Record<string, number> | null | undefined,
  day: number | null,
): number | null {
  if (!curve || day == null) return null;

  const pts = Object.entries(curve)
    .map(([k, v]) => [Number(k.replace(/^day_/, "")), Number(v)] as [number, number])
    .filter(([d, v]) => Number.isFinite(d) && Number.isFinite(v))
    .sort((a, b) => a[0] - b[0]);

  if (pts.length === 0) return null;
  if (day <= pts[0][0]) return pts[0][1];
  if (day >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];

  for (let i = 0; i < pts.length - 1; i++) {
    const [d0, v0] = pts[i];
    const [d1, v1] = pts[i + 1];
    if (day >= d0 && day <= d1) {
      return v0 + (v1 - v0) * ((day - d0) / (d1 - d0));
    }
  }
  return pts[pts.length - 1][1];
}

/** Colour band for |current − target|: green ≤ 0.005, amber ≤ 0.008, red beyond. */
export function classifySugar(delta: number): SugarStatus {
  const magnitude = Math.abs(delta);
  if (magnitude <= 0.005) return "ok";
  if (magnitude <= 0.008) return "warn";
  return "bad";
}

export interface BatchAnalysis {
  /** current − target: positive means sugar is above the curve (behind schedule). */
  delta: number | null;
  status: SugarStatus | null;
  /** true when the batch is 0.008 or more behind target. */
  behind: boolean;
}

export function analyzeBatch(batch: Batch, recipe: Recipe | undefined): BatchAnalysis {
  const target = targetSugarAt(recipe?.target_sugar_curve, batch.days_fermenting);
  const current =
    batch.current_sugar_level == null ? null : Number(batch.current_sugar_level);

  if (target == null || current == null || !Number.isFinite(current)) {
    return { delta: null, status: null, behind: false };
  }

  const delta = round4(current - target);
  return { delta, status: classifySugar(delta), behind: delta >= 0.008 };
}

export interface FermentationWindow {
  start: Date;
  end: Date;
}

/**
 * The batch's fermentation window: [planned_start, planned_start + fermentation_days].
 * Falls back to `now − days_fermenting` for the start when planned_start is missing.
 * Returns null when neither a start date nor an elapsed-days figure is available.
 */
export function fermentationWindow(
  batch: Batch,
  recipe: Recipe | undefined,
  now: Date,
): FermentationWindow | null {
  let start: Date | null = null;
  if (batch.planned_start) {
    const d = new Date(batch.planned_start);
    if (!Number.isNaN(d.getTime())) start = d;
  }
  if (!start && batch.days_fermenting != null) {
    start = new Date(now.getTime() - batch.days_fermenting * DAY_MS);
  }
  if (!start) return null;

  const days =
    recipe?.fermentation_days && recipe.fermentation_days > 0
      ? recipe.fermentation_days
      : (batch.days_fermenting ?? 0);
  return { start, end: new Date(start.getTime() + days * DAY_MS) };
}

/** Whether an ISO timestamp falls within the given window (inclusive). */
export function isWithinWindow(
  dateStr: string | null | undefined,
  window: FermentationWindow | null,
): boolean {
  if (!dateStr || !window) return false;
  const t = new Date(dateStr).getTime();
  if (Number.isNaN(t)) return false;
  return t >= window.start.getTime() && t <= window.end.getTime();
}

/** Tank ids whose maintenance fell within the 7 days ending at `now` (course time). */
export function recentMaintenanceTankIds(
  logs: MaintenanceLog[],
  now: Date,
): Set<string> {
  const nowMs = now.getTime();
  const windowStart = nowMs - 7 * DAY_MS;
  const tanks = new Set<string>();

  for (const log of logs) {
    if (log.target_type !== "tank") continue;
    const stamp = log.completed_at ?? log.started_at;
    if (!stamp) continue;
    const t = new Date(stamp).getTime();
    if (Number.isNaN(t)) continue;
    if (t >= windowStart && t <= nowMs) tanks.add(log.target_id);
  }
  return tanks;
}
