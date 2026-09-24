/**
 * AWS Lambda / Vercel serverless function — sorokit-core payment handler.
 *
 * Drop this into a Lambda function or a Vercel serverless function file.
 * The shape is the same regardless of provider — just adapt the event/response
 * types to match your runtime (APIGatewayProxyEventV2, VercelRequest, etc.).
 *
 * Environment variables expected:
 *   SIGNING_SECRET_KEY  — Stellar secret key (S...)
 *   SOURCE_PUBLIC_KEY   — Matching public key (G...)
 *   STELLAR_NETWORK     — "mainnet" | "testnet" | "futurenet" (default: "testnet")
 */

import { getServerClient, serverSendPayment } from "./sorokitServer";
import type { NetworkType } from "../../../src/network/config";

interface LambdaEvent {
  body?: string | null;
  httpMethod?: string;
}

interface LambdaResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

function json(statusCode: number, data: unknown): LambdaResponse {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  };
}

export async function handler(event: LambdaEvent): Promise<LambdaResponse> {
  if (event.httpMethod && event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  let destination: string;
  let amount: string;

  try {
    const body = JSON.parse(event.body ?? "{}");
    destination = body.destination;
    amount = body.amount;
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  if (!destination || !amount) {
    return json(400, { error: "destination and amount are required" });
  }

  const secretKey = process.env["SIGNING_SECRET_KEY"];
  const sourcePublicKey = process.env["SOURCE_PUBLIC_KEY"];
  const network = (process.env["STELLAR_NETWORK"] ?? "testnet") as NetworkType;

  if (!secretKey || !sourcePublicKey) {
    // Log server-side; never include secret key material in the response.
    console.error("Missing SIGNING_SECRET_KEY or SOURCE_PUBLIC_KEY");
    return json(500, { error: "Server configuration error" });
  }

  const client = getServerClient(network);
  const result = await serverSendPayment(client, {
    sourcePublicKey,
    destination,
    amount,
    secretKey,
  });

  if (result.status === "error") {
    const statusCode =
      result.error.code === "INVALID_CONFIG" ||
      result.error.code === "INVALID_ADDRESS"
        ? 400
        : 502;
    return json(statusCode, { error: result.error.message });
  }

  return json(200, { hash: result.data.hash });
}
