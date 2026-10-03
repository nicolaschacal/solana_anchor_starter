import { useEffect, useMemo, useState } from "react";
import { NavLink, useNavigate, useSearchParams } from "react-router-dom";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { PublicKey } from "@solana/web3.js";
import {
  Activity, Apple, Atom, Bird, BookOpen, Bug, ChevronDown, ChevronLeft, ChevronRight,
  CircleUserRound, Dna, Droplets, ExternalLink, Heart, Home, LockKeyhole, Mountain, MoonStar,
  Plus, Shield, ShoppingBag, Sparkles, Waves, Zap,
} from "lucide-react";
import { CreatureSprite } from "../../components/admin/CreatureSprite";
import { fullEvolutionLineage } from "../../lib/rebyters/graph";
import { sampleMammal } from "../../lib/rebyters/sample";
import { GROUPS, type Evolution, type TreeJson } from "../../lib/rebyters/types";
import { conditionBounds, evaluatePath } from "../../lib/rebyters/rules";
import type { RuleCondition } from "../../lib/rebyters/rule-types";
import { usePlayerRebyters } from "../../hooks/usePlayerRebyters";
import { REBYTER_CONDITION } from "../../lib/rebyters/companions";
import "./player.css";

const fallbackTree = sampleMammal();
const STAGE_NAMES = ["ORIGIN", "BYTE", "KYLO", "MEGA", "GIGA", "TERA"];

const BALANCE_CACHE_TTL_MS = 30_000;
const balanceCache = new Map<string,{at:number,value:number}>();
const balanceInflight = new Map<string,Promise<number>>();

async function getCachedSolBalance(connection: ReturnType<typeof useConnection>["connection"], address: string) {
  const cached=balanceCache.get(address);
  if(cached&&Date.now()-cached.at<BALANCE_CACHE_TTL_MS) return cached.value;
  const pending=balanceInflight.get(address);
  if(pending) return pending;
  const promise=connection.getBalance(new PublicKey(address),"confirmed")
    .then(lamports=>{
      const value=lamports/1_000_000_000;
      balanceCache.set(address,{at:Date.now(),value});
      return value;
    })
    .finally(()=>balanceInflight.delete(address));
  balanceInflight.set(address,promise);
  return promise;
}

type OwnedRebyter = {
  mint: string;
  evolutionId: number;
  level: number;
  bond: number;
  discipline: number;
  fullness: number;
  energy: number;
  condition: number;
  hp: number;
  atk: number;
  def: number;
  spd: number;
  timeInteractions: number[];
  totalInteractions: number;
  careMistakes: number;
  diet: number[];
  weight: number;
  cycle: number;
  stageEnteredAt: number;
  learnedSkills: bigint;
};

function usePlayerCollection() {
  const chain = usePlayerRebyters();
  const wallet = useWallet();
  const [params] = useSearchParams();
  const tree = chain.mammalTree ?? fallbackTree;
  let owned: OwnedRebyter[] = chain.owned.map((item) => {
    const evolution = tree.evolutions.find(e => e.id === item.evolutionId);
    return {
      mint: item.mint,
      evolutionId: item.evolutionId,
      level: (evolution?.stage ?? 0) + 1,
      bond: item.bond,
      discipline: item.discipline,
      fullness: item.fullness,
      energy: item.energy,
      condition: item.condition,
      hp: item.hp,
      atk: item.atk,
      def: item.def,
      spd: item.spd,
      timeInteractions: item.timeInteractions,
      totalInteractions: item.totalInteractions,
      careMistakes: item.careMistakes,
      diet: item.diet,
      weight: item.weight,
      cycle: item.cycle,
      stageEnteredAt: item.stageEnteredAt,
      learnedSkills: item.learnedSkills,
    };
  });;
  if (import.meta.env.DEV && wallet.connected && params.get("demo") === "1" && !owned.length) {
    const demoNow=Math.floor(Date.now()/1000);
    owned = [
      { mint:"demo-fangbit", evolutionId:tree.evolutions.find(e=>e.name==="Fangbit")?.id??10, level:2, bond:24, discipline:18, fullness:72, energy:84, condition:0, hp:118, atk:31, def:28, spd:36, timeInteractions:[1,3,2,5], totalInteractions:11, careMistakes:0, diet:[5,1,2,1], weight:13, cycle:0, stageEnteredAt:demoNow-8*3600, learnedSkills:0n },
      { mint:"demo-wolf", evolutionId:tree.evolutions.find(e=>e.name==="Wolf")?.id??41, level:4, bond:58, discipline:64, fullness:61, energy:68, condition:0, hp:168, atk:82, def:71, spd:89, timeInteractions:[2,4,8,14], totalInteractions:78, careMistakes:1, diet:[12,2,4,2], weight:18, cycle:0, stageEnteredAt:demoNow-96*3600, learnedSkills:(1n<<3n)|(1n<<6n) },
      { mint:"demo-dire", evolutionId:tree.evolutions.find(e=>e.name==="Dire Wolf")?.id??71, level:5, bond:76, discipline:81, fullness:55, energy:59, condition:0, hp:228, atk:121, def:106, spd:116, timeInteractions:[4,6,12,21], totalInteractions:156, careMistakes:1, diet:[18,3,5,2], weight:24, cycle:0, stageEnteredAt:demoNow-180*3600, learnedSkills:(1n<<3n)|(1n<<5n)|(1n<<6n)|(1n<<7n) },
    ];
  }
  return { ...chain, tree, owned };
}

function Nav() {
  return <nav className="player-nav">
    <NavLink end to="/"><Home/><span>Home</span></NavLink>
    <NavLink to="/lab"><Atom/><span>Lab</span></NavLink>
    <NavLink to="/atlas"><BookOpen/><span>Atlas</span></NavLink>
  </nav>;
}

function Shell({children}:{children:React.ReactNode}) {
  return <div className="player-bg"><div className="player-shell">{children}<Nav/></div></div>;
}

