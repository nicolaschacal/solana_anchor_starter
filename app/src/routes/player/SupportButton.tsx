import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import QRCode from "qrcode";
import { Rocket } from "lucide-react";
import { getWallets } from "@wallet-standard/app";
import { createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Connection, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import deployment from "../../lib/economy/deployment.json";

/** Mainnet SOL destination (the game wallet). Plain transfer, no program involved. */
const WALLET: string = deployment.treasury;
type Asset = "SOL" | "USDC";
const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const TIERS = [
  { name: "Scout", SOL: 0.05, USDC: 5 },
  { name: "Explorer", SOL: 0.1, USDC: 10 },
  { name: "Founder", SOL: 0.5, USDC: 25 },
];

/** Turns a simulation failure into something a person can act on. */
function explain(raw: string, asset: Asset): string {
  if (/InsufficientFundsForFee|AccountNotFound|insufficient lamports|InsufficientFundsForRent/i.test(raw))
    return asset === "USDC" ? "Your wallet needs a tiny bit of SOL (a fraction of a cent) to pay the network fee." : "Your wallet doesn't have enough SOL on mainnet for this amount plus the network fee.";
  if (asset === "USDC" && /Custom.?(1|3)|"Custom":1|InvalidAccountData|0x1\b/i.test(raw))
    return "Your wallet doesn't have enough USDC for this amount.";
  return `The wallet could not complete the payment (${raw.slice(0, 160)}).`;
}

/** Public mainnet RPCs that allow browser calls; tried in order for the blockhash. */
const MAINNET_RPCS = ["https://solana-rpc.publicnode.com", "https://api.mainnet-beta.solana.com", "https://rpc.ankr.com/solana"];

/** Builds the payment against one RPC and checks it by simulation, so a wallet never gets a transaction that cannot run. */
async function buildPayment(payer: PublicKey, amount: number, asset: Asset): Promise<Transaction> {
  let last: unknown;
  for (const url of MAINNET_RPCS) {
    try {
      const connection = new Connection(url, "finalized");
      const { blockhash } = await connection.getLatestBlockhash("finalized");
      const tx = new Transaction({ feePayer: payer, recentBlockhash: blockhash });
      const dest = new PublicKey(WALLET);
      if (asset === "SOL") {
        tx.add(SystemProgram.transfer({ fromPubkey: payer, toPubkey: dest, lamports: Math.round(amount * LAMPORTS_PER_SOL) }));
      } else {
        const from = getAssociatedTokenAddressSync(USDC_MINT, payer);
        const to = getAssociatedTokenAddressSync(USDC_MINT, dest);
        // Creates the game wallet's USDC account the first time (the payer covers that small rent).
        tx.add(
          createAssociatedTokenAccountIdempotentInstruction(payer, to, dest, USDC_MINT),
          createTransferCheckedInstruction(from, USDC_MINT, to, payer, Math.round(amount * 1_000_000), 6),
        );
      }
      let verdict: { err: unknown; logs?: string[] | null } | null = null;
      try { verdict = (await connection.simulateTransaction(tx)).value; } catch { /* this RPC cannot simulate: let the wallet judge */ }
      if (verdict?.err) throw new Error(`simulation: ${typeof verdict.err === "string" ? verdict.err : JSON.stringify(verdict.err)} ${(verdict.logs ?? []).slice(-2).join(" | ")}`);
      return tx;
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("simulation:")) throw e;
      last = e;
    }
  }
  throw last instanceof Error ? last : new Error("rpc-unreachable");
}

type StdWallet = ReturnType<ReturnType<typeof getWallets>["get"]>[number];
const hasFeatures = (w: StdWallet) => "standard:connect" in w.features && "solana:signAndSendTransaction" in w.features;

/** Browser wallets (Wallet Standard) that can sign and send a Solana transaction. */
const browserWallets = () => getWallets().get().filter(hasFeatures);

/** Asks an installed wallet to pay `sol` to the game wallet on mainnet; the wallet shows the amount ready to approve. */
async function payWithWallet(wallet: StdWallet, amount: number, asset: Asset) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const f = wallet.features as any;
  const { accounts } = await f["standard:connect"].connect();
  const account = accounts[0] ?? wallet.accounts[0];
  if (!account) throw new Error("no-account");
  const payer = new PublicKey(account.address);
  const tx = await buildPayment(payer, amount, asset);
  await f["solana:signAndSendTransaction"].signAndSendTransaction({
    account,
    chain: "solana:mainnet",
    transaction: tx.serialize({ requireAllSignatures: false, verifySignatures: false }),
  });
}

