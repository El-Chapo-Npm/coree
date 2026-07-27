/**
 * xBull wallet adapter.
 *
 * xBull is a Stellar wallet available as both a browser extension and PWA.
 * Wraps the SWK instance — same pattern as FreighterAdapter.
 */

import { WalletType } from "../types";
import type {
  WalletAdapter,
  SignTransactionInput,
  SWKInstance,
} from "../types";
import { ok, err, SorokitErrorCode } from "../../shared/response";
import type { SorokitResult } from "../../shared/response";
import { isBrowser, isNetworkConnectivityError, isTimeoutError, isUserRejection, toMessage } from "../../shared";

function describeXBullFailure(action: "connection" | "signing", cause: unknown): string {
  if (isTimeoutError(cause)) {
    return `xBull ${action} timed out: ${toMessage(cause)}`;
  }
  if (isNetworkConnectivityError(cause)) {
    return `xBull ${action} failed due to network connectivity: ${toMessage(cause)}`;
  }
  return `xBull ${action} failed: ${toMessage(cause)}`;
}

export class XBullAdapter implements WalletAdapter {
  readonly walletType = WalletType.XBULL;

  constructor(private readonly kit: SWKInstance) {}

  isAvailable(): boolean {
    return isBrowser();
  }

  async connect(): Promise<SorokitResult<string>> {
    if (!this.isAvailable()) {
      return err(
        SorokitErrorCode.WALLET_BROWSER_ONLY,
        "xBull requires a browser environment.",
      );
    }
    try {
      const { address } = await this.kit.getAddress();
      return ok(address);
    } catch (cause) {
      return err(
        SorokitErrorCode.WALLET_CONNECT_FAILED,
        describeXBullFailure("connection", cause),
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
        "xBull requires a browser environment.",
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
          ? "User rejected the xBull signature request."
          : describeXBullFailure("signing", cause),
        cause,
      );
    }
  }
}