function Header() {
  const wallet = useWallet();
  const { connection } = useConnection();
  const navigate = useNavigate();
  const [solBalance,setSolBalance]=useState<number|null>(null);

  useEffect(()=>{
    let cancelled=false;
    if(!wallet.publicKey){setSolBalance(null);return;}
    const address=wallet.publicKey.toBase58();
    void getCachedSolBalance(connection,address)
      .then(value=>{if(!cancelled)setSolBalance(value)})
      .catch(()=>{if(!cancelled)setSolBalance(null)});
    return()=>{cancelled=true};
  },[connection,wallet.publicKey]);

  const balanceLabel=solBalance===null?"SOL":`${solBalance.toLocaleString("en-US",{maximumFractionDigits:2})} SOL`;

  return <header className="player-head">
    <NavLink to="/" className="player-brand"><span className="player-logo">REBYTERS</span><small>digital companions</small></NavLink>
    <div className="player-head-actions">
      <nav className="desktop-top-nav" aria-label="Player navigation">
        <NavLink end to="/" aria-label="Home" title="Home"><Home/><span>Home</span></NavLink>
        <NavLink to="/lab" aria-label="Lab" title="Lab"><Atom/><span>Lab</span></NavLink>
        <NavLink to="/atlas" aria-label="Atlas" title="Atlas"><BookOpen/><span>Atlas</span></NavLink>
      </nav>
      {!wallet.connected
        ? <WalletMultiButton><><CircleUserRound/><span>Login</span><ChevronDown className="account-chevron"/></></WalletMultiButton>
        : <button className="user-menu-trigger account-direct-link wallet-balance-trigger" onClick={()=>navigate("/account")} aria-label="Open account">
            <CircleUserRound/><span>{balanceLabel}</span><ChevronDown className="account-chevron"/>
          </button>}
    </div>
  </header>;
}

function Stat({icon,label,value}:{icon:React.ReactNode;label:string;value:string}) {
  return <div className="pet-stat"><span>{icon}</span><div><small>{label}</small><strong>{value}</strong></div></div>;
}

function rhythmProfile(values:number[]) {
  const total=values.reduce((n,v)=>n+(v??0),0);
  if (!total) return {label:"Undetermined",detail:"Interact at different times to reveal a rhythm."};
  const [night=0,morning=0,day=0,evening=0]=values;
  if ((night+evening)/total>=.6) return {label:"Nocturnal",detail:"Most activity happens after daylight."};
  if ((morning+day)/total>=.6) return {label:"Diurnal",detail:"Most activity happens during daylight."};
  if (evening===Math.max(...values)) return {label:"Crepuscular",detail:"Activity peaks around the evening."};
  return {label:"Flexible",detail:"Activity is spread across different times."};
}
function dietProfile(values:number[]) {
  const labels=["Meat leaning","Plant leaning","Fish leaning","Fruit leaning"];
  const details=["Prefers meat-based meals.","Leans toward plants.","Shows a preference for fish.","Frequently chooses fruit."];
  const total=values.reduce((n,v)=>n+(v??0),0);
  if (!total) return {label:"Undetermined",detail:"Feed different foods to reveal a preference."};
  let best=0;
  for(let i=1;i<values.length;i++) if((values[i]??0)>(values[best]??0)) best=i;
  return {label:labels[best]??"Mixed",detail:details[best]??"Has a mixed diet."};
}
function disciplineProfile(value:number) {
  if(value<20) return "Free spirited";
  if(value<50) return "Learning routine";
  if(value<75) return "Disciplined";
  return "Highly disciplined";
}
function conditionLabels(condition:number) {
  const labels:string[]=[];
  if(condition&REBYTER_CONDITION.tired) labels.push("Tired");
  if(condition&REBYTER_CONDITION.overfed) labels.push("Overfed");
  if(condition&REBYTER_CONDITION.sick) labels.push("Sick");
  if(condition&REBYTER_CONDITION.injured) labels.push("Injured");
  return labels.length?labels:["Healthy"];
}
function moodProfile(rebyter:OwnedRebyter) {
  if(rebyter.condition&REBYTER_CONDITION.sick) return "Sick";
  if(rebyter.condition&REBYTER_CONDITION.injured) return "Hurt";
  if(rebyter.condition&REBYTER_CONDITION.overfed) return "Uncomfortable";
  if(rebyter.energy<20) return "Exhausted";
  if(rebyter.fullness<20) return "Hungry";
  const score=(rebyter.bond+rebyter.energy+rebyter.fullness)/3;
  if(score>=75) return "Happy";
  if(score>=50) return "Content";
  return "Restless";
}
const SKILL_NAMES=["Bite","Guard","Quick Step","Heavy Strike","Second Wind","Iron Guard","Dash","Battle Instinct","Adapt"];
function learnedSkillNames(bits:bigint) {
  const names:string[]=[];
  for(let index=0;index<64;index++){
    if((bits&(1n<<BigInt(index)))===0n) continue;
    names.push(SKILL_NAMES[index]??`Skill #${index}`);
  }
  return names;
}
function learnedSkillCount(bits:bigint) {
  let value=bits;
  let count=0;
  while(value>0n){ count+=Number(value&1n); value>>=1n; }
  return count;
}

function bodyProfile(weight:number) {
  if(weight<=10) return {label:"Light build",detail:"A compact, lightweight body."};
  if(weight<=18) return {label:"Medium build",detail:"Balanced body mass."};
  if(weight<=28) return {label:"Heavy build",detail:"A noticeably heavier frame."};
  return {label:"Very heavy",detail:"Exceptional body mass."};
}
function careProfile(bond:number,fullness:number,energy:number) {
  const score=(bond+fullness+energy)/3;
  if(score>=75) return "Thriving";
  if(score>=50) return "Well cared";
  if(score>=30) return "Needs attention";
  return "Neglected";
}
function evolutionState(rebyter:OwnedRebyter) {
  const state:Record<string,number>={};
  const dietTotal=Math.max(1,rebyter.diet.reduce((n,v)=>n+(v??0),0));
  state["diet.meat"]=Math.floor((rebyter.diet[0]??0)*100/dietTotal);
  state["diet.fish"]=Math.floor((rebyter.diet[2]??0)*100/dietTotal);
  state["diet.plant"]=Math.floor((rebyter.diet[1]??0)*100/dietTotal);
  state["diet.fruit"]=Math.floor((rebyter.diet[3]??0)*100/dietTotal);
  const timeTotal=Math.max(1,rebyter.timeInteractions.reduce((n,v)=>n+(v??0),0));
  state["time.night"]=Math.floor((rebyter.timeInteractions[0]??0)*100/timeTotal);
  state["time.morning"]=Math.floor((rebyter.timeInteractions[1]??0)*100/timeTotal);
  state["time.day"]=Math.floor((rebyter.timeInteractions[2]??0)*100/timeTotal);
  state["time.evening"]=Math.floor((rebyter.timeInteractions[3]??0)*100/timeTotal);
  state["physical.weight"]=rebyter.weight;
  state["care.bond"]=rebyter.bond;
  state["care.discipline"]=rebyter.discipline;
  state["care.mistakes"]=rebyter.careMistakes;
  state["state.fullness"]=rebyter.fullness;
  state["state.energy"]=rebyter.energy;
  state["progression.interactions"]=rebyter.totalInteractions;
  state["progression.cycle"]=rebyter.cycle;
  state["progression.stageAgeMinutes"]=Math.max(0,Math.floor((Date.now()/1000-rebyter.stageEnteredAt)/60));
  state["battle.hp"]=rebyter.hp;
  state["battle.attack"]=rebyter.atk;
  state["battle.defense"]=rebyter.def;
  state["battle.speed"]=rebyter.spd;
  state["state.sick"]=(rebyter.condition&REBYTER_CONDITION.sick)?1:0;
  state["state.injured"]=(rebyter.condition&REBYTER_CONDITION.injured)?1:0;
  state["skills.count"]=learnedSkillCount(rebyter.learnedSkills);
  return state;
}

