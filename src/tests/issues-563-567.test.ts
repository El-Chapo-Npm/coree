import { describe, expect, it } from "vitest";
import { AdaptiveRateLimiter } from "../network/adaptiveRateLimiter";
import { MemoryCursorStore, PersistentEventDeduplicationStore } from "../streaming/cursorStore";
import { mapSorobanRpcError } from "../soroban/rpcErrorMapper";
import { SorokitErrorCode } from "../shared/response";
import { validateAmount } from "../shared/validation";
import { validateStroop, xlmToStroops, stroopsToXlm } from "../shared/amountValidation";

describe("issues #563-#567", () => {
  it("tracks Retry-After independently per endpoint", () => {
    const limiter = new AdaptiveRateLimiter({ now: () => 1_000 });
    limiter.recordResponse("rpc", { status: 429, headers: { get: () => "3" } });
    expect(limiter.getState("rpc")?.retryAfterMs).toBe(3_000);
    expect(limiter.getState("horizon")).toBeUndefined();
    limiter.recordResponse("rpc", { status: 200 });
    expect(limiter.getState("rpc")).toBeUndefined();
  });

  it("persists and clears cursors and deduplicates event IDs", async () => {
    const cursors = new MemoryCursorStore();
    await cursors.save("payments", "cursor-42");
    expect(await cursors.load("payments")).toBe("cursor-42");
    await cursors.clear("payments");
    expect(await cursors.load("payments")).toBeUndefined();
    const dedup = new PersistentEventDeduplicationStore();
    expect(await dedup.has("event-1")).toBe(false);
    await dedup.add("event-1");
    expect(await dedup.has("event-1")).toBe(true);
  });

  it.each([
    ["simulation failed", SorokitErrorCode.SOROBAN_SIMULATION_FAILED],
    ["insufficient fee", SorokitErrorCode.INSUFFICIENT_FEE],
    ["invalid auth", SorokitErrorCode.INVALID_AUTH],
    ["resource exhausted", SorokitErrorCode.RESOURCE_LIMIT_EXCEEDED],
    ["invalid XDR", SorokitErrorCode.XDR_INVALID],
    ["429 rate limit", SorokitErrorCode.RATE_LIMITED],
  ])("maps %s to a typed SDK code", (message, code) => {
    expect(mapSorobanRpcError({ message }).code).toBe(code);
  });

  it("preserves exact seven-decimal amount boundaries", () => {
    expect(validateAmount("0.0000001").status).toBe("ok");
    expect(validateAmount("0.12345678").status).toBe("error");
    expect(validateAmount("922337203685.4775807").status).toBe("ok");
    expect(validateAmount("922337203685.4775808").status).toBe("error");
    expect(validateStroop("9223372036854775807").status).toBe("ok");
    expect(xlmToStroops("0.1234567").data).toBe("1234567");
    expect(stroopsToXlm("1234567").data).toBe("0.1234567");
  });
});
