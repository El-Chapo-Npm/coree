/**
 * Next.js API route — GET /api/balances?accounts=G1,G2,G3
 *
 * Batch-fetches balances for up to 10 accounts and returns them as JSON.
 * Useful for server-rendered dashboards that need multiple accounts at once.
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { getServerClient, batchGetAccounts } from "../../sorokitServer";
import type { NetworkType } from "../../../../../src/network/config";
import type { AccountInfo } from "../../../../../src/account/types";

interface BalancesResponse {
  accounts?: AccountInfo[];
  error?: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<BalancesResponse>,
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const raw = req.query["accounts"];
  const accountsParam = Array.isArray(raw) ? raw[0] : raw;

  if (!accountsParam) {
    return res.status(400).json({ error: "accounts query param is required" });
  }

  const publicKeys = accountsParam.split(",").map((k) => k.trim()).filter(Boolean);

  if (publicKeys.length > 10) {
    return res.status(400).json({ error: "Maximum 10 accounts per request" });
  }

  const network = (process.env.STELLAR_NETWORK ?? "testnet") as NetworkType;
  const client = getServerClient(network);
  const result = await batchGetAccounts(client, publicKeys);

  if (result.status === "error") {
    return res.status(502).json({ error: result.error.message });
  }

  return res.status(200).json({ accounts: result.data });
}
