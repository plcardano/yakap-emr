const SECRET_KEYS = new Set([
  "password",
  "secret_key",
  "software_cert_id",
  "cipher_key",
  "access_token",
  "launch_token",
  "valid_id_image",
  "one_time_pin",
  "authorization",
]);

const PIN_KEYS = new Set(["pin", "patient_pin", "member_pin"]);
const BIRTH_DATE_KEYS = new Set(["birth_date", "patient_dob", "member_dob"]);

export function maskPin(pin: string) {
  if (pin.length < 6) return "*****";
  return `${pin.slice(0, 4)}-*****-${pin.slice(-2)}`;
}

export function maskBirthDate(date: string) {
  const year = date.match(/\b\d{4}\b/)?.[0];
  return year ? `**/**/${year}` : "**/**/****";
}

/** Copies a value for logging, with secrets removed and identifiers masked (guide 3.5). */
export function maskForLog(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskForLog);
  if (value === null || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, field]) => {
      const name = key.toLowerCase();
      if (SECRET_KEYS.has(name)) return [key, "[REDACTED]"];
      if (typeof field === "string" && PIN_KEYS.has(name)) {
        return [key, maskPin(field)];
      }
      if (typeof field === "string" && BIRTH_DATE_KEYS.has(name)) {
        return [key, maskBirthDate(field)];
      }
      return [key, maskForLog(field)];
    }),
  );
}
