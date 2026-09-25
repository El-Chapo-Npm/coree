<script setup lang="ts">
/**
 * Vue Soroban example — UI layer (#vue-soroban).
 *
 * Renders wallet connection, balance list, contract method selector, invoke
 * button, and progress indicator. All sorokit-core calls are in useContract.ts.
 */

import {
  StellarWalletsKit,
  WalletNetwork,
  FREIGHTER_ID,
  FreighterModule,
} from "@creit.tech/stellar-wallets-kit";
import { useContract } from "./useContract";

// Initialise SWK once per app — not per component render.
const kit = new StellarWalletsKit({
  network: WalletNetwork.TESTNET,
  selectedWalletId: FREIGHTER_ID,
  modules: [new FreighterModule()],
});

// Replace with a real contract ID on testnet.
const CONTRACT_ID = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";

const {
  walletState,
  balances,
  methods,
  selectedMethod,
  progress,
  result,
  error,
  connect,
  disconnect,
  invokeMethod,
  readMethod,
} = useContract(kit, CONTRACT_ID, "testnet");

const progressLabel: Record<string, string> = {
  idle: "",
  preparing: "Preparing transaction…",
  signing: "Approve in your wallet…",
  confirming: "Waiting for confirmation…",
  done: "Done",
};

function handleInvoke() {
  const method = methods.value.find((m) => m.name === selectedMethod.value);
  if (method) invokeMethod(method.name, method.args);
}

function handleRead() {
  const method = methods.value.find((m) => m.name === selectedMethod.value);
  if (method) readMethod(method.name, method.args);
}
</script>

<template>
  <div class="app">
    <h1>sorokit-core — Vue contract</h1>

    <!-- Wallet panel -->
    <section>
      <template v-if="!walletState?.connected">
        <button @click="connect">Connect Freighter</button>
      </template>
      <template v-else>
        <p>
          <strong>Connected:</strong>
          <code>{{ walletState.publicKey }}</code>
        </p>
        <button @click="disconnect">Disconnect</button>
      </template>
    </section>

    <!-- Balances — shown once the wallet is connected -->
    <section v-if="balances.length > 0">
      <h2>Balances</h2>
      <table>
        <thead>
          <tr>
            <th>Asset</th>
            <th>Balance</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="b in balances"
            :key="`${b.assetCode}-${b.assetIssuer ?? 'native'}`"
          >
            <td>{{ b.assetCode }}</td>
            <td class="right">{{ b.balance }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- Contract interaction — shown after wallet is connected -->
    <section v-if="walletState?.connected && methods.length > 0">
      <h2>Contract</h2>
      <label>
        Method
        <select v-model="selectedMethod">
          <option v-for="m in methods" :key="m.name" :value="m.name">
            {{ m.name }}
          </option>
        </select>
      </label>

      <div class="actions">
        <!-- read is free — no wallet prompt, no fee -->
        <button @click="handleRead" :disabled="progress !== 'idle'">
          Read (free)
        </button>
        <!-- invoke requires signing and pays a fee -->
        <button
          @click="handleInvoke"
          :disabled="progress !== 'idle'"
          class="primary"
        >
          Invoke
        </button>
      </div>

      <!-- Progress indicator -->
      <p v-if="progress !== 'idle'" class="info">
        {{ progressLabel[progress] }}
      </p>
    </section>

    <!-- Result -->
    <p v-if="result" class="result">
      <strong>Result:</strong> {{ result }}
    </p>

    <!-- Error -->
    <p v-if="error" class="error">{{ error }}</p>
  </div>
</template>

<style scoped>
.app {
  max-width: 480px;
  margin: 2rem auto;
  font-family: system-ui, sans-serif;
  line-height: 1.5;
}

section {
  margin-bottom: 1.5rem;
}

label {
  display: block;
  margin-bottom: 0.5rem;
}

select {
  display: block;
  width: 100%;
  padding: 0.4rem;
  margin-top: 4px;
}

table {
  width: 100%;
  border-collapse: collapse;
}

th {
  text-align: left;
}

th:last-child,
.right {
  text-align: right;
}

.actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.75rem;
}

button {
  padding: 0.5rem 1rem;
  cursor: pointer;
}

button.primary {
  background: #1a56db;
  color: white;
  border: none;
  border-radius: 4px;
}

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.info {
  background: #eef6ff;
  padding: 0.75rem;
  border-radius: 6px;
}

.result {
  background: #f4f4f5;
  padding: 0.75rem;
  border-radius: 6px;
  word-break: break-all;
}

.error {
  background: #fdecec;
  color: #8a1c1c;
  padding: 0.75rem;
  border-radius: 6px;
}
</style>
