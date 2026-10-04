import { REBYTER_CONDITION as C } from "./companions";

export type CareState = { energy:number; fullness:number; condition:number };
export function careGuidance(s:CareState) {
  const sick=!!(s.condition&C.sick), injured=!!(s.condition&C.injured);
  const overfed=!!(s.condition&C.overfed);
  const canCare=s.energy>= (injured?72:52) && (!sick || (s.fullness>=21&&s.fullness<=91));
  let recommended:"feed"|"rest"|"care"|null=null;
  let message="";
  if(s.fullness<21&&(sick||s.fullness<10)){recommended="feed";message="I need food before I can recover. Feed first.";}
  else if(sick&&s.fullness>91){message="I’m too full for care to cure sickness. Wait before feeding again.";}
  else if((sick||injured)&&!canCare){recommended="rest";message="I need more energy to recover. Rest first.";}
  else if(sick||injured){recommended="care";message="I’m ready for care. Help me recover.";}
  else if(s.energy<20||(s.condition&C.tired)){recommended="rest";message="I’m tired. Rest first.";}
  else if(overfed){message="I’m overfed. Wait before feeding again.";}
  const tier=Math.max(0,(s.energy>=50?2:s.energy>=20?1:0)-(sick||injured?1:0));
  const training=tier===0?"Training gives no stat gains and adds a care mistake. Rest first." :tier===1?"Training gains are reduced. "+(sick||injured?"Recover first.":"Rest for full gains."):"Full training gains. Each session also uses 6 fullness.";
  const injuryRisk=s.energy<10||((sick||injured)&&s.energy<30)||(tier===0&&!!(s.condition&C.tired));
  const care=sick||injured ? !canCare ? message : "Care can cure your current condition. Energy −2 · Fullness −1." : "Care builds bond. Energy −2 · Fullness −1.";
  return {recommended,message,training:training+(injuryRisk?" Risk of injury.":""),tier,care};
}
export function mealWarning(s:CareState,food:number){
  const gain=[22,16,18,14][food];
  if(s.condition&C.overfed)return "Already overfed. Another meal adds a care mistake and may cause sickness.";
  if(s.fullness>=90)return "Too full. This meal causes overfeeding and adds a care mistake.";
  return s.fullness+gain>=95?"This meal will overfeed your Rebyter. Choose a lighter meal or wait.":"";
}
export function trainingGains(tier:number,gains:number[]){
  if(!tier)return "No stat gains";
  return gains.map((gain,index)=>gain?`${["HP","ATK","DEF","SPD"][index]} +${tier===2?gain:Math.ceil(gain/2)}`:"").filter(Boolean).join(" · ");
}
