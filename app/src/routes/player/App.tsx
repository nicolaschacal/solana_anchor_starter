import { useMemo, useState } from "react";
import { NavLink, useNavigate, useSearchParams } from "react-router-dom";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import {
  Activity, Apple, Atom, BookOpen, ChevronLeft, ChevronRight, CircleUserRound,
  Dna, Heart, Home, LockKeyhole, MoonStar, Plus, ShoppingBag, Sparkles,
  WalletCards, Zap,
} from "lucide-react";
import { CreatureSprite } from "../../components/admin/CreatureSprite";
import { fullEvolutionLineage } from "../../lib/rebyters/graph";
import { sampleMammal } from "../../lib/rebyters/sample";
import type { Evolution } from "../../lib/rebyters/types";
import "./player.css";

const tree = sampleMammal();
const STAGE_NAMES = ["ORIGIN", "BYTE", "KYLO", "MEGA", "GIGA", "TERA"];

type OwnedRebyter = {
  mint: string;
  evolutionId: number;
  level: number;
  bond: number;
  hunger: number;
  activity: number;
  energy: number;
};

// Temporary collection adapter. Production will replace this body with the
// Token-2022 wallet scan. ?demo=1 exists only to preview multi-Rebyter UX.
function useOwnedRebyters(): OwnedRebyter[] {
  const wallet = useWallet();
  const [params] = useSearchParams();
  return useMemo(() => {
    if (!wallet.connected) return [];
    if (import.meta.env.DEV && params.get("demo") === "1") {
      return [
        { mint: "demo-fangbit", evolutionId: 10, level: 1, bond: 12, hunger: 72, activity: 38, energy: 84 },
        { mint: "demo-wolf", evolutionId: 41, level: 8, bond: 44, hunger: 61, activity: 77, energy: 68 },
        { mint: "demo-dire", evolutionId: 71, level: 14, bond: 70, hunger: 55, activity: 83, energy: 59 },
      ];
    }
    return [];
  }, [wallet.connected, params]);
}

function Nav() {
  return <nav className="player-nav">
    <NavLink end to="/"><Home/><span>Home</span></NavLink>
    <NavLink to="/account"><CircleUserRound/><span>Account</span></NavLink>
    <NavLink to="/lab"><Atom/><span>Lab</span></NavLink>
    <NavLink to="/atlas"><BookOpen/><span>Atlas</span></NavLink>
  </nav>;
}

function Shell({children}:{children:React.ReactNode}) {
  return <div className="player-bg"><div className="player-shell">{children}<Nav/></div></div>;
}

function Header() {
  const { connected } = useWallet();
  return <header className="player-head">
    <div><span className="player-logo">REBYTERS</span><small>digital companions</small></div>
    {connected ? <WalletMultiButton/> : <WalletMultiButton>Connect</WalletMultiButton>}
  </header>;
}

function Stat({icon,label,value}:{icon:React.ReactNode;label:string;value:string}) {
  return <div className="pet-stat"><span>{icon}</span><div><small>{label}</small><strong>{value}</strong></div></div>;
}

function RebyterPicker({
  owned,
  activeMint,
  onSelect,
}:{owned:OwnedRebyter[];activeMint:string;onSelect:(mint:string)=>void}) {
  if (owned.length < 2) return null;
  return <section className="companion-picker">
    <div><small>YOUR REBYTERS</small><strong>{owned.length} companions</strong></div>
    <div className="companion-picker-row">
      {owned.map(item=>{
        const evolution=tree.evolutions.find(e=>e.id===item.evolutionId)!;
        return <button
          key={item.mint}
          className={item.mint===activeMint?"active":""}
          onClick={()=>onSelect(item.mint)}
          title={evolution.name}
        >
          <CreatureSprite evolution={evolution}/><span>{evolution.name}</span>
        </button>;
      })}
    </div>
  </section>;
}

function EmptyCompanion() {
  const navigate=useNavigate();
  const { connected }=useWallet();
  return <main className="player-main player-home-layout empty-layout">
    <section className="empty-companion-card">
      <div className="empty-orb"><Sparkles/></div>
      <small>{connected ? "YOUR DEN IS EMPTY" : "WELCOME TO REBYTERS"}</small>
      <h1>{connected ? "Your first Rebyter is waiting." : "Connect to meet your companion."}</h1>
      <p>{connected
        ? "You don't have a Rebyter in this wallet yet. Acquire one to start feeding, playing and discovering its evolution path."
        : "Connect a wallet or, later, use passkey onboarding to access your Rebyters."}</p>
      {connected
        ? <button className="acquire-cta" onClick={()=>navigate("/acquire")}><ShoppingBag/><span><strong>Acquire your Rebyter</strong><small>Start your first evolution journey</small></span><ChevronRight/></button>
        : <WalletMultiButton>Connect wallet</WalletMultiButton>}
    </section>
    <aside className="empty-side-note"><Dna/><div><strong>One mint. Many forms.</strong><p>Your Rebyter keeps the same identity while its evolution state changes over time.</p></div></aside>
  </main>;
}

