const courseNow = process.env.COURSE_NOW;

if (courseNow) {
  const RealDate = Date;
  const offset = new RealDate(courseNow).getTime() - RealDate.now();

  class AnchoredDate extends RealDate {
    constructor(...args: any[]) {
      if (args.length === 0) {
        super(RealDate.now() + offset);
      } else {
        // @ts-expect-error spread into Date constructor
        super(...args);
      }
    }
    static now() {
      return RealDate.now() + offset;
    }
  }

  globalThis.Date = AnchoredDate as DateConstructor;
  console.log(`[time-anchor] Clock anchored to ${new Date().toISOString()}`);
}

export {};
