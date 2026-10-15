import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import QRCode from "qrcode";
import { Heart } from "lucide-react";
import deployment from "../../lib/economy/deployment.json";

/** Mainnet SOL destination (the game wallet). Plain transfer, no program involved. */
const WALLET: string = deployment.treasury;
const AMOUNTS = [0.05, 0.1, 0.5];

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
  const uri = payUri(sol);

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

  return (
    <>
      <button type="button" className="support-btn" onClick={() => setOpen(true)}>
        <Heart size={16} /> Support reByters
      </button>
      {open && createPortal(
        <div className="rb-ui">
          <div className="support-back" onClick={() => setOpen(false)}>
            <div className="support-card" role="dialog" aria-label="Support reByters" onClick={(e) => e.stopPropagation()}>
              <h3>Help reByters grow</h3>
              <p>We're a small team building reByters. Any contribution helps us keep expanding the world, the creatures and the game. Thank you!</p>
              <div className="support-amts">
                {AMOUNTS.map((a) => (
                  <button key={a} type="button" className={a === sol ? "on" : ""} onClick={() => setSol(a)}>{a} SOL</button>
                ))}
              </div>
              {qr && <img className="support-qr" src={qr} alt="Solana Pay QR code" />}
              <a className="support-go" href={uri}>Open in my wallet</a>
              <button type="button" className="support-copy" onClick={copy}>{copied ? "Copied!" : "Copy wallet address"}</button>
              <p className="support-addr">{WALLET}</p>
              <p className="support-note">Real SOL on Solana mainnet (not the devnet game). You can change the amount in your wallet.</p>
              <button type="button" className="support-x" onClick={() => setOpen(false)}>Close</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
