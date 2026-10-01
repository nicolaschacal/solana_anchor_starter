import { useMemo, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { generateSigner } from "@metaplex-foundation/umi";
import { walletAdapterIdentity } from "@metaplex-foundation/umi-signer-wallet-adapters";
import { create, fetchAsset, mplCore } from "@metaplex-foundation/mpl-core";
import bs58 from "bs58";
import { usePlayerRebyters } from "../../hooks/usePlayerRebyters";
import { RPC_URL } from "../../lib/rebyters/config";

type BenchmarkResult = {
  asset: string;
  signature: string;
  accountLamports: number;
  totalDebitLamports: number;
  dnaLength: number;
  uri: string;
};

function sol(lamports: number) {
  return (lamports / LAMPORTS_PER_SOL).toFixed(6);
}

export function CoreBenchmark() {
  const wallet = useWallet();
  const { connection } = useConnection();
  const player = usePlayerRebyters();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<BenchmarkResult | null>(null);

  const source = useMemo(() => player.owned[0], [player.owned]);

  async function run() {
    if (!wallet.publicKey) throw new Error("Connect a wallet first");
    if (!source) throw new Error("Mint a Token-2022 Rebyter first so we can benchmark the exact same DNA");
    if (!source.dnaBase58) throw new Error("The selected Rebyter has no packed DNA metadata");
    if (!source.metadataUri) throw new Error("The selected Rebyter has no metadata URI");

    setBusy(true);
    setError("");
    setResult(null);
    try {
      const umi = createUmi(RPC_URL)
        .use(mplCore())
        .use(walletAdapterIdentity(wallet as any));

      const asset = generateSigner(umi);
      const before = await connection.getBalance(wallet.publicKey, "confirmed");

      const sent = await create(umi, {
        asset,
        name: "mammal.exe",
        uri: source.metadataUri,
        plugins: [
          {
            type: "Attributes",
            attributeList: [{ key: "DNA", value: source.dnaBase58 }],
          },
        ],
      }).sendAndConfirm(umi);

      const signature = bs58.encode(sent.signature);
      await connection.confirmTransaction(signature, "confirmed");

      const after = await connection.getBalance(wallet.publicKey, "confirmed");
      const assetPk = new PublicKey(asset.publicKey.toString());
      const accountLamports = await connection.getBalance(assetPk, "confirmed");
      await fetchAsset(umi, asset.publicKey);

      setResult({
        asset: asset.publicKey.toString(),
        signature,
        accountLamports,
        totalDebitLamports: Math.max(0, before - after),
        dnaLength: source.dnaBase58.length,
        uri: source.metadataUri,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ maxWidth: 880 }}>
      <div className="page-heading">
        <div>
          <span className="eyebrow">ARCHITECTURE BENCHMARK</span>
          <h1>Metaplex Core vs Token-2022</h1>
        </div>
      </div>

      <div className="notice">
        This test mints one Core asset on devnet using the same off-chain URI and the exact same Base58 DNA currently stored in your first Token-2022 Rebyter.
      </div>

      <div className="identity-strip">
        <div>
          <small>SOURCE REBYTER</small>
          <strong>{source ? source.mint.slice(0, 6) + "..." + source.mint.slice(-5) : "None"}</strong>
        </div>
        <div>
          <small>DNA LENGTH</small>
          <strong>{source?.dnaBase58?.length ?? 0} chars</strong>
        </div>
        <div>
          <small>TOKEN-2022 OBSERVED COST</small>
          <strong>0.005920 SOL</strong>
        </div>
      </div>

      <button className="primary" disabled={busy || !wallet.connected || !source} onClick={() => void run()}>
        {busy ? "Minting Core benchmark..." : "Mint equivalent Core Rebyter"}
      </button>

      {error && <div className="notice error">{error}</div>}

      {result && (
        <div className="chain-details" style={{ marginTop: 18 }}>
          <div><small>CORE ASSET</small><code>{result.asset}</code></div>
          <div><small>ASSET ACCOUNT RENT</small><strong>{sol(result.accountLamports)} SOL</strong></div>
          <div><small>TOTAL WALLET DEBIT</small><strong>{sol(result.totalDebitLamports)} SOL</strong></div>
          <div><small>DNA</small><strong>{result.dnaLength} Base58 chars · Attributes plugin</strong></div>
          <div>
            <small>EXPLORER</small>
            <a href={`https://explorer.solana.com/address/${result.asset}?cluster=devnet`} target="_blank" rel="noreferrer">Open Core asset</a>
          </div>
          <div><small>SIGNATURE</small><code>{result.signature}</code></div>
        </div>
      )}
    </section>
  );
}
