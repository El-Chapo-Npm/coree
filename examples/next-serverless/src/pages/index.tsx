/**
 * Next.js serverless example — client page (#next-serverless).
 *
 * Triggers the payment API route, shows the result, and displays the batch
 * balance endpoint response. No sorokit-core imports here — all SDK calls
 * happen in the API routes, which run server-side.
 */

import React, { useState } from "react";

interface SendState {
  loading: boolean;
  hash: string | null;
  error: string | null;
}

export default function HomePage() {
  const [destination, setDestination] = useState("");
  const [amount, setAmount] = useState("");
  const [send, setSend] = useState<SendState>({ loading: false, hash: null, error: null });

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    setSend({ loading: true, hash: null, error: null });

    const res = await fetch("/api/payment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ destination, amount }),
    });

    const data = await res.json();

    if (!res.ok) {
      setSend({ loading: false, hash: null, error: data.error ?? "Request failed" });
    } else {
      setSend({ loading: false, hash: data.hash, error: null });
    }
  }

  return (
    <div style={{ maxWidth: 480, margin: "2rem auto", fontFamily: "system-ui, sans-serif" }}>
      <h1>sorokit-core — Next.js serverless</h1>
      <p>
        This page calls <code>/api/payment</code>, which signs the transaction
        server-side using an environment-variable secret key.
      </p>

      <form onSubmit={handleSend}>
        <div style={{ marginBottom: "0.75rem" }}>
          <label>
            Destination
            <input
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              placeholder="G..."
              required
              style={{ display: "block", width: "100%", marginTop: 4 }}
            />
          </label>
        </div>
        <div style={{ marginBottom: "0.75rem" }}>
          <label>
            Amount (XLM)
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="10"
              required
              style={{ display: "block", width: "100%", marginTop: 4 }}
            />
          </label>
        </div>
        <button type="submit" disabled={send.loading}>
          {send.loading ? "Sending…" : "Send via server"}
        </button>
      </form>

      {send.hash && (
        <p style={{ marginTop: "1rem", background: "#eef6ff", padding: "0.75rem", borderRadius: 6 }}>
          Transaction confirmed:{" "}
          <a
            href={`https://stellar.expert/explorer/testnet/tx/${send.hash}`}
            target="_blank"
            rel="noreferrer"
          >
            {send.hash}
          </a>
        </p>
      )}

      {send.error && (
        <p style={{ marginTop: "1rem", background: "#fdecec", color: "#8a1c1c", padding: "0.75rem", borderRadius: 6 }}>
          {send.error}
        </p>
      )}
    </div>
  );
}
