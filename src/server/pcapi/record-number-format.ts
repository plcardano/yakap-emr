export type RecordPrefix = "T" | "E" | "P" | "S" | "D" | "L" | "M" | "R";

const MAX_SERIES = 99999;

/** YYYY-MM-DD in Philippine Standard Time, the time zone of PCAPI dates. */
export function manilaDate(at: Date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/** Prefix + accre_no + YYYYMMDD + 5-digit daily series (guide 3.9). */
export function formatRecordNumber(
  prefix: RecordPrefix,
  accreNo: string,
  isoDate: string,
  series: number,
) {
  if (accreNo.length !== 9) throw new Error("accre_no must be 9 characters");
  if (series < 1 || series > MAX_SERIES) {
    throw new Error(`Record number series ${series} is out of range`);
  }
  return `${prefix}${accreNo}${isoDate.replaceAll("-", "")}${String(series).padStart(5, "0")}`;
}
