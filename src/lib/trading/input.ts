/**
 * Cleans what a person types (or pastes) into an amount or price box, so that "0,02" and "0.02" both mean two hundredths.
 * The box used to strip everything except digits and ".", which silently turned a Spanish "0,02" into "002" — TWO SOL.
 *
 * The LAST "." or "," is the decimal mark; any other separator before it is a thousands separator and is dropped
 * ("1.234,5" → "1234.5", "1,5" → "1.5", "0," → "0." so typing can continue). Everything that isn't a digit is removed.
 * The result always uses "." and is safe for parseFloat.
 */
export function sanitizeDecimalInput(raw: string): string {
  const cleaned = raw.replace(/[^0-9.,]/g, "");
  const last = Math.max(cleaned.lastIndexOf("."), cleaned.lastIndexOf(","));
  if (last === -1) return cleaned;
  const whole = cleaned.slice(0, last).replace(/[.,]/g, "");
  const fraction = cleaned.slice(last + 1).replace(/[.,]/g, "");
  return `${whole}.${fraction}`;
}