export function PlayerHome() {
  const navigate = useNavigate();
  const owned = useOwnedRebyters();
  const [activeMint,setActiveMint]=useState(owned[0]?.mint ?? "");
  const active = owned.find(x=>x.mint===activeMint) ?? owned[0];
  const evolution = tree.evolutions.find(e=>e.id===active?.evolutionId);
  const [reaction,setReaction]=useState("Your companion is watching you.");

  if (!active || !evolution) return <Shell><Header/><EmptyCompanion/></Shell>;

  return <Shell><Header/><main className="player-main player-home-layout">
    <aside className="home-side home-side-left">
      <RebyterPicker owned={owned} activeMint={active.mint} onSelect={setActiveMint}/>
      <section className="stats-section desktop-stats">
        <div className="section-title"><div><small>TODAY</small><h2>{evolution.name}'s stats</h2></div><span>Healthy</span></div>
        <div className="stats-grid">
          <Stat icon={<Apple/>} label="Hunger" value={active.hunger+"%"}/>
          <Stat icon={<Heart/>} label="Bond" value={String(active.bond)}/>
          <Stat icon={<Activity/>} label="Activity" value={String(active.activity)}/>
          <Stat icon={<Zap/>} label="Energy" value={active.energy+"%"}/>
        </div>
      </section>
    </aside>

    <section className="pet-card home-center">
      <div className="pet-card-top"><div><small>YOUR COMPANION</small><h1>{evolution.name} <span>Lv. {String(active.level).padStart(2,"0")}</span></h1></div><span className="bond-pill"><Heart size={14}/> Bond {active.bond}</span></div>
      <div className="pet-viewer">
        <div className="viewer-glow"/><CreatureSprite evolution={evolution}/>
        <span className="stage-chip">{STAGE_NAMES[evolution.stage]}</span>
        <p>{reaction}</p>
      </div>
      <div className="pet-actions">
        <button onClick={()=>setReaction(evolution.name+" loved that meal!")}><Apple/><span>Feed</span></button>
        <button onClick={()=>setReaction(evolution.name+" wants to play!")}><Sparkles/><span>Play</span></button>
        <button onClick={()=>setReaction(evolution.name+" feels cared for.")}><Heart/><span>Care</span></button>
        <button onClick={()=>setReaction(evolution.name+" is resting...")}><MoonStar/><span>Rest</span></button>
      </div>
    </section>

    <aside className="home-side home-side-right">
      <button className="evolve-cta" onClick={()=>navigate("/lab")}><Dna/><span><small>READY FOR THE NEXT STEP?</small><strong>Evolve {evolution.name}</strong></span><ChevronRight/></button>
      <button className="evolution-hint" onClick={()=>navigate("/atlas")}><span className="hint-icon"><BookOpen/></span><span><small>EVOLUTION PATH</small><strong>See discovered lineage</strong></span><ChevronRight/></button>
    </aside>

    <section className="stats-section mobile-stats">
      <div className="section-title"><div><small>TODAY</small><h2>{evolution.name}'s stats</h2></div><span>Healthy</span></div>
      <div className="stats-grid">
        <Stat icon={<Apple/>} label="Hunger" value={active.hunger+"%"}/><Stat icon={<Heart/>} label="Bond" value={String(active.bond)}/><Stat icon={<Activity/>} label="Activity" value={String(active.activity)}/><Stat icon={<Zap/>} label="Energy" value={active.energy+"%"}/>
      </div>
    </section>
    <div className="mobile-home-cta"><button className="evolve-cta" onClick={()=>navigate("/lab")}><Dna/><span><small>READY FOR THE NEXT STEP?</small><strong>Evolve {evolution.name}</strong></span><ChevronRight/></button></div>
  </main></Shell>;
}

export function PlayerLab() {
  const navigate=useNavigate();
  const owned=useOwnedRebyters();
  if (!owned.length) return <Shell><Header/><main className="player-main"><div className="player-page-head"><small>EVOLUTION LAB</small><h1>No Rebyter selected</h1><p>You need a companion before the lab can analyze an evolution path.</p></div><button className="acquire-cta" onClick={()=>navigate("/acquire")}><ShoppingBag/><span><strong>Acquire your Rebyter</strong><small>Begin with your first companion</small></span><ChevronRight/></button></main></Shell>;
  const active=owned[0];
  const evolution=tree.evolutions.find(e=>e.id===active.evolutionId)!;
  return <Shell><Header/><main className="player-main"><div className="player-page-head"><small>EVOLUTION LAB</small><h1>Potential detected</h1><p>Your choices shape what {evolution.name} becomes. Conditions stay hidden until your companion gets close to a path.</p></div>
    <section className="lab-focus"><div className="lab-creature"><CreatureSprite evolution={evolution}/></div><div><span className="stage-chip">{STAGE_NAMES[evolution.stage]}</span><h2>{evolution.name}</h2><p>{evolution.paths.length} possible evolutionary signals detected.</p></div></section>
    <div className="signal-list"><div><Dna/><span><strong>Genetics</strong><small>Natural tendency recorded</small></span><b>Stable</b></div><div><Activity/><span><strong>Activity</strong><small>Your recent behavior matters</small></span><b>Growing</b></div><div><Apple/><span><strong>Diet</strong><small>Keep discovering preferences</small></span><b>Unknown</b></div></div>
  </main></Shell>;
}

