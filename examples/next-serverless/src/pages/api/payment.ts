/**
 * Next.js API route — POST /api/payment
 *
 * Receives a destination and amount, builds a payment transaction, signs it
 * with the server's secret key, submits it, and returns the tx hash.
 *
 * The secret key never leaves the server. The browser only sees the tx hash.
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { getServerClient, serverSendPayment } from "../../sorokitServer";
import type { NetworkType } from "../../../../../src/network/config";

interface PaymentRequestBody {
  destination: string;
  amount: string;
}

interface PaymentResponse {
  hash?: string;
  error?: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<PaymentResponse>,
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { destination, amount } = req.body as PaymentRequestBody;

  if (!destination || !amount) {
    return res.status(400).json({ error: "destination and amount are required" });
  }

  // Source account and secret key come from environment variables.
  // Set these in .env.local — never commit them to the repo.
  const secretKey = process.env.SIGNING_SECRET_KEY;
  const sourcePublicKey = process.env.SOURCE_PUBLIC_KEY;
  const network = (process.env.STELLAR_NETWORK ?? "testnet") as NetworkType;

  if (!secretKey || !sourcePublicKey) {
    return res.status(500).json({ error: "Server signing keys not configured" });
  }

  const client = getServerClient(network);
  const result = await serverSendPayment(client, {
    sourcePublicKey,
    destination,
    amount,
    secretKey,
  });

  if (result.status === "error") {
    // Map SDK error codes to HTTP status codes where it makes sense.
    const status =
      result.error.code === "INVALID_CONFIG" ||
      result.error.code === "INVALID_ADDRESS"
        ? 400
        : 502;
    return res.status(status).json({ error: result.error.message });
  }

  return res.status(200).json({ hash: result.data.hash });
}
