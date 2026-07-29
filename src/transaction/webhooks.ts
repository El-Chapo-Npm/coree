/**
 * Webhook support for transaction events.
 * 
 * Allows external services to be notified when transactions complete or fail.
 * Supports HMAC-SHA256 signature verification for security.
 */

import { ok, err, SorokitErrorCode } from "../shared/response";
import type { SorokitResult } from "../shared/response";
import { sleep } from "../shared/utils";
import type { TransactionResult } from "./types";

/**
 * Supported webhook event types.
 */
export type WebhookEventType = "submitted" | "confirmed" | "failed";

/**
 * Webhook registration configuration.
 */
export interface WebhookRegistration {
  /** Event type to subscribe to */
  event: WebhookEventType;
  /** URL to send webhook payloads to */
  url: string;
  /** Secret key for HMAC signature verification (generate securely!) */
  secret: string;
}

/**
 * Webhook payload sent to registered URLs.
 */
export interface WebhookPayload {
  /** Event type */
  event: WebhookEventType;
  /** Transaction hash */
  hash: string;
  /** Transaction status */
  status: string;
  /** Ledger sequence (if confirmed) */
  ledger: number | undefined;
  /** Timestamp */
  timestamp: string;
  /** HMAC-SHA256 signature (hex) */
  signature: string;
}

/**
 * In-memory webhook registry.
 * In production, this should be persisted to a database.
 */
const webhookRegistry = new Map<string, WebhookRegistration>();

/**
 * Generate a unique key for webhook registration.
 */
function webhookKey(event: WebhookEventType, url: string): string {
  return `${event}:${url}`;
}

/**
 * Register a webhook for transaction events.
 * 
 * @param event - Event type to subscribe to
 * @param url - URL to send webhook payloads to
 * @param secret - Secret key for HMAC signature verification (use secure random!)
 * @returns ok(void) on success, error on invalid input
 * 
 * @example
 * const result = registerWebhook("confirmed", "https://example.com/webhook", "secure-random-secret");
 */
export function registerWebhook(
  event: WebhookEventType,
  url: string,
  secret: string,
): SorokitResult<void> {
  if (!event || !["submitted", "confirmed", "failed"].includes(event)) {
    return err(
      SorokitErrorCode.INVALID_CONFIG,
      `Invalid event type: ${event}. Must be one of: submitted, confirmed, failed`,
    );
  }

  if (!url || typeof url !== "string") {
    return err(
      SorokitErrorCode.INVALID_CONFIG,
      "URL must be a non-empty string",
    );
  }

  try {
    new URL(url);
  } catch {
    return err(
      SorokitErrorCode.INVALID_CONFIG,
      `Invalid URL: ${url}`,
    );
  }

  if (!secret || typeof secret !== "string" || secret.length < 32) {
    return err(
      SorokitErrorCode.INVALID_CONFIG,
      "Secret must be a non-empty string with at least 32 characters",
    );
  }

  const key = webhookKey(event, url);
  webhookRegistry.set(key, { event, url, secret });

  return ok(undefined);
}

/**
 * Unregister a webhook.
 */
export function unregisterWebhook(
  event: WebhookEventType,
  url: string,
): SorokitResult<void> {
  const key = webhookKey(event, url);
  if (!webhookRegistry.has(key)) {
    return err(
      SorokitErrorCode.INVALID_CONFIG,
      `Webhook not found for event: ${event}, url: ${url}`,
    );
  }

  webhookRegistry.delete(key);
  return ok(undefined);
}

/**
 * List all registered webhooks for an event type.
 */
export function listWebhooks(event: WebhookEventType): WebhookRegistration[] {
  const results: WebhookRegistration[] = [];
  for (const [key, registration] of webhookRegistry.entries()) {
    if (registration.event === event) {
      results.push(registration);
    }
  }
  return results;
}

/**
 * Clear all registered webhooks.
 */
export function clearWebhooks(): void {
  webhookRegistry.clear();
}

/**
 * Generate HMAC-SHA256 signature for webhook payload.
 * 
 * @param payload - JSON stringified payload (without signature field)
 * @param secret - Secret key for HMAC
 * @returns Hex-encoded signature
 */
async function generateSignature(payload: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const payloadData = encoder.encode(payload);

  const cryptoKey = await globalThis.crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await globalThis.crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    payloadData,
  );

  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Verify HMAC-SHA256 signature for webhook payload.
 * 
 * @param payload - JSON stringified payload (without signature field)
 * @param signature - Hex-encoded signature to verify
 * @param secret - Secret key for HMAC
 * @returns true if signature is valid
 */
export async function verifySignature(
  payload: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  const expectedSignature = await generateSignature(payload, secret);
  return signature === expectedSignature;
}

/**
 * Send webhook payload with retry logic.
 * 
 * @param registration - Webhook registration
 * @param payload - Payload to send
 * @param maxRetries - Maximum retry attempts (default: 3)
 * @returns ok(void) on success, error on final failure
 */
async function sendWebhookWithRetry(
  registration: WebhookRegistration,
  payload: WebhookPayload,
  maxRetries = 3,
): Promise<SorokitResult<void>> {
  const { url } = registration;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Sorokit-Signature": payload.signature,
          "X-Sorokit-Event": payload.event,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000), // 10 second timeout per attempt
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return ok(undefined);
    } catch (error) {
      lastError = error;
      
      // Don't retry on the last attempt
      if (attempt < maxRetries) {
        // Exponential backoff: 1s, 2s, 4s
        const delayMs = 1000 * Math.pow(2, attempt);
        await sleep(delayMs);
      }
    }
  }

  return err(
    SorokitErrorCode.NETWORK_ERROR,
    `Webhook delivery failed after ${maxRetries + 1} attempts to ${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    lastError,
  );
}

/**
 * Trigger webhooks for a transaction event.
 * 
 * @param event - Event type
 * @param transaction - Transaction result
 * @returns Array of results for each webhook (ok or error)
 */
export async function triggerWebhooks(
  event: WebhookEventType,
  transaction: TransactionResult,
): Promise<SorokitResult<void>[]> {
  const registrations = listWebhooks(event);
  if (registrations.length === 0) {
    return [];
  }

  const results: SorokitResult<void>[] = [];

  for (const registration of registrations) {
    // Create payload without signature
    const payloadWithoutSignature = {
      event,
      hash: transaction.hash,
      status: transaction.status,
      ledger: transaction.ledger,
      timestamp: new Date().toISOString(),
    };

    const payloadString = JSON.stringify(payloadWithoutSignature);
    const signature = await generateSignature(payloadString, registration.secret);

    const payload: WebhookPayload = {
      ...payloadWithoutSignature,
      signature,
    };

    const result = await sendWebhookWithRetry(registration, payload);
    results.push(result);
  }

  return results;
}
