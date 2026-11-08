// Values the backend recomputes and rejects on a mismatch (guide 4.6.1).

function parseUsDate(value: unknown) {
  const match = String(value ?? "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  return { month: Number(match[1]), day: Number(match[2]), year: Number(match[3]) };
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function ageOn(birth: unknown, on: unknown) {
  const start = parseUsDate(birth);
  const end = parseUsDate(on);
  if (!start || !end) return null;

  let years = end.year - start.year;
  let months = end.month - start.month;
  let days = end.day - start.day;

  if (days < 0) {
    months -= 1;
    // Count the days from the last whole month, clamped to that month's length.
    const totalMonths = end.year * 12 + end.month - 2;
    const anchorYear = Math.floor(totalMonths / 12);
    const anchorMonth = (totalMonths % 12) + 1;
    const anchorDay = Math.min(start.day, daysInMonth(anchorYear, anchorMonth));
    days =
      (Date.UTC(end.year, end.month - 1, end.day) - Date.UTC(anchorYear, anchorMonth - 1, anchorDay)) /
      86_400_000;
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  if (years < 0) return null;
  return { years, months, days, totalMonths: years * 12 + months };
}

/** Format from the Data Dictionary, for example 1 YR(S), 0 MO(S), 25 DAY(S). */
export function ageText(birth: unknown, on: unknown) {
  const age = ageOn(birth, on);
  return age ? `${age.years} YR(S), ${age.months} MO(S), ${age.days} DAY(S)` : "";
}

/** Weight in kg divided by height in metres squared, to 2 decimals. */
export function computeBmi(weightKg: unknown, heightCm: unknown) {
  const weight = Number(weightKg);
  const metres = Number(heightCm) / 100;
  if (!(weight > 0) || !(metres > 0)) return undefined;
  return Math.round((weight / (metres * metres)) * 100) / 100;
}
