import { describe, expect, it, vi } from "vitest";
import { createSorokitClient } from "../client/createSorokitClient";
import { SorokitErrorCode, err, ok } from "../shared/response";
import { WalletType } from "../wallet/types";
import type { WalletAdapter } from "../wallet/types";

const { mockEstimateFee } = vi.hoisted(() => ({
  mockEstimateFee: vi.fn(),
}));

vi.mock("../transaction/estimateFee", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../transaction/estimateFee")>();
  return {
    ...actual,
    estimateFee: mockEstimateFee,
  };
});

const { mockStreamTransactions } = vi.hoisted(() => ({
  mockStreamTransactions: vi.fn(),
}));

vi.mock("../transaction/streamTransactions", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../transaction/streamTransactions")>();
  return {
    ...actual,
    streamTransactions: mockStreamTransactions,
  };
});

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
      expect(typeof client.account.isValidPublicKey).toBe("function"); // #293
      expect(typeof client.account.isValidContractId).toBe("function"); // #293
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

  it("account.isValidPublicKey validates well-formed and malformed public keys (#293)", () => {
    const result = createSorokitClient({ network: "testnet" });
    if (result.status === "ok") {
      const validKey = "GHOV4DKRY7GNU3CJQX6FMT2BIPW5ELSZAHOV4DKRY7GNU3CJQX6FMT2B";
      expect(result.data.account.isValidPublicKey(validKey)).toBe(true);
      expect(result.data.account.isValidPublicKey("not-a-key")).toBe(false);
    }
  });

  it("account.isValidContractId validates well-formed and malformed contract ids (#293)", () => {
    const result = createSorokitClient({ network: "testnet" });
    if (result.status === "ok") {
      const validContractId = "CHOV4DKRY7GNU3CJQX6FMT2BIPW5ELSZAHOV4DKRY7GNU3CJQX6FMT2B";
      expect(result.data.account.isValidContractId(validContractId)).toBe(true);
      expect(result.data.account.isValidContractId("not-a-contract")).toBe(false);
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

  it("transaction.estimateFee delegates to estimateFee() with rpcUrl, horizonUrl, and networkConfig in order (#294)", async () => {
    mockEstimateFee.mockReset();
    mockEstimateFee.mockResolvedValue(
      ok({
        fee: "100",
        feeFloat: 100,
        feeXlm: "0.0000100",
        baseFee: "100",
        simulated: false,
      }),
    );

    const result = createSorokitClient({ network: "testnet" });
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      const input = { kind: "xdr" as const, transactionXdr: "AAAA" };
      const res = await result.data.transaction.estimateFee(input);

      expect(res.status).toBe("ok");
      expect(mockEstimateFee).toHaveBeenCalledOnce();
      const call = mockEstimateFee.mock.calls[0];
      // Wiring order matters — a swap here would silently misconfigure the estimate.
      expect(call[0]).toBe(result.data.networkConfig.rpcUrl);
      expect(call[1]).toBe(result.data.networkConfig.horizonUrl);
      expect(call[2]).toBe(result.data.networkConfig);
      expect(call[3]).toBe(input);
    }
  });

  it("transaction.stream delegates to streamTransactions() with horizonUrl and publicKey (#294)", async () => {
    mockStreamTransactions.mockReset();
    mockStreamTransactions.mockImplementation(async function* () {
      yield ok({ transactions: [], nextCursor: null });
    });

    const result = createSorokitClient({ network: "testnet" });
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      const streamConfig = { maxPolls: 1 };
      const stream = result.data.transaction.stream("GTEST...", streamConfig);
      expect(typeof stream[Symbol.asyncIterator]).toBe("function");

      const { value } = await stream.next();
      expect(value?.status).toBe("ok");

      expect(mockStreamTransactions).toHaveBeenCalledOnce();
      const call = mockStreamTransactions.mock.calls[0];
      expect(call[0]).toBe(result.data.networkConfig.horizonUrl);
      expect(call[1]).toBe("GTEST...");
      expect(call[2]).toBe(streamConfig);
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
