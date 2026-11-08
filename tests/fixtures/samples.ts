import { readFileSync } from "node:fs";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** A request sample from the guide, with its one_time_pin placeholder filled in. */
export function guideSample(name: string): Json {
  const sample = JSON.parse(
    readFileSync(`tests/fixtures/guide-requests/${name}.json`, "utf8"),
  );
  if (String(sample.one_time_pin).startsWith("<")) sample.one_time_pin = "123456";
  return sample;
}

/**
 * Conditional fields the guide's own samples leave out although the Data
 * Dictionary requires them. The Dictionary prevails (guide 1.4).
 */
export const GUIDE_SAMPLE_GAPS: Record<string, string[]> = {
  fpe: [
    "sochist.vape_current_years",
    "sochist.vape_former_years",
    "gynehist.menopause_age",
    "gynehist.gynecological_disease",
    "gynehist.gyn_sexually_transmitted_disease",
  ],
  consultation: [
    "sochist.vape_current_years",
    "sochist.vape_former_years",
    "sochist.substance_current_user_spec",
    "sexhist.sti_spec",
    "sf_obgyne_menshist.menopause_age",
    "sf_obgyne_menshist.gynecological_disease",
  ],
};

/** A guide sample with those gaps filled, so it passes every check. */
export function validSample(name: string): Json {
  const sample = guideSample(name);
  for (const path of GUIDE_SAMPLE_GAPS[name] ?? []) {
    const [group, field] = path.split(".");
    sample[group][field] = /_years$|_age$/.test(field) ? 1 : "Sample value";
  }
  return sample;
}
