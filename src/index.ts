/**
 * sorokit-core — public API
 *
 * Single entry point: createSorokitClient()
 * All functionality is accessed through the returned client object.
 */

// ─── Entry point ──────────────────────────────────────────────────────────────
export { createSorokitClient } from "./client/createSorokitClient";
export type {
  SorokitClient,
  SorokitClientConfig,
} from "./client/createSorokitClient";

// ─── Wallet adapters ──────────────────────────────────────────────────────────
export {
  addSignatureToEnvelope,
  collectMultiSignatures,
  detectInstalledWallets,
  diagnoseWalletConnection,
  prioritizeWallet,
  recommendWallets,
  removeSignatureFromEnvelope,
  signTransactionOffline,
} from "./wallet";
export type { EnvelopeSignatureInput, SignatureHintInput } from "./wallet";
export { FreighterAdapter } from "./wallet/adapters/freighter";
export { LobstrAdapter } from "./wallet/adapters/lobstr";
export { XBullAdapter } from "./wallet/adapters/xbull";

// ─── Wallet types ─────────────────────────────────────────────────────────────
export { WalletType } from "./wallet/types";
export type {
  DetectedWallet,
  DiagnosticCheck,
  DiagnosticStatus,
  RecommendationCriteria,
  SWKInstance,
  SignTransactionInput,
  WalletAdapter,
  WalletDiagnosticOptions,
  WalletDiagnosticReport,
  WalletFeature,
  WalletState,
} from "./wallet/types";

// ─── Network ──────────────────────────────────────────────────────────────────
export { NETWORK_DEFAULTS } from "./network/config";
export type { NetworkType } from "./network/config";
export { resolveNetwork } from "./network/resolveNetwork";
export type { NetworkOverrides } from "./network/resolveNetwork";
export type { ResolvedNetworkConfig } from "./shared/types";
export { checkNetworkHealth, NetworkSwitcher } from "./network";
export type {
  CheckNetworkHealthOptions,
  NetworkEndpointHealth,
  NetworkHealthReport,
  NetworkHealthStatus,
  CustomNetwork,
  NetworkOption,
  NetworkInfo,
  NetworkStatus,
  NetworkSwitchListener,
  NetworkStatusListener,
  NetworkSwitchUnsubscribe,
  NetworkSwitcherConfig,
} from "./network";

// ─── Account types & utilities ────────────────────────────────────────────────
export { evaluateBalanceAlerts } from "./account/balanceAlerts";
export { getAccountsBatch } from "./account/getAccountsBatch";
export type { AssetBalanceFilter } from "./account/getAssetBalances";
export { getMultipleAssetBalances } from "./account/getMultipleAssetBalances";
export type { MultipleAssetBalancesResult } from "./account/getMultipleAssetBalances";
export { streamAccount } from "./account/streamAccount";
export type { AccountStreamConfig } from "./account/streamAccount";
export { setSponsor, removeSponsor } from "./account/sponsorship";
export type {
  AccountInfo,
  AssetBalance,
  BalanceAlert,
  BalanceAlertCondition,
  BalanceAlertRule,
  SponsorshipResult,
} from "./account/types";

// ─── Transaction validation ───────────────────────────────────────────────────
export {
  createHashMemo,
  createIdMemo,
  createReturnMemo,
  createTextMemo,
  DEFAULT_VALIDATION_RULES,
  validateTransactionXdr,
  USDC_MAINNET_ISSUER,
  USDC_TESTNET_ISSUER,
  USDT_MAINNET_ISSUER,
  EURC_MAINNET_ISSUER,
  EURC_TESTNET_ISSUER,
  nativeAsset,
  usdcAsset,
  usdtAsset,
  eurcAsset,
} from "./transaction";
export type { SorokitMemo } from "./transaction";
export type {
  TransactionValidationFinding,
  TransactionValidationReport,
  ValidationRules,
} from "./transaction/validateTransactionXdr";
export { validateDestination } from "./transaction/validateDestination";
export type {
  DestinationValidationResult,
  ValidateDestinationOptions,
} from "./transaction/validateDestination";
export {
  buildMultiSigEnvelope,
  collectSignature,
  validateMultiSigThreshold,
} from "./transaction/multiSig";
export type {
  MultiSigSigner,
  MultiSigEnvelopeParams,
  MultiSigEnvelope,
} from "./transaction/types";

