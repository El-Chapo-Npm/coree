import { StrKey, Operation, TransactionBuilder, BASE_FEE } from "@stellar/stellar-sdk";
import { ok, err, SorokitErrorCode } from "../shared/response";
import type { SorokitResult } from "../shared/response";
import type { ResolvedNetworkConfig } from "../shared/types";
import { DEFAULT_TX_TIMEOUT_SECONDS } from "../shared/constants";
import { getAccount } from "./getAccount";

/**
 * Options/Params for rotating an account key.
 */
export interface RotateAccountKeyParams {
  /** Account object or public key string (G-address) */
  account: string;
  /** Current signer public key (G-address) to remove */
  oldKey: string;
  /** New signer public key (G-address) to add */
  newKey: string;
  /** Weight for the new key (default: 1) */
  newKeyWeight?: number;
}

/**
 * Options/Params for setting account recovery signers and thresholds.
 */
export interface SetAccountRecoveryParams {
  /** Account object or public key string (G-address) */
  account: string;
  /** Recovery signer public key (G-address) to add */
  recoveryKey: string;
  /** Weight for the recovery key (default: 1) */
  recoveryWeight?: number;
  /** Master key weight (optional) */
  masterWeight?: number;
  /** Low threshold for low-security operations (default: 1) */
  lowThreshold?: number;
  /** Medium threshold for standard operations (default: 2) */
  medThreshold?: number;
  /** High threshold for high-security operations (default: 2) */
  highThreshold?: number;
}

/**
 * Helper to validate a Stellar public key (G-address).
 */
export function isValidStellarPublicKey(key: string): boolean {
  if (typeof key !== "string") return false;
  return StrKey.isValidEd25519PublicKey(key);
}

/**
 * Rotate an account key by adding a new signer and removing an old signer in a safe sequence.
 *
 * Safety considerations:
 * - Validates format of all keys.
 * - Ensures oldKey and newKey are not identical.
 * - Adds the new key before removing the old key in the operation sequence so the account is never left without signers.
 *
 * @param horizonUrl Base URL of Horizon server
 * @param networkConfig Resolved network configuration
 * @param params Rotate account key options
 * @returns ok(xdr) or error
 */
export async function rotateAccountKey(
  horizonUrl: string,
  networkConfig: ResolvedNetworkConfig,
  params: RotateAccountKeyParams,
): Promise<SorokitResult<string>> {
  const { account, oldKey, newKey, newKeyWeight = 1 } = params;

  if (!isValidStellarPublicKey(account)) {
    return err(SorokitErrorCode.INVALID_ADDRESS, `Invalid account address: ${account}`);
  }
  if (!isValidStellarPublicKey(oldKey)) {
    return err(SorokitErrorCode.INVALID_ADDRESS, `Invalid old key address: ${oldKey}`);
  }
  if (!isValidStellarPublicKey(newKey)) {
    return err(SorokitErrorCode.INVALID_ADDRESS, `Invalid new key address: ${newKey}`);
  }
  if (oldKey === newKey) {
    return err(
      SorokitErrorCode.TX_BUILD_FAILED,
      "Old key and new key cannot be identical.",
    );
  }

  const accountResult = await getAccount(horizonUrl, account);
  if (accountResult.status === "error") {
    return accountResult;
  }

  try {
    const sourceAccount = new (await import("@stellar/stellar-sdk")).Account(
      account,
      accountResult.data.sequence,
    );

    const builder = new TransactionBuilder(sourceAccount, {
      fee: BASE_FEE,
      networkPassphrase: networkConfig.networkPassphrase,
    });

    // 1. Add new key first (safely ensures account retains valid signer)
    builder.addOperation(
      Operation.setOptions({
        signer: {
          ed25519PublicKey: newKey,
          weight: newKeyWeight,
        },
      }),
    );

    // 2. Remove old key (setting weight to 0 removes signer)
    builder.addOperation(
      Operation.setOptions({
        signer: {
          ed25519PublicKey: oldKey,
          weight: 0,
        },
      }),
    );

    builder.setTimeout(DEFAULT_TX_TIMEOUT_SECONDS);
    const tx = builder.build();

    return ok(tx.toXDR());
  } catch (cause) {
    return err(
      SorokitErrorCode.TX_BUILD_FAILED,
      `Failed to build key rotation transaction: ${cause instanceof Error ? cause.message : String(cause)}`,
      cause,
    );
  }
}

/**
 * Configure account recovery by adding a recovery signer key and updating thresholds.
 *
 * Safety considerations:
 * - Validates key formats.
 * - Sets thresholds and recovery signer in a safe single transaction.
 *
 * @param horizonUrl Base URL of Horizon server
 * @param networkConfig Resolved network configuration
 * @param params Set account recovery options
 * @returns ok(xdr) or error
 */
export async function setAccountRecovery(
  horizonUrl: string,
  networkConfig: ResolvedNetworkConfig,
  params: SetAccountRecoveryParams,
): Promise<SorokitResult<string>> {
  const {
    account,
    recoveryKey,
    recoveryWeight = 1,
    masterWeight,
    lowThreshold = 1,
    medThreshold = 2,
    highThreshold = 2,
  } = params;

  if (!isValidStellarPublicKey(account)) {
    return err(SorokitErrorCode.INVALID_ADDRESS, `Invalid account address: ${account}`);
  }
  if (!isValidStellarPublicKey(recoveryKey)) {
    return err(SorokitErrorCode.INVALID_ADDRESS, `Invalid recovery key address: ${recoveryKey}`);
  }

  const accountResult = await getAccount(horizonUrl, account);
  if (accountResult.status === "error") {
    return accountResult;
  }

  try {
    const sourceAccount = new (await import("@stellar/stellar-sdk")).Account(
      account,
      accountResult.data.sequence,
    );

    const builder = new TransactionBuilder(sourceAccount, {
      fee: BASE_FEE,
      networkPassphrase: networkConfig.networkPassphrase,
    });

    const setOptionsParams: Parameters<typeof Operation.setOptions>[0] = {
      signer: {
        ed25519PublicKey: recoveryKey,
        weight: recoveryWeight,
      },
      lowThreshold,
      medThreshold,
      highThreshold,
    };

    if (masterWeight !== undefined) {
      setOptionsParams.masterWeight = masterWeight;
    }

    builder.addOperation(Operation.setOptions(setOptionsParams));
    builder.setTimeout(DEFAULT_TX_TIMEOUT_SECONDS);

    const tx = builder.build();

    return ok(tx.toXDR());
  } catch (cause) {
    return err(
      SorokitErrorCode.TX_BUILD_FAILED,
      `Failed to build account recovery transaction: ${cause instanceof Error ? cause.message : String(cause)}`,
      cause,
    );
  }
}
