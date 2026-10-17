import { useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { SpriteTile } from "../../components/admin/CreatureSprite";
import type { Evolution } from "../../lib/rebyters/types";

const STAGES = ["Bit", "Byte", "Kylo", "Mega", "Giga", "Tera"];

/** Admin only: choose the form of the free rebyter. */
export function FormPicker({ forms, current, onPick, onClear, onClose }: { forms: Evolution[]; current: number | null; onPick: (id: number) => void; onClear: () => void; onClose: () => void }) {
  const [stage, setStage] = useState<number | null>(null);
  const shown = forms.filter((f) => stage === null || f.stage === stage);
  return createPortal(
    <div className="rb-ui">
      <div className="ap-backdrop" role="dialog" aria-modal="true" aria-label="Pick a form" onClick={onClose}>
        <div className="ap-card ap-picker" onClick={(e) => e.stopPropagation()}>
          <div className="ap-head">
            <strong>Free rebyter</strong>
            <button type="button" onClick={onClose} aria-label="Close"><X /></button>
          </div>
          <p className="ap-note">Pick any form. It shows up with your other rebyters, only on this device.</p>
          <div className="ap-stages">
            <button type="button" className={stage === null ? "on" : ""} onClick={() => setStage(null)}>All</button>
            {STAGES.map((name, i) => (
              <button key={name} type="button" className={stage === i ? "on" : ""} onClick={() => setStage(i)}>{name}</button>
            ))}
          </div>
          <div className="ap-grid">
            {shown.map((f) => (
              <button key={f.id} type="button" className={f.id === current ? "on" : ""} onClick={() => onPick(f.id)} aria-label={f.name}>
                <SpriteTile evolution={f} />
                <small>{f.name}</small>
              </button>
            ))}
          </div>
          {current !== null && <button type="button" className="ap-clear" onClick={onClear}>Remove the free rebyter</button>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