function AtlasLineage({ evolution, onBack }:{evolution:Evolution;onBack:()=>void}) {
  const lineage=fullEvolutionLineage(tree,evolution.id);
  const grouped=STAGE_NAMES.map((label,stage)=>({label,stage,items:lineage.filter(e=>e.stage===stage)})).filter(x=>x.items.length);
  return <>
    <button className="atlas-back" onClick={onBack}><ChevronLeft/> Back to atlas</button>
    <div className="player-page-head lineage-title"><small>FULL LINEAGE</small><h1>{evolution.name}</h1><p>Known ancestors and every possible descendant in this evolutionary branch.</p></div>
    <div className="player-lineage-map">
      {grouped.map((group,index)=><section key={group.stage} className="lineage-stage">
        <div className="lineage-stage-label"><small>0{group.stage+1}</small><strong>{group.label}</strong></div>
        <div className="lineage-stage-cards">
          {group.items.map(item=><div className={item.id===evolution.id?"lineage-card active":"lineage-card"} key={item.id}><CreatureSprite evolution={item}/><strong>{item.name}</strong><small>{item.family}</small></div>)}
        </div>
        {index<grouped.length-1&&<div className="lineage-arrow"><ChevronRight/></div>}
      </section>)}
    </div>
  </>;
}

export function PlayerAtlas() {
  const owned=useOwnedRebyters();
  const ownedEvolutionIds=new Set(owned.map(x=>x.evolutionId));
  const [selectedId,setSelectedId]=useState<number|null>(null);
  const stages=useMemo(()=>[0,1,2,3,4,5].map(stage=>({stage,items:tree.evolutions.filter(e=>e.stage===stage)})),[]);
  const selected=selectedId===null?undefined:tree.evolutions.find(e=>e.id===selectedId);
  if (selected) return <Shell><Header/><main className="player-main atlas-player"><AtlasLineage evolution={selected} onBack={()=>setSelectedId(null)}/></main></Shell>;
  return <Shell><Header/><main className="player-main atlas-player"><div className="player-page-head"><small>DISCOVERY ATLAS</small><h1>Mammal.exe</h1><p>Only forms your wallet has actually reached are revealed. Select one of your discovered Rebyters to inspect its complete lineage.</p></div>
    <div className="atlas-progress"><span><strong>{ownedEvolutionIds.size}</strong> / {tree.evolutions.length} discovered</span><div><i style={{width:`${ownedEvolutionIds.size/tree.evolutions.length*100}%`}}/></div></div>
    {stages.map(group=><section className="discovery-stage" key={group.stage}><h2>{STAGE_NAMES[group.stage]} <span>{group.items.filter(e=>ownedEvolutionIds.has(e.id)).length}/{group.items.length}</span></h2><div className="discovery-grid">{group.items.map(e=>{const open=ownedEvolutionIds.has(e.id); return <button disabled={!open} onClick={()=>open&&setSelectedId(e.id)} className={open?"discovery-card":"discovery-card locked"} key={e.id}>{open?<CreatureSprite evolution={e}/>:<LockKeyhole/>}<strong>{open?e.name:"???"}</strong><small>{open?"View lineage":"Undiscovered"}</small></button>})}</div></section>)}
  </main></Shell>;
}

export function PlayerAccount() {
  const owned=useOwnedRebyters();
  return <Shell><Header/><main className="player-main"><div className="player-page-head"><small>ACCOUNT</small><h1>Your den</h1><p>Wallet, identity and your Rebyters live here.</p></div><section className="account-card"><CircleUserRound/><div><small>PLAYER IDENTITY</small><strong>Wallet access</strong><p>Solana wallet support is active. Passkey onboarding can connect to this same identity layer next.</p></div><WalletMultiButton/></section><section className="account-card subtle"><Sparkles/><div><small>COLLECTION</small><strong>{owned.length} companion{owned.length===1?"":"s"}</strong><p>{owned.length?"Choose your active Rebyter from Home.":"No Rebyters found in this wallet."}</p></div></section></main></Shell>;
}

export function PlayerAcquire() {
  const navigate=useNavigate();
  return <Shell><Header/><main className="player-main acquire-page"><div className="player-page-head"><small>FIRST COMPANION</small><h1>Acquire a Rebyter</h1><p>This is the acquisition entry point. The mint flow will plug in here once the Token-2022 program is ready.</p></div><section className="acquire-preview"><div className="empty-orb"><Dna/></div><h2>Your journey starts at BIT</h2><p>One permanent mint will carry the Rebyter through every form it reaches.</p><button disabled><Plus/> Mint flow coming next</button><button className="text-back" onClick={()=>navigate("/")}><ChevronLeft/> Back home</button></section></main></Shell>;
}