function evolutionRequirementStatus(
  condition: RuleCondition,
  tree: TreeJson,
  targetStage: number,
  state: Record<string, number>,
) {
  if (!tree.balance) {
    return { passed:false, label:"Unknown requirement", detail:"" };
  }
  const balance=tree.balance;
  const values=condition.metrics.map(metric=>state[metric]);
  const value=values.every(v=>v!==undefined)
    ? values.reduce((sum,current)=>sum+(current??0),0)
    : undefined;
  const [lo,hi]=conditionBounds(condition,balance,targetStage);
  const passed=value!==undefined&&value>=lo&&value<=hi;
  const metric=condition.metrics[0];
  const plus=(condition.level==="veryHigh"?"+++":condition.level==="high"?"++":condition.level?"+":"");

  const dietLabels:Record<string,string>={
    "diet.meat":"Meat","diet.fish":"Fish","diet.plant":"Vegetables","diet.fruit":"Fruit",
  };
  const timeLabels:Record<string,string>={
    "time.night":"Nocturnal","time.morning":"Early bird","time.day":"Diurnal","time.evening":"Evening",
  };
  if(dietLabels[metric]) return {passed,label:`+${dietLabels[metric]}`,detail:""};
  if(timeLabels[metric]) return {passed,label:`+${timeLabels[metric]}`,detail:""};

  if(metric==="physical.weight"){
    const weightLabel=condition.level==="low"?"Light":condition.level==="high"?"Heavy":condition.level==="veryHigh"?"Very heavy":"Medium";
    return {passed,label:`${weightLabel} weight`,detail:""};
  }
  const statLabels:Record<string,string>={
    "battle.hp":"HP","battle.attack":"Attack","battle.defense":"Defense","battle.speed":"Speed",
  };
  if(statLabels[metric]) return {passed,label:`${statLabels[metric]} ${plus||"+"}`,detail:""};
  if(metric==="care.bond") return {passed,label:`Bond ${plus||"+"}`,detail:""};
  if(metric==="care.discipline") return {passed,label:`Discipline ${plus||"+"}`,detail:""};
  if(metric==="care.mistakes") return {passed,label:`Care mistakes ≤ ${hi}`,detail:`Current: ${value??0}`};
  if(metric==="progression.interactions") return {passed,label:`${lo}+ interactions`,detail:`Current: ${value??0}`};
  if(metric==="progression.stageAgeMinutes") return {passed,label:`${lo} min in this form`,detail:`Current: ${value??0} min`};

  const fallback=balance.metrics[metric]?.label??metric;
  return {passed,label:fallback,detail:""};
}

function RebyterPicker({
  owned, activeMint, onSelect, tree,
}:{owned:OwnedRebyter[];activeMint:string;onSelect:(mint:string)=>void;tree:TreeJson}) {
  if (owned.length < 2) return null;
  return <section className="companion-picker">
    <div><small>YOUR REBYTERS</small><strong>{owned.length} companions</strong></div>
    <div className="companion-picker-row">
      {owned.map(item=>{
        const evolution=tree.evolutions.find(e=>e.id===item.evolutionId);
        if (!evolution) return null;
        return <button key={item.mint} className={item.mint===activeMint?"active":""} onClick={()=>onSelect(item.mint)} title={evolution.name}>
          <CreatureSprite evolution={evolution}/><span>{evolution.name}</span>
        </button>;
      })}
    </div>
  </section>;
}

function EmptyCompanion({
  creating,
  status,
  error,
  onCreate,
}:{
  creating:boolean;
  status:string;
  error:string;
  onCreate:(familyId:number)=>void;
}) {
  const { connected }=useWallet();
  const [choosing,setChoosing]=useState(false);
  const families=[
    {id:0,name:"Mammal",description:"Terrestrial and aquatic mammal lineages.",icon:Shield,enabled:true},
    {id:8,name:"Amphibian",description:"Wetland and metamorphic lineages.",icon:Droplets,enabled:false},
    {id:2,name:"Avian",description:"Winged and aerial lineages.",icon:Bird,enabled:false},
    {id:3,name:"Reptile",description:"Scaled and resilient lineages.",icon:Zap,enabled:false},
  ];
  return <main className="player-main player-home-layout empty-layout">
    <section className="empty-companion-card game-empty-state">
      <div className="empty-orb"><Sparkles/></div>
      <small>{connected ? "YOUR DEN IS EMPTY" : "WELCOME TO REBYTERS"}</small>
      <h1>{connected ? "Your first companion is waiting." : "Connect to begin your journey."}</h1>
      <p>{connected
        ? "Create your first Rebyter and start shaping its evolution through your choices."
        : "Connect a wallet or, later, use passkey onboarding to access your companions."}</p>
      {connected
        ? <button className="first-companion-cta" onClick={()=>setChoosing(true)}>
            <Sparkles/>
            <span><strong>Mint your first companion</strong><small>Choose an origin family · 0 SOL creation price</small></span>
            <ChevronRight/>
          </button>
        : <WalletMultiButton>Connect wallet</WalletMultiButton>}
      {status&&<div className="create-status">{status}</div>}
      {error&&<div className="create-error">{error}</div>}
    </section>
    <aside className="empty-side-note"><Dna/><div><strong>One mint. Many forms.</strong><p>Your Rebyter keeps the same Token-2022 mint while its on-chain evolution state changes.</p></div></aside>

    {choosing&&<div className="origin-sheet-backdrop" onClick={()=>!creating&&setChoosing(false)}>
      <section className="origin-sheet" onClick={e=>e.stopPropagation()}>
        <div className="origin-sheet-head">
          <div><small>CHOOSE AN ORIGIN</small><h2>What kind of Rebyter do you want?</h2><p>Your origin determines the first BIT and its evolution atlas.</p></div>
          <button className="origin-sheet-close" disabled={creating} onClick={()=>setChoosing(false)}>×</button>
        </div>
        <div className="origin-sheet-grid">
          {families.map(item=>{const Icon=item.icon;return <button
            key={item.name}
            disabled={!item.enabled||creating}
            className={item.enabled?"origin-pick available":"origin-pick locked"}
            onClick={()=>item.enabled&&onCreate(item.id)}
          >
            <span className="origin-pick-icon"><Icon/></span>
            <span><strong>{item.name}</strong><small>{item.description}</small></span>
            {item.enabled?<b>{creating?"Minting…":"Choose"}</b>:<span className="origin-pick-lock"><LockKeyhole/> Coming soon</span>}
          </button>})}
        </div>
      </section>
    </div>}
  </main>;
}

