/**
 * "Course time" — the anchored current time the app computes date windows
 * against. COURSE_NOW is injected at build time from the repo-root .env
 * (see vite.config.ts) as import.meta.env.VITE_COURSE_NOW.
 *
 * The frontend Date object is NOT overridden (that is a server-only concern),
 * so any "now" in this app must go through courseNow().
 */

const raw = import.meta.env.VITE_COURSE_NOW as string | undefined;

export function courseNow(): Date {
  if (raw) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d;
    console.warn(`Invalid VITE_COURSE_NOW="${raw}", falling back to wall clock`);
  }
  return new Date();
}