function payUri(amount: number, asset: Asset) {
  const q = new URLSearchParams({ amount: String(amount), ...(asset === "USDC" ? { "spl-token": USDC_MINT.toBase58() } : {}), label: "reByters", message: "Support reByters" });
  return `solana:${WALLET}?${q.toString()}`;
}

/** Kickstarter-style support button: opens a card with a Solana Pay link + QR to the game wallet. */
export function SupportButton() {
  const [open, setOpen] = useState(false);
  const [asset, setAsset] = useState<Asset>("SOL");
  const [amount, setAmount] = useState<number>(0.1);
  const [qr, setQr] = useState("");
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState<"" | "waiting" | "done" | "fail">("");
  const [problem, setProblem] = useState("");
  const [showQr, setShowQr] = useState(false);
  const uri = payUri(amount, asset);
  // A phone or tablet (not a touch-screen laptop, which also reports a coarse pointer).
  const mobile = typeof navigator !== "undefined" && (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1));

  useEffect(() => {
    if (!open) return;
    let alive = true;
    QRCode.toDataURL(uri, { margin: 1, width: 352 }).then((u) => alive && setQr(u)).catch(() => {});
    return () => { alive = false; };
  }, [open, uri]);

  const copy = async () => {
    try { await navigator.clipboard.writeText(WALLET); }
    catch {
      const t = document.createElement("textarea");
      t.value = WALLET; document.body.appendChild(t); t.select();
      try { document.execCommand("copy"); } catch { /* ignore */ }
      t.remove();
    }
    setCopied(true); setTimeout(() => setCopied(false), 1800);
  };

  const back = async () => {
    const list = browserWallets();
    if (!list.length && mobile) { window.location.href = uri; return; }
    if (!list.length) { setProblem("No browser wallet found here. Use the QR or copy the address."); setStatus("fail"); setShowQr(true); return; }
    setStatus("waiting"); setProblem("");
    try { await payWithWallet(list[0], amount, asset); setStatus("done"); }
    catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setProblem(/reject|denied|declin|cancel|closed/i.test(m) ? "The payment was cancelled in your wallet." : explain(m, asset));
      setStatus("fail");
    }
  };

  return (
    <>
      <button type="button" className="support-btn" onClick={() => setOpen(true)}>
        <Rocket size={15} /> Back the project
      </button>
      {open && createPortal(
        <div className="rb-ui">
          <div className="support-back" onClick={() => setOpen(false)}>
            <div className="support-card" role="dialog" aria-label="Support reByters" onClick={(e) => e.stopPropagation()}>
              <h3>Back reByters</h3>
              <p>reByters is built by a small team. Join the first backers and help us grow new creatures, new islands and a bigger world.</p>
              <div className="support-asset" role="group" aria-label="Pay with">
                {(["SOL", "USDC"] as Asset[]).map((a) => (
                  <button key={a} type="button" className={a === asset ? "on" : ""} onClick={() => { setAsset(a); setAmount(TIERS[1][a]); setStatus(""); setProblem(""); }}>{a}</button>
                ))}
              </div>
              <div className="support-amts">
                {TIERS.map((t) => (
                  <button key={t.name} type="button" className={t[asset] === amount ? "on" : ""} onClick={() => setAmount(t[asset])}>
                    <b>{t.name}</b><small>{asset === "USDC" ? `$${t.USDC}` : `${t.SOL} SOL`}</small>
                  </button>
                ))}
              </div>
              <>
                <button type="button" className="support-go" onClick={back} disabled={status === "waiting"}>
                  {status === "waiting" ? "Approve in your wallet…" : status === "done" ? "Thank you! ❤" : "Back with my wallet"}
                </button>
                {status === "fail" && <p className="support-scan">{problem}</p>}
                {showQr && !mobile ? (
                  <>
                    {qr && <img className="support-qr" src={qr} alt="Solana Pay QR code" />}
                    <p className="support-scan">Scan with your phone's wallet app</p>
                    <button type="button" className="support-copy" onClick={copy}>{copied ? "Copied!" : "Copy wallet address"}</button>
                  </>
                ) : mobile ? (
                  <button type="button" className="support-copy" onClick={copy}>{copied ? "Copied!" : "Copy address instead"}</button>
                ) : (
                  <button type="button" className="support-copy" onClick={() => setShowQr(true)}>Use QR code or address</button>
                )}
              </>
              <button type="button" className="support-x" onClick={() => setOpen(false)}>Maybe later</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
