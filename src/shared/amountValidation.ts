import { SorokitErrorCode, err, ok } from "./response";
import type { SorokitResult } from "./response";

export const STROOPS_PER_XLM = 10_000_000n;
export const MAX_STROOPS = 9_223_372_036_854_775_807n;
export const MAX_AMOUNT = "922337203685.4775807";

function invalid(message: string): SorokitResult<never> {
  return err(SorokitErrorCode.VALIDATION, message);
}

function parseDecimal(value: string | number): { negative: boolean; stroops: bigint; normalized: string } | SorokitResult<never> {
  const raw = typeof value === "number" ? String(value) : value;
  if (typeof raw !== "string" || raw.trim() === "") return invalid("Amount must be a non-empty decimal string.");
  const normalized = raw.trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return invalid(`Amount "${normalized}" must be a plain decimal without exponent notation.`);
  const negative = normalized.startsWith("-");
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  if (fraction.length > 7) return invalid(`Amount "${normalized}" has more than 7 decimal places (stroop precision).`);
  const stroops = BigInt(whole) * STROOPS_PER_XLM + BigInt(fraction.padEnd(7, "0"));
  return { negative, stroops, normalized };
}

/** Validate a positive Stellar amount with exact 7-decimal fixed-point arithmetic. */
export function validateAmount(value: string | number): SorokitResult<string> {
  const parsed = parseDecimal(value);
  if ("status" in parsed) return parsed;
  if (parsed.negative || parsed.stroops === 0n) return invalid("Amount must be greater than zero.");
  if (parsed.stroops > MAX_STROOPS) return invalid(`Amount exceeds the Stellar maximum of ${MAX_AMOUNT} XLM.`);
  return ok(parsed.normalized);
}

/** Validate an integer stroop amount, preserving values beyond Number.MAX_SAFE_INTEGER. */
export function validateStroop(value: string | number | bigint): SorokitResult<string> {
  const text = typeof value === "bigint" ? value.toString() : typeof value === "number" ? String(value) : value.trim();
  if (!/^(?:0|[1-9]\d*)$/.test(text)) return invalid("Stroops must be a non-negative decimal integer.");
  const stroops = BigInt(text);
  if (stroops > MAX_STROOPS) return invalid("Stroop value exceeds the Stellar int64 maximum.");
  return ok(text);
}

export function xlmToStroops(value: string | number): SorokitResult<string> {
  const valid = validateAmount(value);
  if (valid.status === "error") return valid;
  const parsed = parseDecimal(valid.data);
  if ("status" in parsed) return parsed;
  return ok(parsed.stroops.toString());
}

export function stroopsToXlm(value: string | number | bigint): SorokitResult<string> {
  const valid = validateStroop(value);
  if (valid.status === "error") return valid;
  const stroops = BigInt(valid.data);
  const whole = stroops / STROOPS_PER_XLM;
  const fraction = (stroops % STROOPS_PER_XLM).toString().padStart(7, "0");
  return ok(`${whole}.${fraction}`.replace(/\.0+$/, ""));
}