// ─── Transaction types ────────────────────────────────────────────────────────
export type {
  FeeEstimate,
  FeeEstimateInput,
  FeeEstimateOptions,
  FeeTiers,
} from "./transaction/estimateFee";
export { calculateFeeTiers } from "./transaction/estimateFee";
export { streamTransactions } from "./transaction/streamTransactions";
export {
  buildPathPayment,
  checkTrustlines,
  buildBulkTrustlines,
} from "./transaction/index";
export { compareFeeAcrossNetworks } from "./transaction/index";
export type { NetworkFeeResult } from "./transaction/index";
export type {
  TransactionPage,
  TransactionStreamConfig,
} from "./transaction/streamTransactions";
export {
  TRANSACTION_CONTEXT_TTL_MS,
  createTransactionContext,
} from "./transaction/transactionContext";
export type { TransactionBuilderContext } from "./transaction/transactionContext";
export { buildAccountMerge } from "./transaction";
export type { AccountMergeOptions } from "./transaction";
export {
  exportTransactionHistory,
  formatTransactionsToCsv,
  formatTransactionsToJson,
} from "./transaction";
export type {
  ExportFormat,
  ExportedTransaction,
  ExportTransactionHistoryOptions,
} from "./transaction";
export type {
  AccountCreateParams,
  AtomicSwapParams,
  PathPaymentMode,
  PathPaymentParams,
  PaymentParams,
  ReverseTransactionParams,
  TransactionResult,
  TransactionStatus,
  TrustlineParams,
} from "./transaction/types";
export { validateTransaction } from "./transaction/validateTransaction";
export type {
  ValidationIssue,
  TransactionValidationContext,
  CustomValidationRule,
  ParsedOperation,
} from "./transaction/validateTransaction";
export { validateTransactionOffline } from "./transaction/validateTransactionOffline";
export type {
  OfflineValidationIssue,
  OfflineValidationReport,
  OfflineValidationOptions,
} from "./transaction/validateTransactionOffline";
export {
  saveTransactionTemplate,
  loadTemplate,
  listTransactionTemplates,
  deleteTransactionTemplate,
  clearTransactionTemplates,
  InMemoryTransactionTemplateStore,
} from "./transaction";
export type {
  TransactionTemplate,
  TransactionTemplateKind,
  TransactionTemplateStore,
  TemplateParamValue,
} from "./transaction";

// ─── Soroban simulator (#210) ──────────────────────────────────────────────────
export { SorobanSimulator } from "./soroban/simulator";
export type { SimulatedMethodResult, SorobanSimulatorOptions } from "./soroban/simulator";
export { setSorobanSimulator } from "./shared/serverFactory";

// ─── Soroban types ────────────────────────────────────────────────────────────
export { simulateContractSafe } from "./soroban/simulateContractSafe";
export type {
  SafeSimulationResult,
  SimulateContractSafeOptions,
} from "./soroban/simulateContractSafe";
export {
  decodeContractValue,
  encodeContractArgs,
} from "./soroban/contractEncoding";
export { parseContractResult } from "./soroban/parseContractResult";
export { getContractMethods } from "./soroban/contractMetadata";
export { buildContractDeploy } from "./soroban/deployContract";
export type { BuildContractDeployOptions } from "./soroban/deployContract";
export { invokeBatchContracts } from "./soroban/invokeBatchContracts";
export { subscribeContractEvents } from "./soroban/subscribeContractEvents";
export type {
  ContractEvent,
  ContractEventFilter,
  ContractEventSubscriptionOptions,
} from "./soroban/subscribeContractEvents";
export type {
  BatchContractInvocation,
  BatchContractResult,
  ContractAbi,
  ContractAbiMethod,
  ContractCallResult,
  ContractInvokeParams,
  ContractMethod,
  ContractMethodInput,
  ContractReadParams,
  ContractResultType,
  ParsedContractResult,
  PreparedContractCall,
  SimulateTransactionResult,
  SorobanPollConfig,
} from "./soroban/types";

// ─── Response system ──────────────────────────────────────────────────────────
export type { SorokitCache } from "./shared/cache";
export { createTracedLogger } from "./shared/logger";
export type { LogLevel, LoggerConfig, SorokitLogger } from "./shared/logger";
export {
  SorokitErrorCode,
  assertOk,
  attachTraceId,
  err,
  isErr,
  isErrorCode,
  isOk,
  ok,
} from "./shared/response";
export type { SorokitError, SorokitResult } from "./shared/response";
export { generateTraceId, TokenBucketRateLimiter } from "./shared/utils";
export type {
  EndpointRateLimitConfig,
  RateLimiterBucketMetrics,
  RateLimiterMetricEvent,
  RateLimiterMetrics,
  RateLimiterEventType,
} from "./shared/utils";

// ─── Distributed tracing (#212) ────────────────────────────────────────────
export {
  getTraceContext,
  createTraceContext,
  createTracedFetch,
  createAutoTracedFetch,
  setTraceContext,
} from "./shared/tracing";
export type { TraceContext, TraceContextOptions } from "./shared/tracing";

// ─── Metrics ──────────────────────────────────────────────────────────────────
export {
  clearMetrics,
  getMetrics,
  metricsCollector,
  recordMetric,
  withMetrics,
} from "./shared/metrics";
export type {
  MetricEntry,
  MetricSummary,
  MetricsFilter,
} from "./shared/metrics";
