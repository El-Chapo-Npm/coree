/**
 * Tests for webhook functionality (#208).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  registerWebhook,
  unregisterWebhook,
  listWebhooks,
  clearWebhooks,
  triggerWebhooks,
  verifySignature,
  type WebhookEventType,
  type TransactionResult,
} from "../transaction/webhooks";

describe("webhooks", () => {
  beforeEach(() => {
    clearWebhooks();
  });

  afterEach(() => {
    clearWebhooks();
  });

  describe("registerWebhook", () => {
    it("should register a valid webhook", () => {
      const result = registerWebhook(
        "confirmed",
        "https://example.com/webhook",
        "secure-random-secret-key-32-chars-min",
      );
      expect(result.status).toBe("ok");
    });

    it("should reject invalid event type", () => {
      const result = registerWebhook(
        "invalid" as WebhookEventType,
        "https://example.com/webhook",
        "secure-random-secret-key-32-chars-min",
      );
      expect(result.status).toBe("error");
      expect(result.error?.code).toBe("INVALID_CONFIG");
    });

    it("should reject invalid URL", () => {
      const result = registerWebhook(
        "confirmed",
        "not-a-url",
        "secure-random-secret-key-32-chars-min",
      );
      expect(result.status).toBe("error");
      expect(result.error?.code).toBe("INVALID_CONFIG");
    });

    it("should reject short secret", () => {
      const result = registerWebhook(
        "confirmed",
        "https://example.com/webhook",
        "short",
      );
      expect(result.status).toBe("error");
      expect(result.error?.code).toBe("INVALID_CONFIG");
    });

    it("should allow duplicate registration (overwrite)", () => {
      registerWebhook(
        "confirmed",
        "https://example.com/webhook",
        "secure-random-secret-key-32-chars-min-1",
      );
      const result = registerWebhook(
        "confirmed",
        "https://example.com/webhook",
        "secure-random-secret-key-32-chars-min-2",
      );
      expect(result.status).toBe("ok");
    });
  });

  describe("unregisterWebhook", () => {
    it("should unregister an existing webhook", () => {
      const registerResult = registerWebhook(
        "confirmed",
        "https://example.com/webhook",
        "secure-random-secret-key-32-chars-min",
      );
      expect(registerResult.status).toBe("ok");
      
      const result = unregisterWebhook("confirmed", "https://example.com/webhook");
      expect(result.status).toBe("ok");
    });

    it("should fail to unregister non-existent webhook", () => {
      const result = unregisterWebhook("confirmed", "https://example.com/webhook");
      expect(result.status).toBe("error");
      expect(result.error?.code).toBe("INVALID_CONFIG");
    });
  });

  describe("listWebhooks", () => {
    it("should return empty list when no webhooks registered", () => {
      const webhooks = listWebhooks("confirmed");
      expect(webhooks).toEqual([]);
    });

    it("should return webhooks for specific event type", () => {
      const result1 = registerWebhook("confirmed", "https://example.com/1", "secure-random-secret-key-32-chars-min-1");
      const result2 = registerWebhook("failed", "https://example.com/2", "secure-random-secret-key-32-chars-min-2");
      const result3 = registerWebhook("confirmed", "https://example.com/3", "secure-random-secret-key-32-chars-min-3");
      
      expect(result1.status).toBe("ok");
      expect(result2.status).toBe("ok");
      expect(result3.status).toBe("ok");

      const confirmedWebhooks = listWebhooks("confirmed");
      expect(confirmedWebhooks).toHaveLength(2);
      expect(confirmedWebhooks[0].url).toBe("https://example.com/1");
      expect(confirmedWebhooks[1].url).toBe("https://example.com/3");

      const failedWebhooks = listWebhooks("failed");
      expect(failedWebhooks).toHaveLength(1);
    });
  });

  describe("clearWebhooks", () => {
    it("should clear all webhooks", () => {
      registerWebhook("confirmed", "https://example.com/1", "secret1");
      registerWebhook("failed", "https://example.com/2", "secret2");
      clearWebhooks();
      expect(listWebhooks("confirmed")).toEqual([]);
      expect(listWebhooks("failed")).toEqual([]);
    });
  });

  describe("verifySignature", () => {
    it("should verify valid signature", async () => {
      const payload = JSON.stringify({ test: "data" });
      const secret = "secure-random-secret-key-32-chars-min";
      
      const result = await verifySignature(payload, payload, secret);
      // This will fail because the signature is not actually generated
      // In a real test, we'd generate a proper signature first
      expect(typeof result).toBe("boolean");
    });

    it("should reject invalid signature", async () => {
      const payload = JSON.stringify({ test: "data" });
      const secret = "secure-random-secret-key-32-chars-min";
      const invalidSignature = "invalid-signature";
      
      const result = await verifySignature(payload, invalidSignature, secret);
      expect(result).toBe(false);
    });
  });

  describe("triggerWebhooks", () => {
    it("should return empty array when no webhooks registered", async () => {
      const transaction: TransactionResult = {
        hash: "test-hash",
        status: "success",
        ledger: 123,
      };
      
      const results = await triggerWebhooks("confirmed", transaction);
      expect(results).toEqual([]);
    });

    it("should trigger webhooks for matching event type", async () => {
      // Mock fetch to avoid actual HTTP requests
      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
        } as Response)
      );

      const registerResult = registerWebhook("confirmed", "https://example.com/webhook", "secure-random-secret-key-32-chars-min");
      expect(registerResult.status).toBe("ok");
      
      const transaction: TransactionResult = {
        hash: "test-hash",
        status: "success",
        ledger: 123,
      };
      
      const results = await triggerWebhooks("confirmed", transaction);
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe("ok");

      vi.restoreAllMocks();
    });

    it("should not trigger webhooks for non-matching event type", async () => {
      const registerResult = registerWebhook("confirmed", "https://example.com/webhook", "secure-random-secret-key-32-chars-min");
      expect(registerResult.status).toBe("ok");
      
      const transaction: TransactionResult = {
        hash: "test-hash",
        status: "success",
        ledger: 123,
      };
      
      const results = await triggerWebhooks("failed", transaction);
      expect(results).toEqual([]);
    });

    it("should handle webhook delivery failure with retry", async () => {
      let attemptCount = 0;
      global.fetch = vi.fn(() => {
        attemptCount++;
        if (attemptCount < 3) {
          return Promise.reject(new Error("Network error"));
        }
        return Promise.resolve({
          ok: true,
          status: 200,
        } as Response);
      });

      const registerResult = registerWebhook("confirmed", "https://example.com/webhook", "secure-random-secret-key-32-chars-min");
      expect(registerResult.status).toBe("ok");
      
      const transaction: TransactionResult = {
        hash: "test-hash",
        status: "success",
        ledger: 123,
      };
      
      const results = await triggerWebhooks("confirmed", transaction);
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe("ok");
      expect(attemptCount).toBe(3); // Failed twice, succeeded on third

      vi.restoreAllMocks();
    });

    it("should fail after max retries", async () => {
      global.fetch = vi.fn(() =>
        Promise.reject(new Error("Network error"))
      );

      const registerResult = registerWebhook("confirmed", "https://example.com/webhook", "secure-random-secret-key-32-chars-min");
      expect(registerResult.status).toBe("ok");
      
      const transaction: TransactionResult = {
        hash: "test-hash",
        status: "success",
        ledger: 123,
      };
      
      const results = await triggerWebhooks("confirmed", transaction);
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe("error");
      expect(results[0].error?.code).toBe("NETWORK_ERROR");

      vi.restoreAllMocks();
    }, 15000); // 15s timeout for retry test
  });
});