function MintCompanionSheet({
  open,
  creating,
  status,
  error,
  onClose,
  onCreate,
}:{
  open:boolean;
  creating:boolean;
  status:string;
  error:string;
  onClose:()=>void;
  onCreate:(familyId:number)=>void;
}) {
  if (!open) return null;
  const families=[
    {id:0,name:"Mammal",description:"Terrestrial and aquatic mammal lineages.",icon:Shield,enabled:true},
    {id:8,name:"Amphibian",description:"Wetland and metamorphic lineages.",icon:Droplets,enabled:false},
    {id:2,name:"Avian",description:"Winged and aerial lineages.",icon:Bird,enabled:false},
    {id:3,name:"Reptile",description:"Scaled and resilient lineages.",icon:Zap,enabled:false},
  ];
  return <div className="origin-sheet-backdrop" onClick={()=>!creating&&onClose()}>
    <section className="origin-sheet mint-sheet" onClick={e=>e.stopPropagation()}>
      <div className="origin-sheet-head">
        <div><small>NEW COMPANION</small><h2>Mint another Rebyter</h2><p>Every Rebyter gets unique on-chain DNA. There is no one-companion limit per wallet.</p></div>
        <button className="origin-sheet-close" disabled={creating} onClick={onClose}>×</button>
      </div>
      <div className="origin-sheet-grid">
        {families.map(item=>{const Icon=item.icon;return <button
          key={item.name}
          disabled={!item.enabled||creating}
          className={item.enabled?"origin-pick available":"origin-pick locked"}
          onClick={()=>item.enabled&&onCreate(item.id)}
        >
          <span className="origin-pick-icon"><Icon/></span>
          <span><strong>{item.name}</strong><small>{item.description}</small></span>
          {item.enabled?<b>{creating?"Minting…":"Mint"}</b>:<span className="origin-pick-lock"><LockKeyhole/> Coming soon</span>}
        </button>})}
      </div>
      {status&&<div className="create-status">{status}</div>}
      {error&&<div className="create-error">{error}</div>}
    </section>
  </div>;
}

