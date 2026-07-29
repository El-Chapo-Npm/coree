export type LogLevel = "off" | "debug" | "info" | "warn" | "error";

export interface StructuredLogMeta {
  [key: string]: unknown;
}

export interface SorokitLogger {
  debug(message: string, meta?: StructuredLogMeta): void;
  info(message: string, meta?: StructuredLogMeta): void;
  warn(message: string, meta?: StructuredLogMeta): void;
  error(message: string, meta?: StructuredLogMeta): void;
}

export interface TracedLogger extends SorokitLogger {
  readonly traceId?: string;
  readonly spanId?: string;
}

export interface LoggerOptions {
  logLevel?: LogLevel;
  debug?: boolean;
  logger?: SorokitLogger;
}

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  off: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

/**
 * Remove query parameters and fragments from a URL before it is written to a
 * log. The original URL is never modified; this function only returns the
 * value suitable for logging.
 */
export function sanitizeUrlForLogging(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    // URL values supplied to the client are validated before use. Keep this
    // fallback defensive for callers using the logger directly.
    const queryIndex = url.search(/[?#]/);
    return queryIndex === -1 ? url : url.slice(0, queryIndex);
  }
}

export function sanitizeLogMeta(meta?: StructuredLogMeta): StructuredLogMeta | undefined {
  if (!meta) return undefined;

  const sanitized: StructuredLogMeta = { ...meta };
  for (const key of ["horizonUrl", "rpcUrl"]) {
    const value = sanitized[key];
    if (typeof value === "string") {
      sanitized[key] = sanitizeUrlForLogging(value);
    }
  }
  return sanitized;
}

function createConsoleLogger(): SorokitLogger {
  return {
    debug: (message, meta) => console.debug("[sorokit]", { level: "debug", message, ...meta, timestamp: new Date().toISOString() }),
    info: (message, meta) => console.info("[sorokit]", { level: "info", message, ...meta, timestamp: new Date().toISOString() }),
    warn: (message, meta) => console.warn("[sorokit]", { level: "warn", message, ...meta, timestamp: new Date().toISOString() }),
    error: (message, meta) => console.error("[sorokit]", { level: "error", message, ...meta, timestamp: new Date().toISOString() }),
  };
}

function createNoopLogger(): SorokitLogger {
  return {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
}

function createLevelLogger(level: LogLevel, sink: SorokitLogger): SorokitLogger {
  const threshold = LOG_LEVEL_PRIORITY[level];
  const enabled = (methodLevel: Exclude<LogLevel, "off">): boolean =>
    threshold >= LOG_LEVEL_PRIORITY[methodLevel];

  return {
    debug: (message, meta) => {
      if (enabled("debug")) sink.debug(message, sanitizeLogMeta(meta));
    },
    info: (message, meta) => {
      if (enabled("info")) sink.info(message, sanitizeLogMeta(meta));
    },
    warn: (message, meta) => {
      if (enabled("warn")) sink.warn(message, sanitizeLogMeta(meta));
    },
    error: (message, meta) => {
      if (enabled("error")) sink.error(message, sanitizeLogMeta(meta));
    },
  };
}

/** Create a level-filtered logger. Logging is disabled by default. */
export function createLogger(options?: LoggerOptions): SorokitLogger {
  const level: LogLevel = options?.logLevel ?? (options?.debug ? "debug" : "off");
  if (level === "off") return createNoopLogger();
  return createLevelLogger(level, options?.logger ?? createConsoleLogger());
}

/** Add trace identifiers to all entries emitted by a logger. */
export function createTracedLogger(
  logger: SorokitLogger,
  traceContext: string | { traceId?: string; spanId?: string } | null | undefined,
): TracedLogger {
  const normalizedContext =
    typeof traceContext === "string" ? { traceId: traceContext } : traceContext;
  const traceMeta: StructuredLogMeta = {};
  if (normalizedContext?.traceId !== undefined) traceMeta.traceId = normalizedContext.traceId;
  if (normalizedContext?.spanId !== undefined) traceMeta.spanId = normalizedContext.spanId;

  const withTrace = (meta?: StructuredLogMeta): StructuredLogMeta => ({ ...traceMeta, ...meta });
  return {
    ...(normalizedContext?.traceId !== undefined ? { traceId: normalizedContext.traceId } : {}),
    ...(normalizedContext?.spanId !== undefined ? { spanId: normalizedContext.spanId } : {}),
    debug: (message, meta) => logger.debug(message, withTrace(meta)),
    info: (message, meta) => logger.info(message, withTrace(meta)),
    warn: (message, meta) => logger.warn(message, withTrace(meta)),
    error: (message, meta) => logger.error(message, withTrace(meta)),
  };
}

/** Log the start and completion of an asynchronous operation. */
export async function withLogging<T>(
  logger: TracedLogger,
  operation: string,
  meta: StructuredLogMeta,
  fn: () => Promise<T>,
): Promise<T> {
  logger.debug(operation, { ...meta, operation, status: "start" });
  try {
    const result = await fn();
    const resultStatus =
      typeof result === "object" && result !== null && "status" in result
        ? (result as { status?: unknown }).status
        : undefined;
    const statusMeta = {
      ...meta,
      operation,
      status: resultStatus === "error" ? "error" : "ok",
    };
    if (resultStatus === "error" && typeof result === "object" && result !== null && "error" in result) {
      const errorResult = result as unknown as {
        status: "error";
        data: null;
        error: { code: string; message: string; traceId?: string };
      };
      logger.error(operation, {
        ...statusMeta,
        errorCode: errorResult.error.code,
        errorMessage: errorResult.error.message,
      });
      if (logger.traceId !== undefined && errorResult.error.traceId === undefined) {
        return {
          ...errorResult,
          error: { ...errorResult.error, traceId: logger.traceId },
        } as T;
      }
      return result;
    }
    logger.debug(operation, statusMeta);
    return result;
  } catch (cause) {
    logger.error(operation, {
      ...meta,
      operation,
      status: "error",
      errorMessage: cause instanceof Error ? cause.message : String(cause),
    });
    throw cause;
  }
}
