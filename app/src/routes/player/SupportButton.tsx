import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import QRCode from "qrcode";
import { Rocket } from "lucide-react";
import { getWallets } from "@wallet-standard/app";
import { Connection, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import deployment from "../../lib/economy/deployment.json";

/** Mainnet SOL destination (the game wallet). Plain transfer, no program involved. */
const WALLET: string = deployment.treasury;
const TIERS = [
  { sol: 0.05, name: "Scout" },
  { sol: 0.1, name: "Explorer" },
  { sol: 0.5, name: "Founder" },
];

/** Public mainnet RPCs that allow browser calls; tried in order for the blockhash. */
const MAINNET_RPCS = ["https://solana-rpc.publicnode.com", "https://api.mainnet-beta.solana.com", "https://rpc.ankr.com/solana"];

/** Builds the payment against one RPC and checks it by simulation, so a wallet never gets a transaction that cannot run. */
async function buildPayment(payer: PublicKey, sol: number): Promise<Transaction> {
  let last: unknown;
  for (const url of MAINNET_RPCS) {
    try {
      const connection = new Connection(url, "finalized");
      const { blockhash } = await connection.getLatestBlockhash("finalized");
      const tx = new Transaction({ feePayer: payer, recentBlockhash: blockhash }).add(
        SystemProgram.transfer({ fromPubkey: payer, toPubkey: new PublicKey(WALLET), lamports: Math.round(sol * LAMPORTS_PER_SOL) }),
      );
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
async function payWithWallet(wallet: StdWallet, sol: number) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const f = wallet.features as any;
  const { accounts } = await f["standard:connect"].connect();
  const account = accounts[0] ?? wallet.accounts[0];
  if (!account) throw new Error("no-account");
  const payer = new PublicKey(account.address);
  const tx = await buildPayment(payer, sol);
  await f["solana:signAndSendTransaction"].signAndSendTransaction({
    account,
    chain: "solana:mainnet",
    transaction: tx.serialize({ requireAllSignatures: false, verifySignatures: false }),
  });
}

function payUri(sol: number) {
  const q = new URLSearchParams({ amount: String(sol), label: "reByters", message: "Support reByters" });
  return `solana:${WALLET}?${q.toString()}`;
}

/** Kickstarter-style support button: opens a card with a Solana Pay link + QR to the game wallet. */
export function SupportButton() {
  const [open, setOpen] = useState(false);
  const [sol, setSol] = useState(0.1);
  const [qr, setQr] = useState("");
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState<"" | "waiting" | "done" | "fail">("");
  const [problem, setProblem] = useState("");
  const [showQr, setShowQr] = useState(false);
  const uri = payUri(sol);
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
    try { await payWithWallet(list[0], sol); setStatus("done"); }
    catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setProblem(/reject|denied|declin|cancel|closed/i.test(m) ? "The payment was cancelled in your wallet." : `The wallet could not complete the payment (${m.slice(0, 200)}). Use the QR or copy the address.`);
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
              <div className="support-amts">
                {TIERS.map((t) => (
                  <button key={t.sol} type="button" className={t.sol === sol ? "on" : ""} onClick={() => setSol(t.sol)}>
                    <b>{t.name}</b><small>{t.sol} SOL</small>
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