export function PlayerHome() {
  const player = usePlayerCollection();
  const { owned, tree, loading, error } = player;
  const [activeMint,setActiveMint]=useState("");
  const [minting,setMinting]=useState(false);
  const [feeding,setFeeding]=useState(false);
  const [training,setTraining]=useState(false);
  const [homeParams]=useSearchParams();
  const [denOpen,setDenOpen]=useState(homeParams.get("den")==="1");
  const [detailOpen,setDetailOpen]=useState(false);
  const [habitatOpen,setHabitatOpen]=useState(false);
  const [habitat,setHabitat]=useState(0);
  const [reaction,setReaction]=useState("Your companion is watching you.");
  const active = owned.find(x=>x.mint===activeMint) ?? owned[0];
  const evolution = tree.evolutions.find(e=>e.id===active?.evolutionId);

  async function openDen() {
    setDenOpen(true);
    if (!player.ownedLoadedAll) {
      try { await player.loadAll(); } catch { /* hook exposes error */ }
    }
  }

  const { connected } = useWallet();

  if (!connected || (loading && !owned.length)) return <Shell><Header/><main className="game-home">
    <section className="game-viewer game-viewer-empty">
      <div className="viewer-glow"/>
      {connected&&<div className="viewer-loading-indicator"><Sparkles/><span>Loading companion…</span></div>}
    </section>
  </main></Shell>;

  if (!active || !evolution) return <Shell><Header/><EmptyCompanion
    creating={player.creating}
    status={player.status}
    error={player.error || error}
    onCreate={(familyId)=>{void player.create(familyId).catch(()=>undefined)}}
  /></Shell>;

  return <Shell><Header/><main className="game-home">
    <section className={`game-viewer habitat-${habitat}`}>
      <div className="viewer-glow"/>
      <CreatureSprite evolution={evolution}/>

      <button className="monster-id gl-panel" onClick={()=>setDetailOpen(true)}>
        <strong>{evolution.name}</strong>
        <span>Level {active.level} · {STAGE_NAMES[evolution.stage].charAt(0)+STAGE_NAMES[evolution.stage].slice(1).toLowerCase()}</span>
      </button>

      <div className="monster-hud-right">
        <button className="hud-square gl-panel" onClick={()=>setHabitatOpen(true)} aria-label="Choose habitat">
          <Mountain/>
        </button>
        <button className="hud-square gl-panel" onClick={()=>void openDen()} aria-label="Open den">
          <span className="den-grid-icon"><i/><i/><i/><i/></span>
        </button>
        <div className="bond-mini gl-panel"><Heart/><strong>{active.bond}</strong></div>
      </div>

      <div className="monster-speech gl-panel">{reaction}</div>

      <div className="game-controls">
        <div className="growth-card gl-panel">
          <div><span>Growth</span><strong>Not tracked yet</strong></div>
          <div className="growth-track"><i/></div>
        </div>
        <div className="care-actions">
          <button className="gl-panel" disabled={player.interactingMint===active.mint} onClick={()=>setFeeding(true)}><Apple/><span>Feed</span></button>
          <button className="gl-panel" disabled={player.interactingMint===active.mint} onClick={()=>void player.interact(active.mint,"play").then(()=>setReaction(evolution.name+" wants to play again.")).catch(()=>undefined)}><Sparkles/><span>Play</span></button>
          <button className="gl-panel" disabled={player.interactingMint===active.mint} onClick={()=>setTraining(true)}><Activity/><span>Train</span></button>
          <button className="gl-panel" disabled={player.interactingMint===active.mint} onClick={()=>void player.interact(active.mint,"care").then(()=>setReaction(evolution.name+" feels cared for.")).catch(()=>undefined)}><Heart/><span>Care</span></button>
          <button className="gl-panel" disabled={player.interactingMint===active.mint} onClick={()=>void player.interact(active.mint,"rest").then(()=>setReaction(evolution.name+" recovered some energy.")).catch(()=>undefined)}><MoonStar/><span>Rest</span></button>
        </div>
        {player.interactingMint===active.mint&&<div className="interaction-status"><Sparkles/> Updating on-chain DNA…</div>}
        {player.error&&<div className="interaction-error">{player.error}</div>}
      </div>
    </section>

    {detailOpen&&<div className="game-sheet-backdrop" onClick={()=>setDetailOpen(false)}>
      <section className="game-sheet status-sheet" onClick={e=>e.stopPropagation()}>
        <div className="game-sheet-head"><div><small>{STAGE_NAMES[evolution.stage]}</small><h2>{evolution.name}</h2></div><button className="sheet-close-text" onClick={()=>setDetailOpen(false)}>Close</button></div>
        <div className="sheet-section-label">Personality</div>
        <div className="trait-pills">
          <span>{rhythmProfile(active.timeInteractions).label}</span>
          <span>{dietProfile(active.diet).label}</span>
          <span>{disciplineProfile(active.discipline)}</span>
          <span>{bodyProfile(active.weight).label}</span>
        </div>
        <div className="sheet-section-label">How it feels · {moodProfile(active)}</div>
        <div className="state-bars">
          <div className="status-fullness"><span>Fullness</span><i><b style={{width:`${active.fullness}%`}}/></i><strong>{active.fullness}%</strong></div>
          <div className="status-energy"><span>Energy</span><i><b style={{width:`${active.energy}%`}}/></i><strong>{active.energy}%</strong></div>
          <div className="status-bond"><span>Bond</span><i><b style={{width:`${Math.min(active.bond,100)}%`}}/></i><strong>{active.bond}</strong></div>
          <div className="status-discipline"><span>Discipline</span><i><b style={{width:`${Math.min(active.discipline,100)}%`}}/></i><strong>{active.discipline}</strong></div>
        </div>
        <div className="sheet-section-label">Condition</div>
        <div className="trait-pills condition-pills">{conditionLabels(active.condition).map(label=><span key={label}>{label}</span>)}</div>
        <div className="sheet-section-label">Learned skills</div>
        <div className="trait-pills skill-pills">{learnedSkillNames(active.learnedSkills).length?learnedSkillNames(active.learnedSkills).map(name=><span key={name}>{name}</span>):<span>None yet</span>}</div>
        <div className="sheet-section-label">Core stats</div>
        <div className="sheet-stat-grid">
          <div className="stat-hp"><small>HP</small><strong>{active.hp}</strong></div><div className="stat-atk"><small>ATK</small><strong>{active.atk}</strong></div>
          <div className="stat-def"><small>DEF</small><strong>{active.def}</strong></div><div className="stat-spd"><small>SPD</small><strong>{active.spd}</strong></div>
        </div>
      </section>
    </div>}

    {habitatOpen&&<div className="game-sheet-backdrop" onClick={()=>setHabitatOpen(false)}>
      <section className="game-sheet habitat-sheet" onClick={e=>e.stopPropagation()}>
        <div className="game-sheet-head"><div><small>ENVIRONMENT</small><h2>Habitats</h2></div><button className="sheet-close-text" onClick={()=>setHabitatOpen(false)}>Close</button></div>
        <div className="habitat-rail">
          {[
            ["Verdant Meadow","Equipped"],
            ["Moonlit Ruins","Owned"],
            ["Crystal Cavern","Locked"],
            ["Golden Dunes","Locked"],
          ].map(([name,state],index)=><button
            key={name}
            className={`habitat-card habitat-tone-${index}${habitat===index?" selected":""}`}
            disabled={state==="Locked"}
            onClick={()=>{setHabitat(index);setReaction(`${name} selected.`)}}
          >
            <span className="habitat-preview"><Mountain/></span>
            <strong>{name}</strong>
            <small>{habitat===index?"Equipped":state}</small>
          </button>)}
        </div>
        <button className="habitat-action" disabled>Environment selection is visual for now</button>
      </section>
    </div>}

    {denOpen&&<div className="game-sheet-backdrop" onClick={()=>setDenOpen(false)}>
      <section className="game-sheet den-sheet" onClick={e=>e.stopPropagation()}>
        <div className="game-sheet-head"><div><small>YOUR COLLECTION</small><h2>Your den</h2></div><button className="sheet-close-text" onClick={()=>setDenOpen(false)}>Close</button></div>
        {player.loading&&!player.ownedLoadedAll?<div className="den-loading"><Sparkles/> Loading companions…</div>:<div className="den-grid">
          {owned.map((item,index)=>{
            const form=tree.evolutions.find(e=>e.id===item.evolutionId);
            if(!form) return null;
            const mintLabel=`${item.mint.slice(0,4)}…${item.mint.slice(-4)}`;
            return <article key={item.mint} className={`den-card tone-${index%4}${item.mint===active.mint?" active":""}`}>
              <button className="den-card-select" onClick={()=>{setActiveMint(item.mint);setDenOpen(false)}}>
                <div className="den-card-art"><CreatureSprite evolution={form}/></div>
                <strong>{form.name}</strong>
                <small>{STAGE_NAMES[form.stage]}</small>
              </button>
              <a className="den-mint-link" href={`https://explorer.solana.com/address/${item.mint}?cluster=devnet`} target="_blank" rel="noreferrer" title={item.mint}>
                {mintLabel}<ExternalLink/>
              </a>
            </article>;
          })}
        </div>}
        <button className="den-mint-cta compact" onClick={()=>{setDenOpen(false);setMinting(true)}}><Plus/><strong>Mint new Rebyter</strong><ChevronRight/></button>
      </section>
    </div>}

    {training&&<div className="game-sheet-backdrop" onClick={()=>!player.interactingMint&&setTraining(false)}>
      <section className="game-sheet training-sheet" onClick={e=>e.stopPropagation()}>
        <div className="game-sheet-head"><div><small>TRAINING</small><h2>Choose a machine</h2></div><button className="sheet-close-text" disabled={!!player.interactingMint} onClick={()=>setTraining(false)}>Close</button></div>
        <p className="training-intro">There is no cooldown. Training while exhausted reduces gains and can make your Rebyter tired, sick or injured.</p>
        <div className="training-grid">
          <button disabled={!!player.interactingMint} onClick={()=>void player.interact(active.mint,"train",0).then(()=>{setReaction(evolution.name+" completed Power training.");setTraining(false)}).catch(()=>undefined)}><span className="training-icon"><Zap/></span><span><strong>Power</strong><small>ATK +++ · HP +</small><em>Energy −22 · Weight −1</em></span><ChevronRight/></button>
          <button disabled={!!player.interactingMint} onClick={()=>void player.interact(active.mint,"train",1).then(()=>{setReaction(evolution.name+" completed Endurance training.");setTraining(false)}).catch(()=>undefined)}><span className="training-icon"><Heart/></span><span><strong>Endurance</strong><small>HP +++ · SPD +</small><em>Energy −24 · Weight −2</em></span><ChevronRight/></button>
          <button disabled={!!player.interactingMint} onClick={()=>void player.interact(active.mint,"train",2).then(()=>{setReaction(evolution.name+" completed Defense training.");setTraining(false)}).catch(()=>undefined)}><span className="training-icon"><Shield/></span><span><strong>Defense</strong><small>DEF +++ · HP +</small><em>Energy −18</em></span><ChevronRight/></button>
          <button disabled={!!player.interactingMint} onClick={()=>void player.interact(active.mint,"train",3).then(()=>{setReaction(evolution.name+" completed Speed training.");setTraining(false)}).catch(()=>undefined)}><span className="training-icon"><Sparkles/></span><span><strong>Speed</strong><small>SPD +++ · ATK +</small><em>Energy −22 · Weight −2</em></span><ChevronRight/></button>
          <button disabled={!!player.interactingMint} onClick={()=>void player.interact(active.mint,"train",4).then(()=>{setReaction(evolution.name+" completed Combat training.");setTraining(false)}).catch(()=>undefined)}><span className="training-icon"><Dna/></span><span><strong>Combat</strong><small>ATK ++ · DEF + · SPD +</small><em>Energy −25 · Discipline ++</em></span><ChevronRight/></button>
          <button disabled={!!player.interactingMint} onClick={()=>void player.interact(active.mint,"train",5).then(()=>{setReaction(evolution.name+" completed Balanced training.");setTraining(false)}).catch(()=>undefined)}><span className="training-icon"><Activity/></span><span><strong>Balanced</strong><small>HP + · ATK + · DEF + · SPD +</small><em>Energy −16 · Discipline +</em></span><ChevronRight/></button>
        </div>
      </section>
    </div>}

    {feeding&&<div className="game-sheet-backdrop" onClick={()=>!player.interactingMint&&setFeeding(false)}>
      <section className="game-sheet food-sheet" onClick={e=>e.stopPropagation()}>
        <div className="game-sheet-head"><div><small>FEED</small><h2>Choose a meal</h2></div><button className="sheet-close-text" disabled={!!player.interactingMint} onClick={()=>setFeeding(false)}>Close</button></div>
        <div className="food-grid">
          {[
            ["Meat","Builds carnivore history",0],
            ["Plants","Builds herbivore history",1],
            ["Fish","Builds piscivore history",2],
            ["Fruit","Builds frugivore history",3],
          ].map(([name,desc,id])=><button key={String(name)} disabled={!!player.interactingMint} onClick={()=>void player.interact(active.mint,"feed",Number(id)).then(()=>{setReaction(evolution.name+" enjoyed the meal.");setFeeding(false)}).catch(()=>undefined)}>
            <Apple/><span><strong>{String(name)}</strong><small>{String(desc)}</small></span>
          </button>)}
        </div>
        {player.status&&<div className="create-status">{player.status}</div>}
        {player.error&&<div className="create-error">{player.error}</div>}
      </section>
    </div>}

    <MintCompanionSheet
      open={minting}
      creating={player.creating}
      status={player.status}
      error={player.error}
      onClose={()=>setMinting(false)}
      onCreate={(familyId)=>{void player.create(familyId).then(()=>setMinting(false)).catch(()=>undefined)}}
    />
  </main></Shell>;
}

