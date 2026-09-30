import { Activity, Apple, Clock3, Dna, Dumbbell, Flag, Info, LockKeyhole, Plus, RotateCcw, Trash2 } from "lucide-react";
import { STAGES, type Evolution, type EvolutionPath, type TreeJson } from "../../lib/rebyters/types";
import { defaultRule } from "../../lib/rebyters/rules";
import { RuleEditor } from "./RuleEditor";
import { RuleSummary } from "./RuleSummary";


const requirementIcon = (key: string) => {
  const k = key.toLowerCase();
  if (k.includes("genetic")) return <Dna size={14}/>;
  if (k.includes("diet")) return <Apple size={14}/>;
  if (k.includes("time")) return <Clock3 size={14}/>;
  if (k.includes("activity")) return <Activity size={14}/>;
  if (k.includes("physical")) return <Dumbbell size={14}/>;
  if (k.includes("mandatory")) return <LockKeyhole size={14}/>;
  if (k.includes("cycle")) return <RotateCcw size={14}/>;
  if (k.includes("required")) return <Flag size={14}/>;
  return <Info size={14}/>;
};

export function EvolutionEditor({ tree, evolution: e, onChange, readOnly }: { tree: TreeJson; evolution: Evolution; onChange: (e: Evolution) => void; readOnly: boolean }) {
  const update = (patch: Partial<Evolution>) => onChange({ ...e,...patch });
  const available = tree.evolutions.filter(x => x.stage === e.stage+1 && !e.paths.some(p=>p.target===x.id));
  return <div className="evolution-editor">
    <div className="section-heading"><div><span className="eyebrow">EVOLUTION #{e.id}</span><h2>{e.name}</h2></div><span className="tag">{STAGES[e.stage]}</span></div>
    <fieldset disabled={readOnly}>
      <div className="form-grid">
        <label>Name<input value={e.name} maxLength={48} onChange={v=>update({name:v.target.value})}/></label>
        <label>Stage<select value={e.stage} onChange={v=>update({stage:Number(v.target.value)})}>{STAGES.map((s,i)=><option key={s} value={i}>{s}</option>)}</select></label>
        <label>Initial weight<input type="number" min={0} max={65535} value={e.initialWeight} onChange={v=>update({initialWeight:Number(v.target.value)})}/></label>
        <label className="checkbox"><input type="checkbox" checked={e.enabled} onChange={v=>update({enabled:v.target.checked})}/>Enabled</label>
        <label className="wide">Model URI<input placeholder="irys:// or https://..." value={e.assets?.modelUri ?? e.modelUri} onChange={v=>update({modelUri:v.target.value,assets:{...e.assets,modelUri:v.target.value}})}/></label>
        <label className="wide">Metadata URI<input placeholder="Irys metadata JSON URI" value={e.assets?.metadataUri ?? ""} onChange={v=>update({assets:{...e.assets,metadataUri:v.target.value}})}/></label>
        <label className="wide">Image URI<input placeholder="Irys image / thumbnail URI" value={e.assets?.imageUri ?? ""} onChange={v=>update({assets:{...e.assets,imageUri:v.target.value}})}/></label>
        <label className="wide">Thumbnail URI<input placeholder="Optional atlas thumbnail URI" value={e.assets?.thumbnailUri ?? ""} onChange={v=>update({assets:{...e.assets,thumbnailUri:v.target.value}})}/></label>
      </div>
      <div className="section-heading"><h3>Outgoing paths <span className="count">{e.paths.length}</span></h3><button type="button" disabled={!available.length || e.paths.length>=16} onClick={()=>update({paths:[...e.paths,{target:available[0].id,rule:tree.balance?defaultRule():undefined}]})}><Plus size={15}/>Add path</button></div>
      {!e.paths.length && <div className="empty">Terminal evolution</div>}
      {e.paths.map((path,index)=>{
        const target=tree.evolutions.find(x=>x.id===path.target)!;
        const setPath=(patch:Partial<EvolutionPath>)=>update({paths:e.paths.map((p,i)=>i===index?{...p,...patch}:p)});
        return <section className="path qualitative-path" key={path.target}>
          <div className="qualitative-path-heading"><label>Target<select value={path.target} onChange={v=>setPath({target:Number(v.target.value)})}>{[target,...available].map(x=><option key={x.id} value={x.id}>{x.name} / {STAGES[x.stage]}</option>)}</select></label><button type="button" className="icon danger" title="Remove path" aria-label="Remove path" onClick={()=>update({paths:e.paths.filter((_,i)=>i!==index)})}><Trash2 size={16}/></button></div>
          <RuleSummary path={path} balance={tree.balance} stage={target.stage}/>
          {path.designRule && (!path.rule || !tree.balance) && <details className="design-rule-details" open><summary>Evolution requirements</summary><dl>{Object.entries(path.designRule).map(([key,value])=><div key={key} className="design-rule-row"><dt><span className="requirement-icon">{requirementIcon(key)}</span>{key}</dt><dd>{value}</dd></div>)}</dl></details>}
          {path.rule && tree.balance && !readOnly && <details className="rule-edit-details"><summary>Edit conditions for {target.name}</summary><RuleEditor rule={path.rule} balance={tree.balance} stage={target.stage} onChange={rule=>setPath({rule})}/></details>}
          {!path.rule && tree.balance && !readOnly && <button type="button" className="text-button" onClick={()=>setPath({rule:defaultRule()})}><Plus size={14}/>Configure requirements</button>}
          {!tree.balance && <p className="requirement-migration-note"><Info size={14}/><span><strong>Legacy active version.</strong> The route logic above is readable, but this published v3 does not contain the newer numeric balance profile. Nothing is broken: publish the workbook upgrade before editing exact thresholds from the Admin.</span></p>}
        </section>;
      })}
    </fieldset>
  </div>;
}
