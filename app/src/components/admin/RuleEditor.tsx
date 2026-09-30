import { Plus, Trash2 } from "lucide-react";
import { GROUPS } from "../../lib/rebyters/types";
import type { BalanceProfile, EvolutionRule, RuleCondition, RuleLevel } from "../../lib/rebyters/rule-types";
import { LEVELS, levelLabel, metricChoices, resolvedLabel } from "../../lib/rebyters/rules";

function ConditionEditor({ value: c, balance, stage, group, onChange, onRemove }: { value: RuleCondition; balance: BalanceProfile; stage: number; group?: number; onChange: (c: RuleCondition) => void; onRemove: () => void }) {
  const choices = metricChoices(balance, group);
  const update = (patch: Partial<RuleCondition>) => onChange({ ...c,...patch });
  return <div className="qualitative-condition">
    <label>Characteristic<select aria-label="Characteristic" value={c.metrics.join("+")} onChange={e => onChange({ metrics: e.target.value.split("+"), test: "min", level: "medium" })}>{choices.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}</select></label>
    <label>Comparison<select value={c.test} onChange={e => { const test=e.target.value as RuleCondition["test"]; onChange(c.level && test !== "eq" ? { metrics:c.metrics,test,level:c.level } : { metrics:c.metrics,test,value:c.value ?? 0,...(test === "range" ? { upper:c.upper ?? c.value ?? 0 } : {}) }); }}><option value="min">At least</option><option value="max">At most</option><option value="range">Within range</option><option value="eq">Exactly</option></select></label>
    {c.test !== "eq" && <label>Level<select value={c.level ?? "custom"} onChange={e => onChange(e.target.value === "custom" ? { metrics:c.metrics,test:c.test,value:0,...(c.test === "range" ? {upper:0} : {}) } : { metrics:c.metrics,test:c.test,level:e.target.value as RuleLevel })}>{LEVELS.map(l => <option key={l} value={l}>{levelLabel(l,c.metrics[0])}</option>)}<option value="custom">Exact threshold</option></select></label>}
    {!c.level && <label>Value<input type="number" min={0} max={balance.metrics[c.metrics[0]].maximum} value={c.value ?? 0} onChange={e => update({value:Number(e.target.value)})}/></label>}
    {c.test === "range" && (c.level ? <label>Through<select value={c.upperLevel ?? c.level} onChange={e => update({upperLevel:e.target.value as RuleLevel})}>{LEVELS.map(l => <option key={l} value={l}>{levelLabel(l,c.metrics[0])}</option>)}</select></label> : <label>Maximum<input type="number" min={0} value={c.upper ?? 0} onChange={e => update({upper:Number(e.target.value)})}/></label>)}
    <button className="icon danger" title="Remove condition" aria-label="Remove condition" onClick={onRemove}><Trash2 size={14}/></button>
    <small className="resolved-condition">{resolvedLabel(c,balance,stage)}</small>
  </div>;
}
export function RuleEditor({ rule, balance, stage, onChange }: { rule: EvolutionRule; balance: BalanceProfile; stage: number; onChange: (r: EvolutionRule) => void }) {
  const change = (patch: Partial<EvolutionRule>) => onChange({ ...rule,...patch,authoredBy:"admin" });
  const newCondition = (group?: number): RuleCondition => ({ metrics: [metricChoices(balance,group)[0].value],test:"min",level:"medium" });
  return <div className="qualitative-rule-editor">
    <div className="rule-access"><label>Unlock condition<select value={rule.requiredGroups} onChange={e => change({ requiredGroups:Number(e.target.value) })}>{(rule.groups.length ? Array.from({length:rule.groups.length},(_,i) => i+1) : [0]).map(n => <option key={n} value={n}>At least {n} of {rule.groups.length} categories</option>)}</select></label><span className="rule-choice">Player chooses among unlocked forms</span></div>
    <div className="rule-editor-gates"><h4>Mandatory conditions</h4>{!rule.mandatory.length && <p className="rule-empty">None</p>}{rule.mandatory.map((c,i) => <ConditionEditor key={i} value={c} balance={balance} stage={stage} onChange={value => change({mandatory:rule.mandatory.map((old,j)=>j===i?value:old)})} onRemove={() => change({mandatory:rule.mandatory.filter((_,j)=>j!==i)})}/>)}<button className="text-button" onClick={() => change({mandatory:[...rule.mandatory,{metrics:["progression.cycle"],test:"min",value:1}]})}><Plus size={13}/>Add mandatory condition</button></div>
    {GROUPS.slice(0,5).map((label,id) => {
      const group = rule.groups.find(g => g.group === id);
      const replace = (alternatives: RuleCondition[][]) => change({groups:rule.groups.map(g=>g.group===id?{...g,alternatives}:g)});
      return <section className="rule-category" key={id}><div className="rule-category-heading"><h4>{label}</h4><label className="checkbox"><input type="checkbox" checked={!!group} onChange={e => { const groups = e.target.checked ? [...rule.groups,{group:id,alternatives:[[newCondition(id)]]}].sort((a,b)=>a.group-b.group) : rule.groups.filter(g=>g.group!==id); change({ groups,requiredGroups:groups.length ? Math.max(1,Math.min(rule.requiredGroups,groups.length)) : 0 }); }}/>{group ? "Enabled" : "No requirement"}</label></div>
        {group?.alternatives.map((alt,ai) => <div className="rule-alternative" key={ai}>{ai>0 && <strong className="rule-or">OR</strong>}{alt.map((c,ci) => <ConditionEditor key={ci} value={c} balance={balance} stage={stage} group={id} onChange={value=>replace(group.alternatives.map((a,i)=>i===ai?a.map((old,j)=>j===ci?value:old):a))} onRemove={() => { const alternatives=group.alternatives.map((a,i)=>i===ai?a.filter((_,j)=>j!==ci):a).filter(a=>a.length); if(alternatives.length) replace(alternatives); else {const groups=rule.groups.filter(g=>g.group!==id);change({groups,requiredGroups:Math.min(rule.requiredGroups,groups.length)});} }}/>) }<button className="text-button" onClick={()=>replace(group.alternatives.map((a,i)=>i===ai?[...a,newCondition(id)]:a))}><Plus size={12}/>AND condition</button></div>)}
        {group && <button className="text-button" onClick={()=>replace([...group.alternatives,[newCondition(id)]])}><Plus size={12}/>OR alternative</button>}
      </section>;
    })}
    <div className="rule-editor-bonuses"><h4>Optional affinities</h4>{!rule.bonuses.length && <p className="rule-empty">None</p>}{rule.bonuses.map((c,i)=><ConditionEditor key={i} value={c} balance={balance} stage={stage} onChange={value=>change({bonuses:rule.bonuses.map((old,j)=>j===i?value:old)})} onRemove={()=>change({bonuses:rule.bonuses.filter((_,j)=>j!==i)})}/>)}<button className="text-button" onClick={()=>change({bonuses:[...rule.bonuses,newCondition(2)]})}><Plus size={12}/>Add optional affinity</button></div>
    <small className="rule-balance-version">Balance: {balance.version}</small>
  </div>;
}
