# Implementation Plan: Offline Transaction Building & Validation

## Steps
- [x] 1. Analyze codebase and create plan
- [x] 2. Add `sequenceNumber?: string` and `estimatedFee?: string` to types (PaymentParams, TrustlineParams, AccountCreateParams, PathPaymentParams, SwapTransactionParams, AtomicSwapParams, AccountMergeOptions, ReverseTransactionParams)
- [x] 3. Modify `buildPaymentTransaction` — support offline params
- [x] 4. Modify `buildCreateAccountTransaction` — support offline params
- [x] 5. Modify `buildTrustlineTransaction` — support offline params
- [x] 6. Modify `buildPathPayment` — support offline params
- [x] 7. Modify `buildAtomicSwap` — support offline params
- [x] 8. Modify `buildSwapTransaction` — support offline params
- [x] 9. Modify `buildAccountMerge` / `buildReverseTransaction` / `buildBulkTrustlines` / `buildPaymentWithTrustline` — support offline params
- [x] 10. Create `validateTransactionOffline.ts` — structure & signature validation without network
- [x] 11. Export from `src/transaction/index.ts` and `src/index.ts`
- [ ] 12. Write tests for offline paths

