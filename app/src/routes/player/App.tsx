import { useMemo, useState } from "react";
import { NavLink, useNavigate, useSearchParams } from "react-router-dom";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import {
  Activity, Apple, Atom, Bird, BookOpen, Bug, ChevronLeft, ChevronRight,
  CircleUserRound, Dna, Droplets, ExternalLink, Heart, Home, LockKeyhole, MoonStar,
  Plus, Shield, ShoppingBag, Sparkles, Waves, Zap,
} from "lucide-react";
import { CreatureSprite } from "../../components/admin/CreatureSprite";
import { ThemeToggle } from "../../components/admin/ThemeToggle";
import { fullEvolutionLineage } from "../../lib/rebyters/graph";
import { sampleMammal } from "../../lib/rebyters/sample";
import type { Evolution, TreeJson } from "../../lib/rebyters/types";
import { usePlayerRebyters } from "../../hooks/usePlayerRebyters";
import "./player.css";

const fallbackTree = sampleMammal();
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

function usePlayerCollection() {
  const chain = usePlayerRebyters();
  const wallet = useWallet();
  const [params] = useSearchParams();
  const tree = chain.mammalTree ?? fallbackTree;
  let owned: OwnedRebyter[] = chain.owned.map((item) => ({
    mint: item.mint,
    evolutionId: item.evolutionId,
    level: item.stage + 1,
    bond: item.bond,
    hunger: item.hunger,
    activity: item.activity,
    energy: item.energy,
  }));
  if (import.meta.env.DEV && wallet.connected && params.get("demo") === "1" && !owned.length) {
    owned = [
      { mint: "demo-fangbit", evolutionId: tree.evolutions.find(e=>e.name==="Fangbit")?.id ?? 10, level: 1, bond: 12, hunger: 72, activity: 38, energy: 84 },
      { mint: "demo-wolf", evolutionId: tree.evolutions.find(e=>e.name==="Wolf")?.id ?? 41, level: 8, bond: 44, hunger: 61, activity: 77, energy: 68 },
      { mint: "demo-dire", evolutionId: tree.evolutions.find(e=>e.name==="Dire Wolf")?.id ?? 71, level: 14, bond: 70, hunger: 55, activity: 83, energy: 59 },
    ];
  }
  return { ...chain, tree, owned };
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
    <div className="player-head-actions">
      <ThemeToggle/>
      {connected ? <WalletMultiButton/> : <WalletMultiButton>Connect</WalletMultiButton>}
    </div>
  </header>;
}

function Stat({icon,label,value}:{icon:React.ReactNode;label:string;value:string}) {
  return <div className="pet-stat"><span>{icon}</span><div><small>{label}</small><strong>{value}</strong></div></div>;
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
  const navigate = useNavigate();
  const player = usePlayerCollection();
  const { owned, tree, loading, error } = player;
  const [activeMint,setActiveMint]=useState("");
  const [minting,setMinting]=useState(false);
  const active = owned.find(x=>x.mint===activeMint) ?? owned[0];
  const evolution = tree.evolutions.find(e=>e.id===active?.evolutionId);
  const [reaction,setReaction]=useState("Your companion is watching you.");

  if (loading && !owned.length) return <Shell><Header/><main className="player-main"><div className="player-loading"><Sparkles/><strong>Scanning your den…</strong></div></main></Shell>;
  if (!active || !evolution) return <Shell><Header/><EmptyCompanion
    creating={player.creating}
    status={player.status}
    error={player.error || error}
    onCreate={(familyId)=>{void player.create(familyId).catch(()=>undefined)}}
  /></Shell>;

  return <Shell><Header/><main className="player-main player-home-layout">
    <section className="den-toolbar">
      <div><small>YOUR DEN</small><strong>{owned.length} companion{owned.length===1?"":"s"}</strong></div>
      <button className="mint-another" onClick={()=>setMinting(true)}><Plus/><span>Mint Rebyter</span></button>
    </section>
    <aside className="home-side home-side-left">
      <RebyterPicker owned={owned} activeMint={active.mint} onSelect={setActiveMint} tree={tree}/>
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
  const { owned, tree }=usePlayerCollection();
  if (!owned.length) return <Shell><Header/><main className="player-main"><div className="player-page-head"><small>EVOLUTION LAB</small><h1>No Rebyter selected</h1><p>You need a companion before the lab can analyze an evolution path.</p></div><button className="acquire-cta" onClick={()=>navigate("/")}><ShoppingBag/><span><strong>Acquire your Rebyter</strong><small>Creation cost: 0 SOL</small></span><ChevronRight/></button></main></Shell>;
  const active=owned[0];
  const evolution=tree.evolutions.find(e=>e.id===active.evolutionId)!;
  return <Shell><Header/><main className="player-main"><div className="player-page-head"><small>EVOLUTION LAB</small><h1>Potential detected</h1><p>Your choices shape what {evolution.name} becomes. Conditions stay hidden until your companion gets close to a path.</p></div>
    <section className="lab-focus"><div className="lab-creature"><CreatureSprite evolution={evolution}/></div><div><span className="stage-chip">{STAGE_NAMES[evolution.stage]}</span><h2>{evolution.name}</h2><p>{evolution.paths.length} possible evolutionary signals detected.</p></div></section>
    <div className="signal-list"><div><Dna/><span><strong>Genetics</strong><small>Natural tendency recorded</small></span><b>Stable</b></div><div><Activity/><span><strong>Activity</strong><small>Your recent behavior matters</small></span><b>Growing</b></div><div><Apple/><span><strong>Diet</strong><small>Keep discovering preferences</small></span><b>Unknown</b></div></div>
  </main></Shell>;
}

