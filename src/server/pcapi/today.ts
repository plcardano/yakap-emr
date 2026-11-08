import { manilaDate } from "./record-number-format";

/** Today in Philippine Standard Time, as MM/DD/YYYY. */
export function todayUs() {
  const [year, month, day] = manilaDate().split("-");
  return `${month}/${day}/${year}`;
}
