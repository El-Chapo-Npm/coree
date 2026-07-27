/**
 * Lobstr wallet adapter.
 *
 * Lobstr is a popular Stellar wallet available as a mobile app and
 * browser extension. Wraps the SWK instance — same pattern as FreighterAdapter.
 */

import { WalletType } from "../types";
import type {
  WalletAdapter,
  SignTransactionInput,
  SWKInstance,
} from "../types";
import { ok, err, SorokitErrorCode } from "../../shared/response";
import type { SorokitResult } from "../../shared/response";
import {
  isBrowser,
  isNetworkConnectivityError,
  isTimeoutError,
  isUserRejection,
  toMessage,
} from "../../shared";

function describeLobstrFailure(action: "connection" | "signing", cause: unknown): string {
  if (isTimeoutError(cause)) {
    return `Lobstr ${action} timed out: ${toMessage(cause)}`;
  }
  if (isNetworkConnectivityError(cause)) {
    return `Lobstr ${action} failed due to network connectivity: ${toMessage(cause)}`;
  }
  return `Lobstr ${action} failed: ${toMessage(cause)}`;
}

export class LobstrAdapter implements WalletAdapter {
  readonly walletType = WalletType.LOBSTR;

  constructor(private readonly kit: SWKInstance) {}

  isAvailable(): boolean {
    return isBrowser();
  }

  async connect(): Promise<SorokitResult<string>> {
    if (!this.isAvailable()) {
      return err(
        SorokitErrorCode.WALLET_BROWSER_ONLY,
        "Lobstr requires a browser environment.",
      );
    }
    try {
      const { address } = await this.kit.getAddress();
      return ok(address);
    } catch (cause) {
      return err(
        SorokitErrorCode.WALLET_CONNECT_FAILED,
        describeLobstrFailure("connection", cause),
        cause,
      );
    }
  }

  async disconnect(): Promise<SorokitResult<undefined>> {
    return ok(undefined);
  }

  async signTransaction(
    input: SignTransactionInput,
  ): Promise<SorokitResult<string>> {
    if (!this.isAvailable()) {
      return err(
        SorokitErrorCode.WALLET_BROWSER_ONLY,
        "Lobstr requires a browser environment.",
      );
    }
    try {
      const { signedTxXdr } = await this.kit.signTransaction(
        input.transactionXdr,
        {
          networkPassphrase: input.networkPassphrase,
          ...(input.accountToSign !== undefined && {
            address: input.accountToSign,
          }),
        },
      );
      return ok(signedTxXdr);
    } catch (cause) {
      const rejected = isUserRejection(cause);
      return err(
        rejected ? SorokitErrorCode.WALLET_SIGN_REJECTED : SorokitErrorCode.WALLET_SIGN_FAILED,
        rejected
          ? "User rejected the Lobstr signature request."
          : describeLobstrFailure("signing", cause),
        cause,
      );
    }
  }
}
