import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import QRCode from "qrcode";
import { Rocket } from "lucide-react";
import deployment from "../../lib/economy/deployment.json";

/** Mainnet SOL destination (the game wallet). Plain transfer, no program involved. */
const WALLET: string = deployment.treasury;
const TIERS = [
  { sol: 0.05, name: "Scout" },
  { sol: 0.1, name: "Explorer" },
  { sol: 0.5, name: "Founder" },
];

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
  const touch = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;

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
              {touch ? (
                <>
                  <a className="support-go" href={uri}>Back with my wallet</a>
                  <button type="button" className="support-copy" onClick={copy}>{copied ? "Copied!" : "Copy address instead"}</button>
                </>
              ) : (
                <>
                  {qr && <img className="support-qr" src={qr} alt="Solana Pay QR code" />}
                  <p className="support-scan">Scan with your phone's wallet app</p>
                  <button type="button" className="support-go" onClick={copy}>{copied ? "Copied!" : "Copy wallet address"}</button>
                </>
              )}
              <button type="button" className="support-x" onClick={() => setOpen(false)}>Maybe later</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
