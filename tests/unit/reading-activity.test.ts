import {expect,it} from "vitest";
import {readingDate,readingDates} from "@/modules/personal/domain/reading-activity";
it("uses Taipei midnight and returns ordered calendar days across month/year boundaries",()=>{
 expect(readingDate(new Date("2026-12-31T15:59:59Z"))).toBe("2026-12-31");
 expect(readingDate(new Date("2026-12-31T16:00:00Z"))).toBe("2027-01-01");
 expect(readingDates(new Date("2026-12-31T16:00:00Z"),7)).toEqual(["2026-12-26","2026-12-27","2026-12-28","2026-12-29","2026-12-30","2026-12-31","2027-01-01"]);
});