function AtlasLineage({ evolution, onBack, tree }:{evolution:Evolution;onBack:()=>void;tree:TreeJson}) {
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
  const { owned, tree }=usePlayerCollection();
  const ownedEvolutionIds=new Set(owned.map(x=>x.evolutionId));
  const [selectedId,setSelectedId]=useState<number|null>(null);
  const stages=useMemo(()=>[0,1,2,3,4,5].map(stage=>({stage,items:tree.evolutions.filter(e=>e.stage===stage)})),[tree]);
  const selected=selectedId===null?undefined:tree.evolutions.find(e=>e.id===selectedId);
  if (selected) return <Shell><Header/><main className="player-main atlas-player"><AtlasLineage evolution={selected} onBack={()=>setSelectedId(null)} tree={tree}/></main></Shell>;
  return <Shell><Header/><main className="player-main atlas-player"><div className="player-page-head"><small>DISCOVERY ATLAS</small><h1>Mammal.exe</h1><p>Only forms your wallet has actually reached are revealed. Select one of your discovered Rebyters to inspect its complete lineage.</p></div>
    <div className="atlas-progress"><span><strong>{ownedEvolutionIds.size}</strong> / {tree.evolutions.length} discovered</span><div><i style={{width:`${ownedEvolutionIds.size/tree.evolutions.length*100}%`}}/></div></div>
    {stages.map(group=><section className="discovery-stage" key={group.stage}><h2>{STAGE_NAMES[group.stage]} <span>{group.items.filter(e=>ownedEvolutionIds.has(e.id)).length}/{group.items.length}</span></h2><div className="discovery-grid">{group.items.map(e=>{const open=ownedEvolutionIds.has(e.id); return <button disabled={!open} onClick={()=>open&&setSelectedId(e.id)} className={open?"discovery-card":"discovery-card locked"} key={e.id}>{open?<CreatureSprite evolution={e}/>:<LockKeyhole/>}<strong>{open?e.name:"???"}</strong><small>{open?"View lineage":"Undiscovered"}</small></button>})}</div></section>)}
  </main></Shell>;
}

export function PlayerAccount() {
  const { owned, tree }=usePlayerCollection();
  return <Shell><Header/><main className="player-main">
    <div className="player-page-head"><small>ACCOUNT</small><h1>Your den</h1><p>Wallet, identity and your Rebyters live here.</p></div>
    <section className="account-card"><CircleUserRound/><div><small>PLAYER IDENTITY</small><strong>Wallet access</strong><p>Solana wallet support is active. Passkey onboarding can connect to this same identity layer next.</p></div><WalletMultiButton/></section>
    <section className="account-card subtle"><Sparkles/><div><small>COLLECTION</small><strong>{owned.length} companion{owned.length===1?"":"s"}</strong><p>{owned.length?"Your on-chain Rebyters are listed below.":"No Rebyters found in this wallet."}</p></div></section>
    {owned.length>0&&<section className="onchain-companions">
      <div className="section-title"><div><small>ON-CHAIN ASSETS</small><h2>Your mints</h2></div><span>Devnet</span></div>
      {owned.map(item=>{
        const evolution=tree.evolutions.find(e=>e.id===item.evolutionId);
        return <div className="onchain-companion" key={item.mint}>
          {evolution&&<CreatureSprite evolution={evolution}/>}
          <div><strong>{evolution?.name??"Rebyter"}</strong><code>{item.mint}</code></div>
          <a href={`https://explorer.solana.com/address/${item.mint}?cluster=devnet`} target="_blank" rel="noreferrer">Explorer <ExternalLink/></a>
        </div>;
      })}
    </section>}
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
      <div><small>SELECTED ORIGIN</small><h2>Mammal BIT</h2><p>The active Mammal atlas provides the BIT name, reference image and Irys metadata URI. Your mint receives its own on-chain DNA and randomized genetic predispositions.</p></div>
      <dl><div><dt>Creation price</dt><dd>0 SOL</dd></div><div><dt>Token standard</dt><dd>Token-2022 · 1/1</dd></div><div><dt>DNA</dt><dd>Unique on-chain seed</dd></div><div><dt>Base state</dt><dd>Ready to train</dd></div></dl>
      {!wallet.connected
        ? <WalletMultiButton>Connect wallet to create</WalletMultiButton>
        : <button className="create-rebyter-cta" disabled={player.creating} onClick={()=>void create()}><Dna/><span><strong>{player.creating?"Creating Mammal…":"Create Mammal"}</strong><small>0 SOL creation price · network rent/gas still applies</small></span><ChevronRight/></button>}
      {player.status&&<div className="create-status">{player.status}</div>}
      {player.error&&<div className="create-error">{player.error}</div>}
      <button className="text-back" onClick={()=>navigate("/")}><ChevronLeft/> Back home</button>
    </section>
  </main></Shell>;
}