export function PlayerLab() {
  const navigate=useNavigate();
  const { connected }=useWallet();
  const player=usePlayerCollection();
  const { owned, tree, ownedLoadedAll, loadAll, playerProfile }=player;
  useEffect(()=>{ if(connected&&!ownedLoadedAll) void loadAll().catch(()=>undefined); },[connected,ownedLoadedAll,loadAll]);
  const [activeMint,setActiveMint]=useState("");
  const active=owned.find(x=>x.mint===activeMint)??owned[0];
  if (!active) return <Shell><Header/><main className="player-main lab-empty-screen">
    <div className="player-page-head"><small>EVOLUTION LAB</small><h1>No Rebyter selected</h1><p>{connected?"Mint a companion before the Lab can evaluate evolution routes.":"Login to analyze the evolution routes of your companions."}</p></div>
    <div className="lab-empty-spacer"/>
    {connected
      ? <button className="lab-bottom-cta" onClick={()=>navigate("/")}><ShoppingBag/><span><strong>Mint a Rebyter</strong><small>Start from the Home viewer</small></span><ChevronRight/></button>
      : <WalletMultiButton><><CircleUserRound/> Login <ChevronDown/></></WalletMultiButton>}
  </main></Shell>;
  const evolution=tree.evolutions.find(e=>e.id===active.evolutionId);
  if(!evolution) return <Shell><Header/><main className="player-main"><div className="create-error">Current evolution is missing from the active atlas.</div></main></Shell>;
  const state=evolutionState(active);
  const candidates=evolution.paths.map(path=>{
    const target=tree.evolutions.find(e=>e.id===path.target);
    if(!target||!path.rule||tree.schema!==2||!tree.balance) return null;
    const result=evaluatePath(tree,path,state);
    const requirements=path.rule.mandatory.map(condition=>
      evolutionRequirementStatus(condition,tree,target.stage,state)
    );
    return {path,target,result,requirements};
  }).filter(Boolean) as {
    path:any;
    target:Evolution;
    result:ReturnType<typeof evaluatePath>;
    requirements:ReturnType<typeof evolutionRequirementStatus>[];
  }[];
  const eligible=candidates.filter(c=>c.result.eligible);
  const discoveredIds=new Set([...(playerProfile?.discoveries??[]),...owned.map(x=>x.evolutionId)]);
  return <Shell><Header/><main className="player-main evolution-player">
    <div className="player-page-head"><small>EVOLUTION LAB</small><h1>Available evolutions</h1><p>{eligible.length?"Choose among the verified routes currently unlocked for this Rebyter.":"No route is unlocked yet. Keep shaping its training, diet, routine, care and body."}</p></div>
    <RebyterPicker owned={owned} activeMint={active.mint} onSelect={setActiveMint} tree={tree}/>
    <section className="evolution-options">
      <div className="section-title"><div><small>NEXT STAGE</small><h2>{eligible.length?"Available evolutions":"No route unlocked yet"}</h2></div><span>{eligible.length}/{candidates.length}</span></div>
      {candidates.map(({target,result,requirements})=>{
        const known=discoveredIds.has(target.id);
        const left=requirements.filter(item=>!item.passed).length;
        return <article className={result.eligible?"evolution-option unlocked":"evolution-option"} key={target.id}>
          <div className="evolution-option-top">
            <div className="evolution-option-art">{known?<CreatureSprite evolution={target}/>:<LockKeyhole/>}</div>
            <div className="evolution-option-copy">
              <small>{result.eligible?"ROUTE UNLOCKED":"EVOLUTION SIGNAL"}</small>
              <strong>{known?target.name:"Unknown form"}</strong>
              <p>{result.eligible?"Ready to evolve.":left===1?"1 requirement left.":`${left} requirements left.`}</p>
            </div>
            <div className={result.eligible?"route-readiness ready":"route-readiness"}>
              <strong>{result.eligible?"READY":`${left} LEFT`}</strong>
              <small>{requirements.length-left}/{requirements.length} complete</small>
            </div>
          </div>

          <section className="requirement-block evolution-simple-requirements">
            <div className="requirement-block-head">
              <strong>Requirements to evolve</strong>
              <span>{requirements.length-left}/{requirements.length}</span>
            </div>
            <div className="requirement-list">
              {requirements.map((item,index)=><div className={item.passed?"requirement-row passed":"requirement-row"} key={`${target.id}-requirement-${index}`}>
                <i>{item.passed?"✓":"×"}</i>
                <span><strong>{item.label}</strong>{item.detail&&<small>{item.detail}</small>}</span>
              </div>)}
            </div>
          </section>

          {result.eligible?<button className="evolve-route-button" disabled={!!player.interactingMint} onClick={()=>void player.evolve(active.mint,evolution.id,target.id,tree).catch(()=>undefined)}>{player.interactingMint===active.mint?"Evolving…":known?"Evolve":"Evolve mystery"}<ChevronRight/></button>:<span className="route-lock"><LockKeyhole/> Complete the missing requirements</span>}
        </article>
      })}
      {!candidates.length&&<div className="evolution-empty"><Dna/><strong>This form has no outgoing evolution routes.</strong><p>It may be a valid final form for this life.</p></div>}
    </section>
    {player.status&&<div className="create-status">{player.status}</div>}
    {player.error&&<div className="create-error">{player.error}</div>}

  </main></Shell>;
}

