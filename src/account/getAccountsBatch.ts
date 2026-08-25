import { ok, err, SorokitErrorCode } from "../shared/response";
import type { SorokitResult } from "../shared/response";
import { toMessage } from "../shared";
import { getAccount } from "./getAccount";
import type { AccountInfo } from "./types";

/**
 * Fetch full account details for multiple accounts in parallel from Horizon.
 * Uses Promise.allSettled so a single account failure never blocks the rest.
 * Returns an array of individual results, each carrying its own ok/error status.
 */
export async function getAccountsBatch(
  horizonUrl: string,
  publicKeys: string[],
  options?: { signal?: AbortSignal | undefined },
): Promise<SorokitResult<SorokitResult<AccountInfo>[]>> {
  try {
    if (!Array.isArray(publicKeys) || publicKeys.length === 0) {
      return ok([]);
    }

    const uniqueKeys = Array.from(new Set(publicKeys));
    const settled = await Promise.allSettled(
      uniqueKeys.map((publicKey) => getAccount(horizonUrl, publicKey, options)),
    );

    const resultMap = new Map<string, SorokitResult<AccountInfo>>();
    uniqueKeys.forEach((key, index) => {
      const r = settled[index]!;
      resultMap.set(
        key,
        r.status === "fulfilled"
          ? r.value
          : err(
              SorokitErrorCode.ACCOUNT_FETCH_FAILED,
              `Failed to fetch account: ${toMessage(r.reason)}`,
              r.reason,
            ),
      );
    });

    const results = publicKeys.map((key) => resultMap.get(key)!);
    return ok(results);
  } catch (cause) {
    return err(
      SorokitErrorCode.UNKNOWN,
      `Failed to execute batch accounts fetch: ${toMessage(cause)}`,
      cause,
    );
  }
}
