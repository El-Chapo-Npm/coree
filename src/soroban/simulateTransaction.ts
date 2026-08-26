import { rpc as SorobanRpc, TransactionBuilder } from "@stellar/stellar-sdk";
import { ok, err, SorokitErrorCode } from "../shared/response";
import type { SorokitResult } from "../shared/response";
import {
  isNetworkConnectivityError,
  isTimeoutError,
  isXdrInvalidError,
  toMessage,
} from "../shared";
import type {
  SimulateTransactionResult,
  SorobanSimulationFeeBreakdown,
  SorobanSimulationResourceUsage,
} from "./types";
import type { SorokitCache } from "../shared/cache";
import { createSimulationCacheKey } from "./contractCallIdentity";
import { createSorobanServer } from "../shared/serverFactory";

export interface SimulateTransactionOptions {
  cache?: SorokitCache;
  ttlMs?: number;
}

function describeSimulationFailure(cause: unknown): string {
  if (isXdrInvalidError(cause)) {
    return `Transaction simulation failed because the transaction XDR is malformed: ${toMessage(cause)}`;
  }
  if (isTimeoutError(cause)) {
    return `Transaction simulation timed out while contacting RPC: ${toMessage(cause)}`;
  }
  if (isNetworkConnectivityError(cause)) {
    return `Transaction simulation failed due to network connectivity: ${toMessage(cause)}`;
  }
  return `Transaction simulation failed: ${toMessage(cause)}`;
}

function stringifyFee(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  return String(value);
}

function extractResourceUsage(
  simResult: SorobanRpc.Api.SimulateTransactionSuccessResponse,
): SorobanSimulationResourceUsage {
  const raw = simResult as unknown as {
    cost?: {
      cpuInsns?: unknown;
      memBytes?: unknown;
    };
    transactionData?: {
      resources?: () => {
        instructions?: () => unknown;
        readBytes?: () => number;
        writeBytes?: () => number;
        footprint?: () => {
          readOnly?: () => unknown[];
          readWrite?: () => unknown[];
        };
      };
    };
  };

  const resources = raw.transactionData?.resources?.();
  const footprint = resources?.footprint?.();
  const readLedgerEntries = footprint?.readOnly?.().length;
  const writeLedgerEntries = footprint?.readWrite?.().length;
  const usage: SorobanSimulationResourceUsage = {};
  const instructions = stringifyFee(resources?.instructions?.() ?? raw.cost?.cpuInsns);

  if (instructions !== undefined) usage.instructions = instructions;
  const readBytes = resources?.readBytes?.();
  if (readBytes !== undefined) usage.readBytes = readBytes;
  const writeBytes = resources?.writeBytes?.() ?? (
    typeof raw.cost?.memBytes === "number" ? raw.cost.memBytes : undefined
  );
  if (writeBytes !== undefined) usage.writeBytes = writeBytes;
  if (readLedgerEntries !== undefined) usage.readLedgerEntries = readLedgerEntries;
  if (writeLedgerEntries !== undefined) usage.writeLedgerEntries = writeLedgerEntries;
  if (readLedgerEntries !== undefined || writeLedgerEntries !== undefined) {
    usage.footprint = {
      ...(readLedgerEntries !== undefined ? { readOnly: readLedgerEntries } : {}),
      ...(writeLedgerEntries !== undefined ? { readWrite: writeLedgerEntries } : {}),
    };
  }

  return usage;
}

function extractFeeBreakdown(
  simResult: SorobanRpc.Api.SimulateTransactionSuccessResponse,
): SorobanSimulationFeeBreakdown {
  const raw = simResult as unknown as {
    minResourceFee?: unknown;
    refundableFee?: unknown;
    nonRefundableFee?: unknown;
    totalFee?: unknown;
  };

  const minResourceFee = stringifyFee(raw.minResourceFee) ?? "0";
  const refundableFee = stringifyFee(raw.refundableFee);
  const nonRefundableFee = stringifyFee(raw.nonRefundableFee);
  return {
    minResourceFee,
    ...(refundableFee !== undefined ? { refundableFee } : {}),
    ...(nonRefundableFee !== undefined ? { nonRefundableFee } : {}),
    total: stringifyFee(raw.totalFee) ?? minResourceFee,
  };
}

/**
 * Simulate any transaction XDR against the Soroban RPC.
 * Used for fee estimation and pre-flight validation without submitting.
 *
 * Lives in soroban/ because it uses the Soroban RPC server.
 * For contract calls, prefer soroban.prepare() which handles
 * simulation and assembly in one step.
 */
export async function simulateTransaction(
  rpcUrl: string,
  networkPassphrase: string,
  transactionXdr: string,
  options?: SimulateTransactionOptions,
): Promise<SorokitResult<SimulateTransactionResult>> {
  if (isXdrInvalidError(transactionXdr)) {
    return err(
      SorokitErrorCode.TX_SIMULATE_FAILED,
      "Transaction simulation failed because the transaction XDR is malformed.",
      transactionXdr,
    );
  }

  const cache = options?.cache;
  const cacheKey = cache
    ? createSimulationCacheKey(transactionXdr, networkPassphrase)
    : undefined;

  if (cache && cacheKey) {
    const cached = cache.get(cacheKey);
    if (cached != null) {
      return ok(cached as SimulateTransactionResult);
    }
  }

  try {
    const rpc = createSorobanServer(rpcUrl);
    const tx = TransactionBuilder.fromXDR(transactionXdr, networkPassphrase);
    const simResult = await rpc.simulateTransaction(tx);

    if (SorobanRpc.Api.isSimulationError(simResult)) {
      const result: SimulateTransactionResult = { success: false, fee: "0", error: simResult.error };
      if (cache && cacheKey) {
        const ttlMs = options?.ttlMs ?? 5 * 60 * 1000;
        cache.set(cacheKey, result, ttlMs);
      }
      return ok(result);
    }

    if (SorobanRpc.Api.isSimulationSuccess(simResult)) {
      const feeBreakdown = extractFeeBreakdown(simResult);
      const result: SimulateTransactionResult = {
        success: true,
        fee: feeBreakdown.minResourceFee,
        resourceUsage: extractResourceUsage(simResult),
        feeBreakdown,
      };
      if (cache && cacheKey) {
        const ttlMs = options?.ttlMs ?? 5 * 60 * 1000;
        cache.set(cacheKey, result, ttlMs);
      }
      return ok(result);
    }

    return err(
      SorokitErrorCode.TX_SIMULATE_FAILED,
      "Transaction simulation returned an unexpected result.",
      simResult,
    );
  } catch (cause) {
    return err(
      SorokitErrorCode.TX_SIMULATE_FAILED,
      describeSimulationFailure(cause),
      cause,
    );
  }
}

