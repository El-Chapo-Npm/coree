# Migrating from stellar-sdk to sorokit-core

This guide shows the most common patterns side by side. The main differences are:
- **No try/catch** — every function returns `SorokitResult<T>`, errors are values
- **One client** — wallet, account, transaction, and contract APIs are all on the same object
- **Typed wallet adapters** — Freighter, xBull, LOBSTR, and Hana are first-class, no manual XDR wrangling

---

## Setup

**stellar-sdk**
```ts
import { Server, Networks } from "@stellar/stellar-sdk";

const server = new Server("https://horizon-testnet.stellar.org");
```

**sorokit-core**
```ts
import { createSorokitClient } from "sorokit-core";

const result = createSorokitClient({ network: "testnet" });
if (result.status === "error") throw new Error(result.error.message);

const client = result.data;
```

`createSorokitClient` returns a result too — config errors (bad network name, invalid URL) surface here before any network call is made.

---

## Fetch account

**stellar-sdk**
```ts
try {
  const account = await server.loadAccount(publicKey);
  console.log(account.balances);
} catch (e) {
  console.error("Failed:", e);
}
```

**sorokit-core**
```ts
const account = await client.account.get(publicKey);

if (account.status === "ok") {
  console.log(account.data.balances);
} else {
  console.error(account.error.code, account.error.message);
}
```

Errors have stable codes (`ACCOUNT_NOT_FOUND`, `ACCOUNT_FETCH_FAILED`) you can branch on. No more fishing through the `response` property of a caught exception.

---

## Fetch balances only

**stellar-sdk**
```ts
const account = await server.loadAccount(publicKey);
const xlm = account.balances.find((b) => b.asset_type === "native");
console.log(xlm?.balance);
```

**sorokit-core**
```ts
const balances = await client.account.getBalances(publicKey);

if (balances.status === "ok") {
  const xlm = balances.data.find((b) => b.assetCode === "XLM");
  console.log(xlm?.balance);
}
```

Each balance has `assetCode`, `assetIssuer`, `balance` (string, seven decimals), and `balanceFloat` (number). `getAssetBalances` adds filtering by code, issuer, or type.

---

## Send a payment

**stellar-sdk**
```ts
import {
  TransactionBuilder,
  Networks,
  BASE_FEE,
  Operation,
  Asset,
} from "@stellar/stellar-sdk";

try {
  const sourceAccount = await server.loadAccount(sourceKey);

  const tx = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.payment({
        destination: destinationKey,
        asset: Asset.native(),
        amount: "10",
      })
    )
    .setTimeout(30)
    .build();

  tx.sign(keypair);
  await server.submitTransaction(tx);
} catch (e) {
  console.error(e);
}
```

**sorokit-core**
```ts
// 1. build — returns unsigned XDR
const built = await client.transaction.buildPayment(sourceKey, {
  destination: destinationKey,
  amount: "10",
});
if (built.status === "error") return handleError(built.error);

// 2. sign with connected wallet
const signed = await client.wallet.signTransaction(adapter, {
  transactionXdr: built.data,
  networkPassphrase: client.networkConfig.networkPassphrase,
});
if (signed.status === "error") return handleError(signed.error);

// 3. submit
const submitted = await client.transaction.submit(signed.data);
if (submitted.status === "ok") {
  console.log("tx hash:", submitted.data.hash);
}
```

The sign step uses whichever adapter the user connected — Freighter, xBull, etc. The wallet never sees raw keypairs.

---

## Invoke a Soroban contract

**stellar-sdk**
```ts
import { Contract, TransactionBuilder, SorobanRpc } from "@stellar/stellar-sdk";

const rpc = new SorobanRpc.Server("https://soroban-testnet.stellar.org");

try {
  const account = await rpc.getAccount(sourceKey);
  const contract = new Contract(contractId);

  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
    .addOperation(contract.call("transfer", ...args))
    .setTimeout(30)
    .build();

  const prepared = await rpc.prepareTransaction(tx);
  prepared.sign(keypair);

  const result = await rpc.sendTransaction(prepared);
  // poll getTransaction until not PENDING...
} catch (e) {
  console.error(e);
}
```

