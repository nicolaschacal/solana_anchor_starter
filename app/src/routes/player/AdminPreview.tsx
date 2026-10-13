import { Suspense, lazy, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { TreeJson } from "../../lib/rebyters/types";
import { defaultLayout, specFor } from "../../components/world/layout";
import type { WorldCreature } from "../../components/world/PlayerWorld";

const PlayerWorld = lazy(() => import("../../components/world/PlayerWorld").then((m) => ({ default: m.PlayerWorld })));
const STAGES = ["Origin", "Byte", "Kylo", "Stage 3", "Stage 4", "Stage 5"];
const SIZE = 9 as const;

/**
 * Admin only: every form of the atlas standing in the real game world (same camera, sizes and objects),
 * a page at a time. Nothing is saved: these are not rebyters, only the forms, so no wallet or chain is touched.
 */
export function AdminPreview({ tree, onClose }: { tree: TreeJson; onClose: () => void }) {
  const spec = useMemo(() => specFor(SIZE), []);
  const stages = useMemo(() => STAGES.map((label, stage) => ({ label, stage, forms: tree.evolutions.filter((e) => e.stage === stage) })).filter((s) => s.forms.length), [tree]);
  const [stage, setStage] = useState(stages[0]?.stage ?? 0);
  const [page, setPage] = useState(0);
  const forms = stages.find((s) => s.stage === stage)?.forms ?? [];
  const per = Math.max(1, spec.maxPlaced);
  const pages = Math.max(1, Math.ceil(forms.length / per));
  const shown = forms.slice(page * per, page * per + per);
  const creatures = useMemo<WorldCreature[]>(
    () => shown.map((form) => ({ mint: `preview-${form.id}`, evolution: form, emote: null, happy: false, level: 1, stageName: STAGES[form.stage] ?? "", fullness: 80, energy: 80, bond: 50 })),
    [shown],
  );
  const layout = useMemo(() => defaultLayout(creatures.map((c) => c.mint), spec), [creatures, spec]);
  const pick = (next: number) => {
    setStage(next);
    setPage(0);
  };
  return createPortal(
    <div className="rb-ui" style={{ position: "fixed", inset: 0, zIndex: 400, background: "#0c1a2e" }}>
      <Suspense fallback={<div className="world-loading" role="status">Loading preview…</div>}>
        <PlayerWorld
          key={`${stage}-${page}`}
          creatures={creatures}
          initialLayout={layout}
          onCommitLayout={async () => undefined}
          period="Day"
          onSelect={() => undefined}
          editable={false}
          showcase
          size={SIZE}
        />
      </Suspense>
      <div style={{ position: "absolute", left: 12, right: 12, top: "calc(10px + env(safe-area-inset-top,0px))", display: "flex", gap: 8, alignItems: "center", zIndex: 30, pointerEvents: "none" }}>
        <button className="ui-btn ui-btn-secondary ui-btn-sm" style={{ pointerEvents: "auto" }} onClick={onClose}><X /> Close</button>
        <div style={{ display: "flex", gap: 6, overflowX: "auto", pointerEvents: "auto", flex: 1 }}>
          {stages.map((s) => (
            <button key={s.stage} className={`ui-btn ui-btn-sm ${s.stage === stage ? "ui-btn-primary" : "ui-btn-secondary"}`} onClick={() => pick(s.stage)}>{s.label} · {s.forms.length}</button>
          ))}
        </div>
      </div>
      <div style={{ position: "absolute", left: 12, right: 12, bottom: "calc(12px + env(safe-area-inset-bottom,0px))", zIndex: 30, display: "flex", gap: 8, alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
        <button className="ui-btn ui-btn-secondary ui-btn-sm" style={{ pointerEvents: "auto" }} disabled={page === 0} onClick={() => setPage(page - 1)}><ChevronLeft /></button>
        <div className="ui-btn ui-btn-secondary ui-btn-sm" style={{ pointerEvents: "auto", display: "block", maxWidth: "70%", whiteSpace: "normal", textAlign: "center", height: "auto", lineHeight: 1.35, padding: "6px 12px" }}>
          <strong>{page + 1}/{pages}</strong> · {shown.map((f) => f.name).join(", ")}
        </div>
        <button className="ui-btn ui-btn-secondary ui-btn-sm" style={{ pointerEvents: "auto" }} disabled={page >= pages - 1} onClick={() => setPage(page + 1)}><ChevronRight /></button>
      </div>
    </div>,
    document.body,
  );
}