function AtlasLineage({ evolution, onBack, tree, discoveredIds }:{evolution:Evolution;onBack:()=>void;tree:TreeJson;discoveredIds:Set<number>}) {
  const lineage=fullEvolutionLineage(tree,evolution.id);
  const grouped=STAGE_NAMES.map((label,stage)=>({label,stage,items:lineage.filter(e=>e.stage===stage)})).filter(x=>x.items.length);
  return <>
    <button className="atlas-back" onClick={onBack}><ChevronLeft/> Back to atlas</button>
    <div className="player-page-head lineage-title"><small>FULL LINEAGE</small><h1>{evolution.name}</h1><p>Your discovered branch stays visible. Unknown forms remain hidden until one of your Rebyters actually reaches them.</p></div>
    <div className="player-lineage-map">
      {grouped.map((group,index)=><section key={group.stage} className="lineage-stage">
        <div className="lineage-stage-label"><small>0{group.stage+1}</small><strong>{group.label}</strong></div>
        <div className="lineage-stage-cards">
          {group.items.map(item=>{const open=discoveredIds.has(item.id);return <div className={`lineage-card${item.id===evolution.id?" active":""}${open?"":" locked"}`} key={item.id}>{open?<CreatureSprite evolution={item}/>:<LockKeyhole/>}<strong>{open?item.name:"???"}</strong><small>{open?item.family:"Undiscovered"}</small></div>})}
        </div>
        {index<grouped.length-1&&<div className="lineage-arrow"><ChevronRight/></div>}
      </section>)}
    </div>
  </>;
}

export function PlayerAtlas() {
  const { owned, tree, playerProfile }=usePlayerCollection();
  const ownedEvolutionIds=new Set([
    ...(playerProfile?.discoveries ?? []),
    ...owned.map(x=>x.evolutionId),
  ]);
  const [selectedId,setSelectedId]=useState<number|null>(null);
  const stages=useMemo(()=>[0,1,2,3,4,5].map(stage=>({stage,items:tree.evolutions.filter(e=>e.stage===stage)})),[tree]);
  const selected=selectedId===null?undefined:tree.evolutions.find(e=>e.id===selectedId);
  if (selected) return <Shell><Header/><main className="player-main atlas-player"><AtlasLineage evolution={selected} onBack={()=>setSelectedId(null)} tree={tree} discoveredIds={ownedEvolutionIds}/></main></Shell>;
  return <Shell><Header/><main className="player-main atlas-player">
    <div className="atlas-family-tabs" aria-label="Evolution families">
      <button className="active"><Shield/><span><strong>Mammal</strong><small>Active atlas</small></span></button>
      <button disabled><Droplets/><span><strong>Amphibian</strong><small>Locked</small></span><LockKeyhole/></button>
      <button disabled><Bird/><span><strong>Avian</strong><small>Locked</small></span><LockKeyhole/></button>
      <button disabled><Zap/><span><strong>Reptile</strong><small>Locked</small></span><LockKeyhole/></button>
    </div>
    <div className="player-page-head"><small>DISCOVERY ATLAS</small><h1>Mammal.exe</h1><p>Every form your trainer has ever reached stays revealed here, even after that Rebyter evolves again.</p></div>
    <div className="atlas-progress"><span><strong>{ownedEvolutionIds.size}</strong> / {tree.evolutions.length} discovered</span><div><i style={{width:`${ownedEvolutionIds.size/tree.evolutions.length*100}%`}}/></div></div>
    {stages.map(group=><section className="discovery-stage" key={group.stage}><h2>{STAGE_NAMES[group.stage]} <span>{group.items.filter(e=>ownedEvolutionIds.has(e.id)).length}/{group.items.length}</span></h2><div className="discovery-grid">{group.items.map(e=>{const open=ownedEvolutionIds.has(e.id); return <button disabled={!open} onClick={()=>open&&setSelectedId(e.id)} className={open?"discovery-card":"discovery-card locked"} key={e.id}>{open?<CreatureSprite evolution={e}/>:<LockKeyhole/>}<strong>{open?e.name:"???"}</strong><small>{open?"View lineage":"Undiscovered"}</small></button>})}</div></section>)}
  </main></Shell>;
}

