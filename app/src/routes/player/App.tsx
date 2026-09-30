import { useMemo, useState } from "react";
import { NavLink } from "react-router-dom";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { Activity, Apple, Atom, BookOpen, ChevronRight, CircleUserRound, Dna, Heart, Home, LockKeyhole, MoonStar, Sparkles, Zap } from "lucide-react";
import { CreatureSprite } from "../../components/admin/CreatureSprite";
import { sampleMammal } from "../../lib/rebyters/sample";
import "./player.css";

const tree = sampleMammal();
const fangbit = tree.evolutions.find(e => e.name === "Fangbit") ?? tree.evolutions[1];

function Nav() {
  return <nav className="player-nav">
    <NavLink to="/"><Home/><span>Home</span></NavLink>
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
  return <header className="player-head"><div><span className="player-logo">REBYTERS</span><small>digital companions</small></div>{connected ? <WalletMultiButton/> : <WalletMultiButton>Connect</WalletMultiButton>}</header>;
}

function Stat({icon,label,value}:{icon:React.ReactNode;label:string;value:string}) {
  return <div className="pet-stat"><span>{icon}</span><div><small>{label}</small><strong>{value}</strong></div></div>;
}

export function PlayerHome() {
  const [reaction,setReaction]=useState("Fangbit is curious today.");
  return <Shell><Header/><main className="player-main">
    <section className="pet-card">
      <div className="pet-card-top"><div><small>YOUR COMPANION</small><h1>Fangbit <span>Lv. 01</span></h1></div><span className="bond-pill"><Heart size={14}/> Bond 12</span></div>
      <div className="pet-viewer">
        <div className="viewer-glow"/><CreatureSprite evolution={fangbit}/>
        <span className="stage-chip">BYTE</span>
        <p>{reaction}</p>
      </div>
      <div className="pet-actions">
        <button onClick={()=>setReaction("Fangbit loved that meal!")}><Apple/><span>Feed</span></button>
        <button onClick={()=>setReaction("Fangbit wants to play!")}><Sparkles/><span>Play</span></button>
        <button onClick={()=>setReaction("Fangbit feels cared for.")}><Heart/><span>Care</span></button>
        <button onClick={()=>setReaction("Fangbit is resting...")}><MoonStar/><span>Rest</span></button>
      </div>
    </section>
    <section className="stats-section"><div className="section-title"><div><small>TODAY</small><h2>Fangbit's stats</h2></div><span>Healthy</span></div>
      <div className="stats-grid">
        <Stat icon={<Apple/>} label="Hunger" value="72%"/><Stat icon={<Heart/>} label="Bond" value="12"/><Stat icon={<Activity/>} label="Activity" value="38"/><Stat icon={<Zap/>} label="Energy" value="84%"/>
      </div>
    </section>
    <button className="evolution-hint"><span className="hint-icon"><Dna/></span><span><small>EVOLUTION PROGRESS</small><strong>Keep interacting to discover Fangbit's path</strong></span><ChevronRight/></button>
  </main></Shell>;
}

export function PlayerLab() {
 return <Shell><Header/><main className="player-main"><div className="player-page-head"><small>EVOLUTION LAB</small><h1>Potential detected</h1><p>Your choices shape what Fangbit becomes. Conditions stay hidden until your companion gets close to a path.</p></div>
 <section className="lab-focus"><div className="lab-creature"><CreatureSprite evolution={fangbit}/></div><div><span className="stage-chip">BYTE</span><h2>Fangbit</h2><p>3 possible evolutionary signals detected.</p></div></section>
 <div className="signal-list"><div><Dna/><span><strong>Genetics</strong><small>Natural tendency recorded</small></span><b>Stable</b></div><div><Activity/><span><strong>Activity</strong><small>Your recent behavior matters</small></span><b>Growing</b></div><div><Apple/><span><strong>Diet</strong><small>Keep discovering preferences</small></span><b>Unknown</b></div></div>
 </main></Shell>;
}

export function PlayerAtlas() {
 const unlocked=new Set(["mammal.exe","fangbit"]);
 const stages=useMemo(()=>[0,1,2,3,4,5].map(stage=>({stage,items:tree.evolutions.filter(e=>e.stage===stage)})),[]);
 return <Shell><Header/><main className="player-main atlas-player"><div className="player-page-head"><small>DISCOVERY ATLAS</small><h1>Mammal.exe</h1><p>Every Rebyter you discover becomes permanently visible here.</p></div>
 <div className="atlas-progress"><span><strong>2</strong> / {tree.evolutions.length} discovered</span><div><i style={{width:`${2/tree.evolutions.length*100}%`}}/></div></div>
 {stages.map(group=><section className="discovery-stage" key={group.stage}><h2>{["ORIGIN","BYTE","KYLO","MEGA","GIGA","TERA"][group.stage]} <span>{group.items.filter(e=>unlocked.has((e.key??e.name).toLowerCase())).length}/{group.items.length}</span></h2><div className="discovery-grid">{group.items.map(e=>{const key=(e.key??e.name).toLowerCase(); const open=unlocked.has(key); return <div className={open?"discovery-card":"discovery-card locked"} key={e.id}>{open?<CreatureSprite evolution={e}/>:<LockKeyhole/>}<strong>{open?e.name:"???"}</strong><small>{open?"Discovered":"Undiscovered"}</small></div>})}</div></section>)}
 </main></Shell>;
}

export function PlayerAccount() {
 return <Shell><Header/><main className="player-main"><div className="player-page-head"><small>ACCOUNT</small><h1>Your den</h1><p>Wallet, identity and your Rebyters live here.</p></div><section className="account-card"><CircleUserRound/><div><small>PLAYER IDENTITY</small><strong>Connect your wallet</strong><p>Use a Solana wallet now. Passkey onboarding can plug into this same entry point next.</p></div><WalletMultiButton/></section><section className="account-card subtle"><Sparkles/><div><small>COLLECTION</small><strong>1 active companion</strong><p>Fangbit · Mammal family · BYTE</p></div></section></main></Shell>;
}