**sorokit-core**
```ts
// One call handles prepare → sign → execute → poll
const result = await client.soroban.invoke(
  {
    contractId,
    method: "transfer",
    args: [toScVal(destination), toScVal(amount)],
    sourcePublicKey: sourceKey,
  },
  (xdr) =>
    client.wallet.signTransaction(adapter, {
      transactionXdr: xdr,
      networkPassphrase: client.networkConfig.networkPassphrase,
    })
);

if (result.status === "ok") {
  console.log("tx hash:", result.data);
}
```

Or step through it manually if you need the prepared XDR for offline signing:

```ts
const prepared = await client.soroban.prepare({ contractId, method, args, sourcePublicKey });
// sign out-of-band...
const hash = await client.soroban.execute(signedXdr);
```

---

## Error handling patterns

**stellar-sdk** — you catch, then inspect the error type:
```ts
try {
  await server.submitTransaction(tx);
} catch (e) {
  if (e instanceof StellarSdk.BadResponseError) {
    console.error(e.data.extras?.result_codes);
  }
}
```

**sorokit-core** — errors are typed values with stable codes:
```ts
const result = await client.transaction.submit(signedXdr);

if (result.status === "error") {
  switch (result.error.code) {
    case "TX_SUBMIT_FAILED":
      // submission rejected by Horizon
      break;
    case "TX_SEQUENCE_CONFLICT":
      // stale sequence number — re-fetch account and rebuild
      break;
    case "WALLET_SIGN_REJECTED":
      // user clicked "Reject" in their wallet extension
      break;
    case "OPERATION_TIMEOUT":
      // request timed out — safe to retry
      break;
  }
}
```

The full list is in `SorokitErrorCode`. Helper predicates are also exported:
```ts
import { isTransientError, isUserRejection, isNotFoundError } from "sorokit-core";

if (isTransientError(result.error)) {
  // network hiccup — retry is safe
}
if (isUserRejection(result.error)) {
  // user said no — do not retry
}
```

---

## Wallet connection

**stellar-sdk** has no wallet layer — you manage keypairs directly.

**sorokit-core** uses adapters backed by [Stellar Wallets Kit](https://github.com/Creit-Tech/Stellar-Wallets-Kit):

```ts
import {
  StellarWalletsKit,
  WalletNetwork,
  FREIGHTER_ID,
  FreighterModule,
} from "@creit.tech/stellar-wallets-kit";
import { FreighterAdapter } from "sorokit-core";

const kit = new StellarWalletsKit({
  network: WalletNetwork.TESTNET,
  selectedWalletId: FREIGHTER_ID,
  modules: [new FreighterModule()],
});

const adapter = new FreighterAdapter(kit);
const conn = await client.wallet.connect(adapter);

if (conn.status === "ok") {
  const { publicKey } = conn.data;
}
```

Available adapters: `FreighterAdapter`, `XBullAdapter`, `LobstrAdapter`, `HanaAdapter`.

Server-side or CI signing (no browser extension):
```ts
import { signTransactionOffline } from "sorokit-core";

const signed = signTransactionOffline(unsignedXdr, secretKey, networkPassphrase);
```

---

## Streaming account state

**stellar-sdk**
```ts
server.accounts().accountId(publicKey).stream({
  onmessage: (account) => console.log(account.balances),
  onerror: (e) => console.error(e),
});
```

**sorokit-core** — async generator, cancel with `AbortController`:
```ts
const ac = new AbortController();

for await (const update of client.account.stream(publicKey, { intervalMs: 3000 }, ac.signal)) {
  if (update.status === "ok") {
    console.log(update.data.balances);
  }
}

// stop from anywhere
ac.abort();
```

---

## Key differences summary

| Topic | stellar-sdk | sorokit-core |
|---|---|---|
| Errors | thrown exceptions | `SorokitResult<T>` — branch on `status` |
| Wallet | raw keypairs | typed adapters (Freighter, xBull, LOBSTR, Hana) |
| Contract invocation | manual prepare → sign → poll | `client.soroban.invoke()` handles the pipeline |
| Balances | `account.balances` array, untyped strings | `AssetBalance[]` with `assetCode`, `balanceFloat`, etc. |
| Streaming | EventSource / callback | async generator + `AbortController` |
| Testing | mock `Server` manually | `createMockClient()` from `sorokit-core/testing` |
