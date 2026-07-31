import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createLogger,
  withLogging,
  type SorokitLogger,
  type StructuredLogMeta,
} from "../shared/logger";
import { ok, err, SorokitErrorCode } from "../shared/response";
import { createSorokitClient } from "../client/createSorokitClient";

function createCapturingLogger(): {
  logger: SorokitLogger;
  calls: Array<{ level: string; message: string; meta?: StructuredLogMeta }>;
} {
  const calls: Array<{ level: string; message: string; meta?: StructuredLogMeta }> =
    [];

  const logger: SorokitLogger = {
    debug: (message, meta) => calls.push({ level: "debug", message, meta }),
    info: (message, meta) => calls.push({ level: "info", message, meta }),
    warn: (message, meta) => calls.push({ level: "warn", message, meta }),
    error: (message, meta) => calls.push({ level: "error", message, meta }),
  };

  return { logger, calls };
}

describe("shared/logger", () => {
  describe("createLogger", () => {
    it("returns a no-op logger when log level is off", () => {
      const logger = createLogger({ logLevel: "off" });
      expect(() => logger.debug("silent")).not.toThrow();
      expect(() => logger.info("silent")).not.toThrow();
    });

    it("returns a no-op logger by default", () => {
      const logger = createLogger();
      expect(() => logger.warn("silent")).not.toThrow();
    });

    it("uses a custom logger when provided", () => {
      const { logger: custom, calls } = createCapturingLogger();
      const logger = createLogger({ logLevel: "debug", logger: custom });
      logger.info("custom sink", { operation: "test" });
      expect(calls).toHaveLength(1);
      expect(calls[0]?.message).toBe("custom sink");
    });

    it("maps debug: true to debug log level", () => {
      const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => undefined);
      const logger = createLogger({ debug: true });
      logger.debug("enabled");
      expect(debugSpy).toHaveBeenCalled();
      debugSpy.mockRestore();
    });

    it("filters messages below the configured log level", () => {
      const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => undefined);
      const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);

      const logger = createLogger({ logLevel: "info" });
      logger.debug("hidden");
      logger.info("visible");

      expect(debugSpy).not.toHaveBeenCalled();
      expect(infoSpy).toHaveBeenCalled();

      debugSpy.mockRestore();
      infoSpy.mockRestore();
    });

    it("includes structured fields in console output", () => {
      const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
      const logger = createLogger({ logLevel: "info" });

      logger.info("account.get", {
        operation: "account.get",
        status: "ok",
        publicKey: "GTEST",
      });

      expect(infoSpy).toHaveBeenCalledWith(
        "[sorokit]",
        expect.objectContaining({
          level: "info",
          message: "account.get",
          operation: "account.get",
          status: "ok",
          publicKey: "GTEST",
          timestamp: expect.any(String),
        }),
      );

      infoSpy.mockRestore();
    });

    it("debug: false returns a logger where all four methods produce no output", () => {
      const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => undefined);
      const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

      const logger = createLogger({ debug: false });
      logger.debug("silent");
      logger.info("silent");
      logger.warn("silent");
      logger.error("silent");

      expect(debugSpy).not.toHaveBeenCalled();
      expect(infoSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();

      debugSpy.mockRestore();
      infoSpy.mockRestore();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it("debug: false never calls a custom logger", () => {
      const { logger: custom, calls } = createCapturingLogger();
      const logger = createLogger({ debug: false, logger: custom });
      logger.debug("silent");
      logger.info("silent");
      logger.warn("silent");
      logger.error("silent");
      expect(calls).toHaveLength(0);
    });

    it("debug: true calls console.debug with the [sorokit] prefix", () => {
      const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => undefined);
      const logger = createLogger({ debug: true });
      logger.debug("hello");
      expect(debugSpy).toHaveBeenCalledWith(
        "[sorokit]",
        expect.objectContaining({ level: "debug", message: "hello" }),
      );
      debugSpy.mockRestore();
    });

    it("debug: true calls console.info for info messages", () => {
      const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
      const logger = createLogger({ debug: true });
      logger.info("hello");
      expect(infoSpy).toHaveBeenCalledWith(
        "[sorokit]",
        expect.objectContaining({ level: "info", message: "hello" }),
      );
      infoSpy.mockRestore();
    });

    it("debug: true calls console.warn for warn messages", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const logger = createLogger({ debug: true });
      logger.warn("hello");
      expect(warnSpy).toHaveBeenCalledWith(
        "[sorokit]",
        expect.objectContaining({ level: "warn", message: "hello" }),
      );
      warnSpy.mockRestore();
    });

    it("debug: true calls console.error for error messages", () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const logger = createLogger({ debug: true });
      logger.error("hello");
      expect(errorSpy).toHaveBeenCalledWith(
        "[sorokit]",
        expect.objectContaining({ level: "error", message: "hello" }),
      );
      errorSpy.mockRestore();
    });

    it("meta is passed through to console output", () => {
      const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => undefined);
      const logger = createLogger({ debug: true });
      logger.debug("test", { key: "value", num: 42 });
      expect(debugSpy).toHaveBeenCalledWith(
        "[sorokit]",
        expect.objectContaining({
          level: "debug",
          message: "test",
          key: "value",
          num: 42,
        }),
      );
      debugSpy.mockRestore();
    });
  });

  describe("withLogging", () => {
    it("logs start, success, and error results", async () => {
      const { logger, calls } = createCapturingLogger();

      await withLogging(logger, "wallet.connect", { walletType: "freighter" }, () =>
        Promise.resolve(ok({ connected: true, publicKey: "GTEST", walletType: "freighter" })),
      );

      expect(calls.map((c) => c.meta?.status)).toEqual(["start", "ok"]);

      await withLogging(logger, "account.get", { publicKey: "GTEST" }, () =>
        Promise.resolve(
          err(SorokitErrorCode.ACCOUNT_NOT_FOUND, "Account not found"),
        ),
      );

      const errorCall = calls.find((c) => c.meta?.status === "error");
      expect(errorCall?.meta?.errorCode).toBe(SorokitErrorCode.ACCOUNT_NOT_FOUND);
      expect(errorCall?.meta?.errorMessage).toBe("Account not found");
    });
  });
});