export function PlayerAccount() {
  const player=usePlayerCollection();
  const wallet=useWallet();
  const navigate=useNavigate();
  const { owned, playerProfile, ownedLoadedAll, loadAll }=player;
  const shortAddress=wallet.publicKey?`${wallet.publicKey.toBase58().slice(0,6)}…${wallet.publicKey.toBase58().slice(-6)}`:"";
  useEffect(()=>{ if(!ownedLoadedAll) void loadAll().catch(()=>undefined); },[ownedLoadedAll,loadAll]);

  async function logOut() {
    await wallet.disconnect();
    navigate("/");
  }

  return <Shell><Header/><main className="player-main account-page">
    <div className="player-page-head"><small>ACCOUNT</small><h1>Your den</h1><p>Wallet, discovery history and your Rebyters live here.</p></div>

    <section className="account-card"><CircleUserRound/><div><small>PLAYER IDENTITY</small><strong>Wallet access</strong><p>Your wallet is the identity behind this persistent player profile.</p></div>
      {wallet.connected
        ? <div className="account-wallet-id"><small>CONNECTED WALLET</small><code>{shortAddress}</code></div>
        : <WalletMultiButton><><CircleUserRound/> Login</></WalletMultiButton>}
    </section>

    <div className="account-nav-grid">
      <button className="trainer-profile-card account-nav-card" onClick={()=>navigate("/atlas")}>
        <div className="trainer-profile-head"><span><Sparkles/></span><div><small>PLAYER PROFILE</small><h2>{playerProfile?.discoveries.length??0} discovered</h2><p>Open your Atlas and review every form you have discovered.</p></div><ChevronRight/></div>
      </button>
      <button className="account-card subtle account-nav-card" onClick={()=>navigate("/?den=1")}>
        <Sparkles/><div><small>COLLECTION</small><strong>{owned.length} companion{owned.length===1?"":"s"}</strong><p>Open your Den and switch between your Rebyters.</p></div><ChevronRight/>
      </button>
    </div>

    {wallet.connected&&<div className="account-logout">
      <button onClick={()=>void logOut()}>Log out</button>
    </div>}
  </main></Shell>;
}

const ORIGIN_FAMILIES = [
  { id:0, name:"Mammal", description:"Warm-blooded terrestrial and aquatic lineages.", icon:Shield, enabled:true },
  { id:8, name:"Amphibian", description:"Adaptive wetland and metamorphic lineages.", icon:Droplets, enabled:false },
  { id:2, name:"Avian", description:"Winged, aerial and high-mobility lineages.", icon:Bird, enabled:false },
  { id:3, name:"Reptile", description:"Scaled, resilient and ancient lineages.", icon:Zap, enabled:false },
  { id:1, name:"Aquatic", description:"Oceanic and deep-water lineages.", icon:Waves, enabled:false },
  { id:4, name:"Insect", description:"Compact, specialized and swarm lineages.", icon:Bug, enabled:false },
];

export function PlayerAcquire() {
  const navigate=useNavigate();
  const wallet=useWallet();
  const player=usePlayerRebyters();
  const [family,setFamily]=useState(0);

  async function create() {
    try {
      await player.create(family);
      navigate("/");
    } catch {
      // Hook exposes the useful message in the UI.
    }
  }

  return <Shell><Header/><main className="player-main acquire-page">
    <div className="player-page-head"><small>FIRST COMPANION</small><h1>Choose an origin</h1><p>Your origin family defines the first BIT and the atlas used to initialize its visual identity. More families will open later.</p></div>
    <div className="origin-grid">
      {ORIGIN_FAMILIES.map(item=>{const Icon=item.icon;return <button key={item.name} disabled={!item.enabled} className={family===item.id&&item.enabled?"origin-card selected":"origin-card"} onClick={()=>item.enabled&&setFamily(item.id)}>
        <span className="origin-icon"><Icon/></span>
        <span><strong>{item.name}</strong><small>{item.description}</small></span>
        {!item.enabled?<span className="origin-lock"><LockKeyhole/> Locked</span>:<span className="origin-ready">Available</span>}
      </button>})}
    </div>
    <section className="create-summary">
      <div><small>SELECTED ORIGIN</small><h2>Mammal BIT</h2><p>The active Mammal atlas provides the BIT name, reference image and Irys metadata URI. Your mint receives its own compact on-chain gameplay state.</p></div>
      <dl><div><dt>Creation price</dt><dd>0 SOL</dd></div><div><dt>Token standard</dt><dd>Token-2022 · 1/1</dd></div><div><dt>DNA</dt><dd>Compact 57-byte DNA v4</dd></div><div><dt>Base state</dt><dd>Ready to train</dd></div></dl>
      {!wallet.connected
        ? <WalletMultiButton>Connect wallet to create</WalletMultiButton>
        : <button className="create-rebyter-cta" disabled={player.creating} onClick={()=>void create()}><Dna/><span><strong>{player.creating?"Creating Mammal…":"Create Mammal"}</strong><small>0 SOL creation price · network rent/gas still applies</small></span><ChevronRight/></button>}
      {player.status&&<div className="create-status">{player.status}</div>}
      {player.error&&<div className="create-error">{player.error}</div>}
      <button className="text-back" onClick={()=>navigate("/")}><ChevronLeft/> Back home</button>
    </section>
  </main></Shell>;
}
