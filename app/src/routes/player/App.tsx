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
  hp: number;
  atk: number;
  def: number;
  spd: number;
  timeInteractions: number[];
  totalInteractions: number;
  genes: number[];
  diet: number[];
  weight: number;
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
    hp: item.hp,
    atk: item.atk,
    def: item.def,
    spd: item.spd,
    timeInteractions: item.timeInteractions,
    totalInteractions: item.totalInteractions,
    genes: item.genes,
    diet: item.diet,
    weight: item.weight,
  }));
  if (import.meta.env.DEV && wallet.connected && params.get("demo") === "1" && !owned.length) {
    owned = [
      { mint: "demo-fangbit", evolutionId: tree.evolutions.find(e=>e.name==="Fangbit")?.id ?? 10, level: 1, bond: 12, hunger: 72, activity: 38, energy: 84, hp:120, atk:52, def:47, spd:64, timeInteractions:[1,3,2,5], totalInteractions:11, genes:[55,62,45,76,72,25,30,21,44,68,64,59,42,33], diet:[5,1,2,1], weight:13 },
      { mint: "demo-wolf", evolutionId: tree.evolutions.find(e=>e.name==="Wolf")?.id ?? 41, level: 8, bond: 44, hunger: 61, activity: 77, energy: 68, hp:156, atk:81, def:73, spd:88, timeInteractions:[2,4,8,14], totalInteractions:28, genes:[77,70,51,80,81,18,35,22,61,75,88,73,55,40], diet:[12,2,4,2], weight:18 },
      { mint: "demo-dire", evolutionId: tree.evolutions.find(e=>e.name==="Dire Wolf")?.id ?? 71, level: 14, bond: 70, hunger: 55, activity: 83, energy: 59, hp:188, atk:99, def:91, spd:76, timeInteractions:[4,6,12,21], totalInteractions:43, genes:[82,74,60,86,79,15,41,19,72,84,76,81,66,48], diet:[18,3,5,2], weight:24 },
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

function rhythmProfile(values:number[]) {
  const total=values.reduce((n,v)=>n+(v??0),0);
  if (!total) return {label:"Undetermined",detail:"Interact at different times to reveal a rhythm."};
  const [dawn=0,morning=0,afternoon=0,night=0]=values;
  const day=morning+afternoon;
  if (night/total>=.45) return {label:"Nocturnal",detail:"Most active after sunset."};
  if (day/total>=.6) return {label:"Diurnal",detail:"Most active during daylight hours."};
  if (dawn===Math.max(...values)) return {label:"Dawn-active",detail:"Often active around first light."};
  return {label:"Flexible",detail:"Activity is spread across the day."};
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
function activityProfile(value:number) {
  if(value<20) return {label:"Calm",detail:"Low play activity so far."};
  if(value<70) return {label:"Active",detail:"Regular play is shaping its development."};
  if(value<150) return {label:"Energetic",detail:"Highly active and play-driven."};
  return {label:"Hyperactive",detail:"Exceptional accumulated activity."};
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
  const [feeding,setFeeding]=useState(false);
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
          <Stat icon={<Apple/>} label="Fullness" value={active.hunger+"%"}/>
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
        <button disabled={player.interactingMint===active.mint} onClick={()=>setFeeding(true)}><Apple/><span>Feed</span></button>
        <button disabled={player.interactingMint===active.mint} onClick={()=>void player.interact(active.mint,"play").then(()=>setReaction(evolution.name+" had a great play session.")).catch(()=>undefined)}><Sparkles/><span>Play</span></button>
        <button disabled={player.interactingMint===active.mint} onClick={()=>void player.interact(active.mint,"care").then(()=>setReaction(evolution.name+" feels closer to you.")).catch(()=>undefined)}><Heart/><span>Care</span></button>
        <button disabled title="Rest will be added with recovery rules"><MoonStar/><span>Rest</span></button>
      </div>
      {player.interactingMint===active.mint&&<div className="interaction-status"><Sparkles/> Updating on-chain DNA…</div>}
      {player.error&&<div className="interaction-error">{player.error}</div>}
    </section>

    <aside className="home-side home-side-right">
      <section className="behavior-card evolution-profile">
        <div className="behavior-head"><div><small>EVOLUTION PROFILE</small><h2>{careProfile(active.bond,active.hunger,active.energy)}</h2></div><span>{active.totalInteractions} actions</span></div>
        <div className="trait-list">
          {[
            {icon:MoonStar,title:"Activity rhythm",...rhythmProfile(active.timeInteractions)},
            {icon:Apple,title:"Diet",...dietProfile(active.diet)},
            {icon:Zap,title:"Activity",...activityProfile(active.activity)},
            {icon:Shield,title:"Body",...bodyProfile(active.weight)},
          ].map(item=>{const Icon=item.icon;return <div className="trait-row" key={item.title}><span className="trait-icon"><Icon/></span><span><small>{item.title}</small><strong>{item.label}</strong><em>{item.detail}</em></span></div>})}
        </div>
      </section>
      <button className="evolve-cta" onClick={()=>navigate("/lab")}><Dna/><span><small>EVOLUTION</small><strong>Open evolution lab</strong></span><ChevronRight/></button>
      <button className="evolution-hint" onClick={()=>navigate("/atlas")}><span className="hint-icon"><BookOpen/></span><span><small>DISCOVERY</small><strong>Open atlas</strong></span><ChevronRight/></button>
    </aside>

    <section className="stats-section mobile-stats">
      <div className="section-title"><div><small>TODAY</small><h2>{evolution.name}'s stats</h2></div><span>Healthy</span></div>
      <div className="stats-grid">
        <Stat icon={<Apple/>} label="Fullness" value={active.hunger+"%"}/><Stat icon={<Heart/>} label="Bond" value={String(active.bond)}/><Stat icon={<Activity/>} label="Activity" value={String(active.activity)}/><Stat icon={<Zap/>} label="Energy" value={active.energy+"%"}/>
      </div>
    </section>
    <section className="behavior-card mobile-behavior evolution-profile">
      <div className="behavior-head"><div><small>EVOLUTION PROFILE</small><h2>{careProfile(active.bond,active.hunger,active.energy)}</h2></div><span>{active.totalInteractions} actions</span></div>
      <div className="trait-list compact">
        {[
          {icon:MoonStar,title:"Rhythm",...rhythmProfile(active.timeInteractions)},
          {icon:Apple,title:"Diet",...dietProfile(active.diet)},
          {icon:Zap,title:"Activity",...activityProfile(active.activity)},
          {icon:Shield,title:"Body",...bodyProfile(active.weight)},
        ].map(item=>{const Icon=item.icon;return <div className="trait-row" key={item.title}><span className="trait-icon"><Icon/></span><span><small>{item.title}</small><strong>{item.label}</strong></span></div>})}
      </div>
    </section>
    <div className="mobile-home-cta"><button className="evolve-cta" onClick={()=>navigate("/lab")}><Dna/><span><small>READY FOR THE NEXT STEP?</small><strong>Evolve {evolution.name}</strong></span><ChevronRight/></button></div>
    {feeding&&<div className="origin-sheet-backdrop" onClick={()=>!player.interactingMint&&setFeeding(false)}>
      <section className="origin-sheet feed-sheet" onClick={e=>e.stopPropagation()}>
        <div className="origin-sheet-head">
          <div><small>FEED</small><h2>Choose a meal</h2><p>Food preference is recorded permanently in this Rebyter's DNA.</p></div>
          <button className="origin-sheet-close" disabled={!!player.interactingMint} onClick={()=>setFeeding(false)}>×</button>
        </div>
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
  const { owned, tree }=usePlayerCollection();
  if (!owned.length) return <Shell><Header/><main className="player-main"><div className="player-page-head"><small>EVOLUTION LAB</small><h1>No Rebyter selected</h1><p>You need a companion before the lab can analyze an evolution path.</p></div><button className="acquire-cta" onClick={()=>navigate("/")}><ShoppingBag/><span><strong>Acquire your Rebyter</strong><small>Creation cost: 0 SOL</small></span><ChevronRight/></button></main></Shell>;
  const active=owned[0];
  const evolution=tree.evolutions.find(e=>e.id===active.evolutionId)!;
  return <Shell><Header/><main className="player-main"><div className="player-page-head"><small>EVOLUTION LAB</small><h1>Potential detected</h1><p>Your choices shape what {evolution.name} becomes. Conditions stay hidden until your companion gets close to a path.</p></div>
    <section className="lab-focus"><div className="lab-creature"><CreatureSprite evolution={evolution}/></div><div><span className="stage-chip">{STAGE_NAMES[evolution.stage]}</span><h2>{evolution.name}</h2><p>{evolution.paths.length} possible evolutionary signals detected.</p></div></section>
    <div className="signal-list"><div><Dna/><span><strong>Genetics</strong><small>Natural tendency recorded</small></span><b>Stable</b></div><div><Activity/><span><strong>Activity</strong><small>Your recent behavior matters</small></span><b>{active.activity}</b></div><div><Apple/><span><strong>Diet & rhythm</strong><small>{rhythmProfile(active.timeInteractions).label} · {active.totalInteractions} interactions</small></span><b>Live</b></div></div>
    <section className="combat-card">
      <div className="section-title"><div><small>CORE STATS</small><h2>Battle profile</h2></div><span>DNA</span></div>
      <div className="combat-grid">
        <div><small>HP</small><strong>{active.hp}</strong></div>
        <div><small>ATK</small><strong>{active.atk}</strong></div>
        <div><small>DEF</small><strong>{active.def}</strong></div>
        <div><small>SPD</small><strong>{active.spd}</strong></div>
      </div>
    </section>
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
  const { owned, tree }=usePlayerCollection();
  const ownedEvolutionIds=new Set(owned.map(x=>x.evolutionId));
  const [selectedId,setSelectedId]=useState<number|null>(null);
  const stages=useMemo(()=>[0,1,2,3,4,5].map(stage=>({stage,items:tree.evolutions.filter(e=>e.stage===stage)})),[tree]);
  const selected=selectedId===null?undefined:tree.evolutions.find(e=>e.id===selectedId);
  if (selected) return <Shell><Header/><main className="player-main atlas-player"><AtlasLineage evolution={selected} onBack={()=>setSelectedId(null)} tree={tree} discoveredIds={ownedEvolutionIds}/></main></Shell>;
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
      <dl><div><dt>Creation price</dt><dd>0 SOL</dd></div><div><dt>Token standard</dt><dd>Token-2022 · 1/1</dd></div><div><dt>DNA</dt><dd>Compact 62-byte DNA</dd></div><div><dt>Base state</dt><dd>Ready to train</dd></div></dl>
      {!wallet.connected
        ? <WalletMultiButton>Connect wallet to create</WalletMultiButton>
        : <button className="create-rebyter-cta" disabled={player.creating} onClick={()=>void create()}><Dna/><span><strong>{player.creating?"Creating Mammal…":"Create Mammal"}</strong><small>0 SOL creation price · network rent/gas still applies</small></span><ChevronRight/></button>}
      {player.status&&<div className="create-status">{player.status}</div>}
      {player.error&&<div className="create-error">{player.error}</div>}
      <button className="text-back" onClick={()=>navigate("/")}><ChevronLeft/> Back home</button>
    </section>
  </main></Shell>;
}
