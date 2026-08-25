import { Horizon } from "@stellar/stellar-sdk";
import { ok, err, SorokitErrorCode } from "../shared/response";
import type { SorokitResult } from "../shared/response";
import { isNotFoundError, toMessage, retryWithBackoff } from "../shared";

export type ActivityPeriod = "24h" | "7d" | "30d";

export interface AssetActivity {
  assetCode: string;
  assetIssuer: string | null;
  amountIn: string;
  amountOut: string;
  count: number;
}

export interface AccountActivitySummary {
  publicKey: string;
  period: ActivityPeriod;
  transactionCount: number;
  successfulTransactionCount: number;
  failedTransactionCount: number;
  totalAmountIn: string;
  totalAmountOut: string;
  topAssets: AssetActivity[];
}

function getPeriodMs(period: ActivityPeriod): number {
  switch (period) {
    case "24h":
      return 24 * 60 * 60 * 1000;
    case "7d":
      return 7 * 24 * 60 * 60 * 1000;
    case "30d":
      return 30 * 24 * 60 * 60 * 1000;
    default:
      return 24 * 60 * 60 * 1000;
  }
}

/**
 * Fetch and aggregate activity summary for an account over a specified period.
 *
 * @param horizonUrl Base URL of Horizon server
 * @param publicKey Account G-address
 * @param period Timeframe window: '24h', '7d', or '30d' (default: '24h')
 * @returns Summary containing transaction counts, volume in/out, and top asset activities
 */
export async function getAccountActivitySummary(
  horizonUrl: string,
  publicKey: string,
  period: ActivityPeriod = "24h",
): Promise<SorokitResult<AccountActivitySummary>> {
  if (!publicKey || typeof publicKey !== "string") {
    return err(
      SorokitErrorCode.INVALID_ADDRESS,
      `Invalid account address: ${publicKey}`,
    );
  }

  try {
    const server = new Horizon.Server(horizonUrl);
    const periodMs = getPeriodMs(period);
    const cutoffTime = Date.now() - periodMs;

    // Fetch operations for account ordered descending
    const opsPage = await retryWithBackoff(async () => {
      return await server
        .operations()
        .forAccount(publicKey)
        .order("desc")
        .limit(200)
        .call();
    });

    let txCount = 0;
    let successCount = 0;
    let failedCount = 0;
    let totalInNum = 0;
    let totalOutNum = 0;

    const assetMap = new Map<
      string,
      { code: string; issuer: string | null; amountIn: number; amountOut: number; count: number }
    >();

    const seenTxHashes = new Set<string>();

    for (const op of opsPage.records) {
      const opTime = new Date(op.created_at).getTime();
      if (isNaN(opTime) || opTime < cutoffTime) {
        continue;
      }

      if (op.transaction_successful) {
        successCount++;
      } else {
        failedCount++;
      }

      if (op.transaction_hash && !seenTxHashes.has(op.transaction_hash)) {
        seenTxHashes.add(op.transaction_hash);
        txCount++;
      }

      // Check payment operations
      if (op.type === "payment") {
        const payOp = op as any;
        const amount = parseFloat(payOp.amount || "0");
        const assetCode = payOp.asset_code || (payOp.asset_type === "native" ? "XLM" : "UNKNOWN");
        const assetIssuer = payOp.asset_issuer || null;
        const assetKey = `${assetCode}:${assetIssuer || "native"}`;

        let entry = assetMap.get(assetKey);
        if (!entry) {
          entry = {
            code: assetCode,
            issuer: assetIssuer,
            amountIn: 0,
            amountOut: 0,
            count: 0,
          };
          assetMap.set(assetKey, entry);
        }

        entry.count++;

        if (payOp.to === publicKey) {
          entry.amountIn += amount;
          totalInNum += amount;
        } else if (payOp.from === publicKey || payOp.source_account === publicKey) {
          entry.amountOut += amount;
          totalOutNum += amount;
        }
      }
    }

    const topAssets: AssetActivity[] = Array.from(assetMap.values())
      .sort((a, b) => b.count - a.count || b.amountIn + b.amountOut - (a.amountIn + a.amountOut))
      .map((item) => ({
        assetCode: item.code,
        assetIssuer: item.issuer,
        amountIn: item.amountIn.toString(),
        amountOut: item.amountOut.toString(),
        count: item.count,
      }));

    return ok({
      publicKey,
      period,
      transactionCount: txCount,
      successfulTransactionCount: successCount,
      failedTransactionCount: failedCount,
      totalAmountIn: totalInNum.toString(),
      totalAmountOut: totalOutNum.toString(),
      topAssets,
    });
  } catch (cause) {
    return err(
      isNotFoundError(cause)
        ? SorokitErrorCode.ACCOUNT_NOT_FOUND
        : SorokitErrorCode.ACCOUNT_FETCH_FAILED,
      isNotFoundError(cause)
        ? `Account not found: ${publicKey}`
        : `Failed to fetch account activity summary: ${toMessage(cause)}`,
      cause,
    );
  }
}
