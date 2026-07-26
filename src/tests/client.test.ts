import { describe, expect, it } from "vitest";
import { createSorokitClient } from "../client/createSorokitClient";
import { SorokitErrorCode, err, ok } from "../shared/response";
import { WalletType } from "../wallet/types";
import type { WalletAdapter } from "../wallet/types";

describe("createSorokitClient", () => {
  it("creates a client for testnet", () => {
    const result = createSorokitClient({ network: "testnet" });
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      const client = result.data;
      expect(client.networkConfig.network).toBe("testnet");
      // wallet namespace
      expect(typeof client.wallet.connect).toBe("function");
      expect(typeof client.wallet.disconnect).toBe("function");
      expect(typeof client.wallet.signTransaction).toBe("function");
      expect(typeof client.wallet.emptyState).toBe("function");
      // account namespace
      expect(typeof client.account.get).toBe("function");
      expect(typeof client.account.getAccountsBatch).toBe("function");
      expect(typeof client.account.getBalances).toBe("function");
      expect(typeof client.account.stream).toBe("function"); // #85
      expect(typeof client.account.formatAddress).toBe("function");
      // transaction namespace
      expect(typeof client.transaction.buildPayment).toBe("function");
      expect(typeof client.transaction.buildCreateAccount).toBe("function");
      expect(typeof client.transaction.buildTrustline).toBe("function");
      expect(typeof client.transaction.submit).toBe("function");
      expect(typeof client.transaction.getStatus).toBe("function");
      expect(typeof client.transaction.stream).toBe("function"); // #86
      // soroban namespace
      expect(typeof client.soroban.getContractMethods).toBe("function");
      expect(typeof client.soroban.simulate).toBe("function");
      expect(typeof client.soroban.prepare).toBe("function");
      expect(typeof client.soroban.execute).toBe("function");
      expect(typeof client.soroban.invoke).toBe("function");
      expect(typeof client.soroban.read).toBe("function");
      // network namespace
      expect(typeof client.network.getConfig).toBe("function");
    }
  });

  it("creates a client for mainnet", () => {
    const result = createSorokitClient({ network: "mainnet" });
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.data.networkConfig.horizonUrl).toBe(
        "https://horizon.stellar.org",
      );
    }
  });

  it("creates a client for futurenet", () => {
    const result = createSorokitClient({ network: "futurenet" });
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.data.networkConfig.network).toBe("futurenet");
    }
  });

  it("applies custom horizonUrl override", () => {
    const result = createSorokitClient({
      network: "testnet",
      horizonUrl: "https://custom-horizon.example.com",
    });
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.data.networkConfig.horizonUrl).toBe(
        "https://custom-horizon.example.com",
      );
    }
  });

  it("applies custom rpcUrl override", () => {
    const result = createSorokitClient({
      network: "testnet",
      rpcUrl: "https://custom-rpc.example.com",
    });
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.data.networkConfig.rpcUrl).toBe(
        "https://custom-rpc.example.com",
      );
    }
  });

  it("returns status error for invalid network", () => {
    // @ts-expect-error — intentionally testing invalid input
    const result = createSorokitClient({ network: "badnet" });
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error.code).toBe(SorokitErrorCode.INVALID_NETWORK);
    }
  });

  it("network.getConfig() returns the resolved config", () => {
    const result = createSorokitClient({ network: "testnet" });
    if (result.status === "ok") {
      const config = result.data.network.getConfig();
      expect(config).toEqual(result.data.networkConfig);
    }
  });

  it("wallet.emptyState() returns status ok with disconnected state", () => {
    const result = createSorokitClient({ network: "testnet" });
    if (result.status === "ok") {
      const state = result.data.wallet.emptyState();
      expect(state.status).toBe("ok");
      if (state.status === "ok") {
        expect(state.data.connected).toBe(false);
        expect(state.data.publicKey).toBeNull();
        expect(state.data.walletType).toBeNull();
      }
    }
  });

  it("account.formatAddress() shortens a public key (raw string)", () => {
    const result = createSorokitClient({ network: "testnet" });
    if (result.status === "ok") {
      const key = "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVWXYZ";
      const formatted = result.data.account.formatAddress(key);
      // Pure utility — returns string directly, not SorokitResult
      expect(typeof formatted).toBe("string");
      expect(formatted).toContain("...");
    }
  });

  it("soroban exposes the full prepare → execute pipeline", () => {
    const result = createSorokitClient({ network: "testnet" });
    if (result.status === "ok") {
      expect(typeof result.data.soroban.getContractMethods).toBe("function");
      expect(typeof result.data.soroban.prepare).toBe("function");
      expect(typeof result.data.soroban.execute).toBe("function");
      expect(typeof result.data.soroban.invoke).toBe("function");
    }
  });

  it("account.stream returns an async generator", async () => {
    const result = createSorokitClient({ network: "testnet" });
    if (result.status === "ok") {
      const stream = result.data.account.stream("GTEST...", { maxPolls: 1 });
      expect(typeof stream[Symbol.asyncIterator]).toBe("function");
      // Consume one iteration to verify it's a working generator
      await stream.next();
    }
  });

  it("wallet.connect propagates error from failing adapter", async () => {
    const clientRes = createSorokitClient({ network: "testnet" });
    expect(clientRes.status).toBe("ok");
    if (clientRes.status === "ok") {
      const mockFailingAdapter: WalletAdapter = {
        walletType: WalletType.FREIGHTER,
        isAvailable: () => true,
        connect: async () => err(SorokitErrorCode.WALLET_CONNECT_FAILED, "Connect failed"),
        disconnect: async () => ok(undefined),
        signTransaction: async () => err(SorokitErrorCode.WALLET_SIGN_FAILED, "Sign failed"),
      };
      const res = await clientRes.data.wallet.connect(mockFailingAdapter);
      expect(res.status).toBe("error");
      if (res.status === "error") {
        expect(res.error.code).toBe(SorokitErrorCode.WALLET_CONNECT_FAILED);
      }
    }
  });

  it("wallet.signTransaction propagates WALLET_SIGN_REJECTED error", async () => {
    const clientRes = createSorokitClient({ network: "testnet" });
    expect(clientRes.status).toBe("ok");
    if (clientRes.status === "ok") {
      const mockRejectingAdapter: WalletAdapter = {
        walletType: WalletType.FREIGHTER,
        isAvailable: () => true,
        connect: async () => ok("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"),
        disconnect: async () => ok(undefined),
        signTransaction: async () => err(SorokitErrorCode.WALLET_SIGN_REJECTED, "User rejected"),
      };
      const res = await clientRes.data.wallet.signTransaction(mockRejectingAdapter, { xdr: "AAAA" });
      expect(res.status).toBe("error");
      if (res.status === "error") {
        expect(res.error.code).toBe(SorokitErrorCode.WALLET_SIGN_REJECTED);
      }
    }
  });

  it("account.get returns ACCOUNT_NOT_FOUND when Horizon returns 404", async () => {
    const clientRes = createSorokitClient({
      network: "testnet",
      horizonUrl: "https://horizon-404-test.example.com",
      fetchFn: async () => new Response(JSON.stringify({ status: 404, title: "Not Found" }), { status: 404 }),
    });
    expect(clientRes.status).toBe("ok");
    if (clientRes.status === "ok") {
      const res = await clientRes.data.account.get("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
      expect(res.status).toBe("error");
      if (res.status === "error") {
        expect(res.error.code).toBe(SorokitErrorCode.ACCOUNT_NOT_FOUND);
      }
    }
  });

  it("account.getBalances propagates error when getAccount fails", async () => {
    const clientRes = createSorokitClient({
      network: "testnet",
      horizonUrl: "https://horizon-404-test.example.com",
      fetchFn: async () => new Response(JSON.stringify({ status: 404, title: "Not Found" }), { status: 404 }),
    });
    expect(clientRes.status).toBe("ok");
    if (clientRes.status === "ok") {
      const res = await clientRes.data.account.getBalances("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
      expect(res.status).toBe("error");
      if (res.status === "error") {
        expect(res.error.code).toBe(SorokitErrorCode.ACCOUNT_NOT_FOUND);
      }
    }
  });
});
