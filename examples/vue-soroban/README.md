# vue-soroban

Vue 3 example: connect a wallet, pick a contract method, invoke it with progress feedback, and stream account state changes.

```
Connect wallet → Select method → Invoke contract → Track progress → Show result
```

## Patterns covered

- Wallet connection with `FreighterAdapter` using Vue's `ref` / `reactive`
- Calling `client.soroban.invoke` with a sign callback
- Progress steps (`preparing` → `signing` → `confirming`) via `onProgress`
- Reading contract state without signing via `client.soroban.read`
- Account state streaming with an `AbortController`

## Files

| File | Purpose |
|---|---|
| `src/useContract.ts` | Composable: client setup, wallet state, contract invoke, account stream |
| `src/App.vue` | UI: wallet panel, method selector, invoke button, progress indicator |

## Setup

```bash
npm install sorokit-core @creit.tech/stellar-wallets-kit
```

Initialise Stellar Wallets Kit before mounting the app:

```ts
import {
  StellarWalletsKit,
  WalletNetwork,
  FREIGHTER_ID,
  FreighterModule,
} from "@creit.tech/stellar-wallets-kit";

const kit = new StellarWalletsKit({
  network: WalletNetwork.TESTNET,
  selectedWalletId: FREIGHTER_ID,
  modules: [new FreighterModule()],
});
```

Then pass it to `useContract`:

```ts
const { walletState, connect, invokeMethod, progress } = useContract(kit, contractId, "testnet");
```

## Running type-checks

```bash
npm run typecheck:examples
```
