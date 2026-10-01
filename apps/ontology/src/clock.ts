/**
 * Anchors the global clock at COURSE_NOW so demos run against a fixed
 * "course time" instead of the real wall clock.
 *
 * Effect (only when COURSE_NOW is set):
 *   - Date.now()      -> anchored time, advancing in real time from boot
 *   - new Date()      -> the same anchored time
 *   - new Date(value) -> parses/constructs normally (unchanged)
 *
 * Import this module *before* any route handler runs (i.e. first thing in
 * index.ts) so every handler sees the anchored clock.
 */

const anchor = process.env.COURSE_NOW;

if (anchor) {
  const RealDate = Date;
  const anchorMs = RealDate.parse(anchor);
  if (Number.isNaN(anchorMs)) {
    throw new Error(`Invalid COURSE_NOW value: "${anchor}"`);
  }

  // Offset from the real clock, captured once at boot. Adding it to the real
  // "now" makes anchored time advance at normal speed from COURSE_NOW.
  const offset = anchorMs - RealDate.now();
  const anchoredNow = () => RealDate.now() + offset;

  class AnchoredDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) {
        super(anchoredNow());
      } else {
        // @ts-ignore - forward every Date constructor overload unchanged
        super(...args);
      }
    }

    static now(): number {
      return anchoredNow();
    }
  }

  globalThis.Date = AnchoredDate as unknown as DateConstructor;

  console.log(
    `Clock anchored at COURSE_NOW=${new RealDate(anchorMs).toISOString()}`,
  );
}