describe("createSorokitClient logger integration", () => {
  let consoleInfoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleInfoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "debug").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not log when log level is off", () => {
    const result = createSorokitClient({ network: "testnet" });
    expect(result.status).toBe("ok");
    expect(consoleInfoSpy).not.toHaveBeenCalled();
  });

  it("routes logs to a custom logger when provided", () => {
    const { logger: custom, calls } = createCapturingLogger();
    const result = createSorokitClient({ network: "testnet", logger: custom });
    expect(result.status).toBe("ok");
    expect(calls.some((c) => c.message === "client.create")).toBe(true);
  });

  it("logs client creation when log level is info", () => {
    const result = createSorokitClient({ network: "testnet", logLevel: "info" });
    expect(result.status).toBe("ok");
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      "[sorokit]",
      expect.objectContaining({
        operation: "client.create",
        status: "ok",
        network: "testnet",
      }),
    );
  });

  it("does not log wallet.emptyState calls", () => {
    const { logger: custom, calls } = createCapturingLogger();
    const result = createSorokitClient({
      network: "testnet",
      logLevel: "debug",
      logger: custom,
    });

    const callsBefore = calls.length;
    if (result.status === "ok") {
      result.data.wallet.emptyState();
    }

    expect(calls.length).toBe(callsBefore);
  });

  it("wraps wallet operations with structured logging", async () => {
    const { logger: custom, calls } = createCapturingLogger();
    const result = createSorokitClient({
      network: "testnet",
      logLevel: "debug",
      logger: custom,
    });

    if (result.status === "ok") {
      const adapter = {
        walletType: "freighter" as const,
        isAvailable: () => false,
        connect: async () => ok("GTEST"),
        disconnect: async () => ok(undefined),
        signTransaction: async () => ok("signed"),
      };

      await result.data.wallet.connect(adapter);
    }

    expect(calls.some((c) => c.message === "wallet.connect")).toBe(true);
    expect(calls.some((c) => c.meta?.status === "start")).toBe(true);
    expect(calls.some((c) => c.meta?.status === "error")).toBe(true);
  });
});
