/**
 * Transaction module public types.
 */

export type TransactionStatus = "pending" | "success" | "failed" | "not_found";

export interface TransactionResult {
  hash: string;
  status: TransactionStatus;
  ledger?: number;
  createdAt?: string;
  fee?: string;
  /** Raw envelope XDR for debugging */
  envelopeXdr?: string;
  /** Result XDR */
  resultXdr?: string;
}

export type MemoType = "text" | "id" | "hash" | "return";

export interface MemoParams {
  /** Optional memo value. If omitted, no memo is attached. */
  memo?: string;
  /** Optional memo type. Defaults to text for string memo values. */
  memoType?: MemoType;
  /** Require a memo to be present. If true and no memo is provided, transaction build fails. */
  requireMemo?: boolean;
  /**
   * Optional custom validation callback applied before the memo is attached.
   * Receives the raw memo string and must return SorokitResult<void>.
   * A returned error result surfaces as TX_BUILD_FAILED and aborts the build.
   */
  memoValidator?: (memo: string) => import("../shared/response").SorokitResult<void>;
}

export interface PaymentParams extends MemoParams {
  destination: string;
  amount: string;
  /** Defaults to XLM (native) */
  assetCode?: string;
  assetIssuer?: string;
  memo?: string;
  /** When true, reuses a 5-second module-level sequence cache to avoid repeated Horizon round trips */
  autoFetchSequence?: boolean;
}

export interface TrustlineParams extends MemoParams {
  assetCode: string;
  assetIssuer: string;
  /** Defaults to max limit */
  limit?: string;
  /** When true, reuses a 5-second module-level sequence cache to avoid repeated Horizon round trips */
  autoFetchSequence?: boolean;
}

export interface AccountCreateParams extends MemoParams {
  destination: string;
  /** Starting balance in XLM — minimum 1 XLM */
  startingBalance: string;
  /** When true, reuses a 5-second module-level sequence cache to avoid repeated Horizon round trips */
  autoFetchSequence?: boolean;
}

export interface PaymentWithTrustlineParams {
  /** Trustline parameters to establish before payment */
  trustline: TrustlineParams;
  /** Payment parameters to execute after trustline */
  payment: PaymentParams;
}

export interface SwapTransactionParams {
  /** First payment (send asset A) */
  paymentA: PaymentParams;
  /** Second payment (receive asset B) */
  paymentB: PaymentParams;
}

export interface ReverseTransactionParams {
  /** Override fee in stroops. Defaults to BASE_FEE. */
  fee?: string;
}

export type PathPaymentMode = "strict-send" | "strict-receive";

export interface PathPaymentParams extends MemoParams {
  destination: string;
  sendAssetCode?: string;
  sendAssetIssuer?: string;
  destAssetCode?: string;
  destAssetIssuer?: string;
  /** "strict-send": exact send amount; "strict-receive": exact dest amount */
  mode: PathPaymentMode;
  /** Amount to send (strict-send) or receive (strict-receive) */
  amount: string;
  /** Slippage bound: min dest (strict-send) or max send (strict-receive). If omitted, dynamic path discovery is used to compute it. */
  slippageAmount?: string;
  /** Intermediate assets in the payment path. If omitted, dynamically discovered. */
  path?: Array<{ assetCode?: string; assetIssuer?: string }>;
  autoFetchSequence?: boolean;
}

export interface AtomicSwapParams extends MemoParams {
  /** First leg of the swap */
  legA: PathPaymentParams;
  /** Second leg of the swap */
  legB: PathPaymentParams;
}

// ─── Multi-signature types ────────────────────────────────────────────────────

/**
 * A signer entry for a multi-sig envelope.
 * Maps a public key to its signing weight.
 */
export interface MultiSigSigner {
  /** Stellar public key (G...) of this signer. */
  publicKey: string;
  /** Signing weight this key contributes. Must be >= 1. */
  weight: number;
}

/**
 * Parameters for building a multi-sig transaction envelope.
 */
export interface MultiSigEnvelopeParams extends MemoParams {
  /** Operations to include — same as a normal payment/trustline/etc. The XDR of an already-built transaction. */
  transactionXdr: string;
  /** Signers expected to co-sign this envelope. */
  signers: MultiSigSigner[];
  /**
   * Minimum cumulative weight required to authorise the transaction.
   * Submission is blocked until collected signature weights meet this threshold.
   */
  threshold: number;
}

/**
 * A partially- or fully-signed multi-sig envelope ready for incremental signature collection.
 */
export interface MultiSigEnvelope {
  /** Current envelope XDR (base64). Updated by collectSignature(). */
  envelopeXdr: string;
  /** Signers declared at envelope creation. */
  signers: MultiSigSigner[];
  /** Required cumulative weight to authorise submission. */
  threshold: number;
  /** Public keys whose signatures have been collected so far. */
  collectedSigners: string[];
  /** Cumulative weight of collected signatures. */
  collectedWeight: number;
  /** True when collectedWeight >= threshold. */
  thresholdMet: boolean;
}

export type { FeeEstimate, FeeEstimateOptions } from "./estimateFee";
export type {
  ExportFormat,
  ExportedTransaction,
  ExportTransactionHistoryOptions,
} from "./exportTransactionHistory";

