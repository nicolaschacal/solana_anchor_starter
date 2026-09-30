import { useEffect, useMemo, useRef, useState } from "react";
import { Download, RotateCcw, Save, Sparkles } from "lucide-react";

type Recipe = {
  schemaVersion: 1;
  engineVersion: "design-lab-mvp-1";
  speciesId: "fangbit";
  name: string;
  stage: "BYTE";
  palette: { primary: string; secondary: string; dark: string };
  proportions: { body: number; head: number; legs: number; tail: number; eyeSpacing: number };
  personality: { bounce: number; headBob: number; tailWag: number; blinkRate: number };
  bodyPlan: "baby" | "quadruped" | "aquatic" | "biped";
};

const DEFAULT: Recipe = {
  schemaVersion: 1,
  engineVersion: "design-lab-mvp-1",
  speciesId: "fangbit",
  name: "Fangbit",
  stage: "BYTE",
  palette: { primary: "#F28A62", secondary: "#FFE08A", dark: "#29304A" },
  proportions: { body: 1, head: 1, legs: 1, tail: 1, eyeSpacing: 1 },
  personality: { bounce: 0.12, headBob: 0.08, tailWag: 0.16, blinkRate: 3.4 },
  bodyPlan: "baby",
};

type V3 = [number, number, number];
type Face = { p: V3[]; color: string };

const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
const shade=(hex:string, amount:number)=>{
  const n=parseInt(hex.slice(1),16), r=clamp((n>>16)+amount,0,255), g=clamp(((n>>8)&255)+amount,0,255), b=clamp((n&255)+amount,0,255);
  return "#"+((1<<24)+(r<<16)+(g<<8)+b).toString(16).slice(1);
};

function ellipsoid(c:V3, s:V3, color:string, seg=8, rings=5):Face[]{
  const rows:V3[][]=[];
  for(let y=0;y<=rings;y++){
    const v=y/rings, phi=-Math.PI/2+v*Math.PI, row:V3[]=[];
    for(let x=0;x<seg;x++){
      const th=x/seg*Math.PI*2;
      row.push([c[0]+Math.cos(phi)*Math.cos(th)*s[0],c[1]+Math.sin(phi)*s[1],c[2]+Math.cos(phi)*Math.sin(th)*s[2]]);
    }
    rows.push(row);
  }
  const faces:Face[]=[];
  for(let y=0;y<rings;y++) for(let x=0;x<seg;x++){
    const nx=(x+1)%seg, light=Math.round(18*Math.cos(x/seg*Math.PI*2)-8*(y/rings));
    faces.push({p:[rows[y][x],rows[y][nx],rows[y+1][nx],rows[y+1][x]],color:shade(color,light)});
  }
  return faces;
}
function prism(a:V3,b:V3,r:number,color:string):Face[]{
  const faces:Face[]=[]; const seg=5; const axis:[number,number,number]=[b[0]-a[0],b[1]-a[1],b[2]-a[2]];
  const len=Math.hypot(...axis)||1, u:V3=[axis[0]/len,axis[1]/len,axis[2]/len];
  let side:V3=Math.abs(u[1])<.9?[0,1,0]:[1,0,0];
  const cross=(x:V3,y:V3):V3=>[x[1]*y[2]-x[2]*y[1],x[2]*y[0]-x[0]*y[2],x[0]*y[1]-x[1]*y[0]];
  let v=cross(u,side), vl=Math.hypot(...v)||1; v=[v[0]/vl,v[1]/vl,v[2]/vl]; const w=cross(u,v);
  const ring=(c:V3)=>Array.from({length:seg},(_,i)=>{const q=i/seg*Math.PI*2;return [c[0]+r*(v[0]*Math.cos(q)+w[0]*Math.sin(q)),c[1]+r*(v[1]*Math.cos(q)+w[1]*Math.sin(q)),c[2]+r*(v[2]*Math.cos(q)+w[2]*Math.sin(q))] as V3});
  const ra=ring(a),rb=ring(b);
  for(let i=0;i<seg;i++) faces.push({p:[ra[i],ra[(i+1)%seg],rb[(i+1)%seg],rb[i]],color:shade(color,(i-2)*7)});
  faces.push({p:rb,color:shade(color,15)}); return faces;
}

function FangbitCanvas({recipe, paused}:{recipe:Recipe;paused:boolean}){
  const ref=useRef<HTMLCanvasElement>(null), drag=useRef<{x:number;yaw:number}|null>(null), yaw=useRef(-.42), zoom=useRef(1.42);
  useEffect(()=>{
    let raf=0, start=performance.now();
    const draw=(now:number)=>{
      const canvas=ref.current;if(!canvas)return;
      const dpr=Math.min(devicePixelRatio,2), rect=canvas.getBoundingClientRect();
      if(canvas.width!==Math.round(rect.width*dpr)||canvas.height!==Math.round(rect.height*dpr)){canvas.width=Math.round(rect.width*dpr);canvas.height=Math.round(rect.height*dpr)}
      const ctx=canvas.getContext("2d")!;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,rect.width,rect.height);
      const t=paused?0:(now-start)/1000, bob=Math.sin(t*2.2)*recipe.personality.bounce;
      const headBob=Math.sin(t*1.7)*recipe.personality.headBob, blinkPhase=t%recipe.personality.blinkRate, blink=blinkPhase<.13?0.12:1;
      let faces:Face[]=[];
      // FANGBIT / BYTE — bespoke colorful low-poly hatchling.
      // The design keeps the BYTE simplicity while giving it a recognizable toy-like silhouette.
      const pulse=1+Math.sin(t*2.15)*.018;
      const coral=recipe.palette.primary, cream=recipe.palette.secondary, ink=recipe.palette.dark;
      const peach=shade(coral,22), deep=shade(coral,-30), gold="#F4B84B", blush="#F6A6A0";
      // dominant bean/egg mass
      faces.push(...ellipsoid([0,.08+bob,0],[.91*pulse,1.01*pulse,.84*pulse],coral,10,6));
      // warm belly/face mask breaks the generic single-color blob
      faces.push(...ellipsoid([0,-.10+bob,.64],[.63,.67,.29],peach,8,5));
      // side cheek patches
      faces.push(...ellipsoid([-.53,.02+bob,.66],[.20,.19,.09],blush,6,3));
      faces.push(...ellipsoid([.53,.02+bob,.66],[.20,.19,.09],blush,6,3));
      const es=.275*recipe.proportions.eyeSpacing;
      // oversized dark eyes with cream glints
      faces.push(...ellipsoid([-es,.35+bob,.805],[.18,.235*blink,.055],ink,7,3));
      faces.push(...ellipsoid([es,.35+bob,.805],[.18,.235*blink,.055],ink,7,3));
      if(blink>.5){
        faces.push(...ellipsoid([-es-.045,.425+bob,.856],[.046,.058,.014],cream,5,2));
        faces.push(...ellipsoid([es-.045,.425+bob,.856],[.046,.058,.014],cream,5,2));
      }
      // small central nose
      faces.push(...ellipsoid([0,.08+bob,.915],[.105,.075,.045],ink,5,2));
      // signature ivory fangs
      faces.push(...prism([-.19,-.05+bob,.86],[-.18,-.35+bob,.91],.066,cream));
      faces.push(...prism([.19,-.05+bob,.86],[.18,-.35+bob,.91],.066,cream));
      // oversized golden feet give the hatchling a playful PSX-era mascot proportion
      faces.push(...ellipsoid([-.39,-.88+bob,.23],[.32,.17,.39],gold,7,3));
      faces.push(...ellipsoid([.39,-.88+bob,.23],[.32,.17,.39],gold,7,3));
      // three short dorsal fins/spikes: Fangbit's silhouette signature
      faces.push(...prism([-.30,.84+bob,-.12],[-.42,1.18+bob,-.20],.105,deep));
      faces.push(...prism([0,.99+bob,-.18],[0,1.30+bob,-.26],.115,gold));
      faces.push(...prism([.30,.84+bob,-.12],[.42,1.18+bob,-.20],.105,deep));
      // tiny side arms/fins make the idle silhouette friendlier
      const armWave=Math.sin(t*2.6)*.06;
      faces.push(...prism([-.72,.02+bob,.04],[-1.00,.13+bob+armWave,.20],.105,peach));
      faces.push(...prism([.72,.02+bob,.04],[1.00,.13+bob-armWave,.20],.105,peach));
      const cy=Math.cos(yaw.current),sy=Math.sin(yaw.current);
      const project=(p:V3)=>{const x=p[0]*cy-p[2]*sy,z=p[0]*sy+p[2]*cy,y=p[1];const sc=(155*zoom.current)/(4.8-z);return [rect.width/2+x*sc,rect.height*.53-y*sc,z] as V3};
      const sorted=faces.map(f=>({f,q:f.p.map(project),z:f.p.reduce((a,p)=>a+(p[0]*sy+p[2]*cy),0)/f.p.length})).sort((a,b)=>a.z-b.z);
      ctx.lineJoin="round";
      for(const {f,q} of sorted){ctx.beginPath();ctx.moveTo(q[0][0],q[0][1]);for(let i=1;i<q.length;i++)ctx.lineTo(q[i][0],q[i][1]);ctx.closePath();ctx.fillStyle=f.color;ctx.fill();ctx.strokeStyle="rgba(20,35,27,.08)";ctx.lineWidth=.6;ctx.stroke()}
      raf=requestAnimationFrame(draw);
    };
    raf=requestAnimationFrame(draw);return()=>cancelAnimationFrame(raf);
  },[recipe,paused]);
  return <canvas ref={ref} className="design-canvas" onPointerDown={e=>{drag.current={x:e.clientX,yaw:yaw.current};e.currentTarget.setPointerCapture(e.pointerId)}} onPointerMove={e=>{if(drag.current)yaw.current=drag.current.yaw+(e.clientX-drag.current.x)*.008}} onPointerUp={()=>drag.current=null} onWheel={e=>{e.preventDefault();zoom.current=clamp(zoom.current-e.deltaY*.0012,.75,2.7)}} onDoubleClick={()=>{zoom.current=1.42}}/>;
}

const Slider=({label,value,min,max,step=.01,onChange}:{label:string;value:number;min:number;max:number;step?:number;onChange:(v:number)=>void})=><label className="lab-slider"><span>{label}<code>{value.toFixed(2)}</code></span><input type="range" min={min} max={max} step={step} value={value} onChange={e=>onChange(Number(e.target.value))}/></label>;

export function DesignLab(){
  const [recipe,setRecipe]=useState<Recipe>(()=>{try{return JSON.parse(localStorage.getItem("rebyters:design:fangbit")||"null")||DEFAULT}catch{return DEFAULT}});
  const [paused,setPaused]=useState(false),[saved,setSaved]=useState(false);
  const setProp=(k:keyof Recipe["proportions"],v:number)=>setRecipe(r=>({...r,proportions:{...r.proportions,[k]:v}}));
  const setAnim=(k:keyof Recipe["personality"],v:number)=>setRecipe(r=>({...r,personality:{...r.personality,[k]:v}}));
  const json=useMemo(()=>JSON.stringify(recipe,null,2),[recipe]);
  function save(){localStorage.setItem("rebyters:design:fangbit",json);setSaved(true);setTimeout(()=>setSaved(false),1400)}
  function download(){const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([json],{type:"application/json"}));a.download="fangbit.recipe.json";a.click();URL.revokeObjectURL(a.href)}
  return <section className="design-lab">
    <div className="page-heading"><div><span className="eyebrow">SPECIMEN DESIGN SYSTEM / MVP 01</span><h1>Design Lab <span className="title-suffix">/ Fangbit</span></h1></div><div className="heading-actions"><button onClick={()=>setRecipe(DEFAULT)}><RotateCcw size={15}/>Reset</button><button onClick={download}><Download size={15}/>Export recipe</button><button className="primary" onClick={save}><Save size={15}/>{saved?"Saved":"Save draft"}</button></div></div>
    <div className="design-grid">
      <aside className="lab-panel"><div className="lab-panel-title">FANGBIT / BYTE 01</div><p className="lab-help">Bespoke specimen. Compact predatory hatchling: one dominant mass, oversized eyes, paired fangs and tiny grounded feet.</p>
        <div className="design-signature"><span>SILHOUETTE</span><strong>ROUND / PEAR</strong><span>SIGNATURE</span><strong>PAIRED FANGS</strong><span>ATTITUDE</span><strong>CURIOUS PREDATOR</strong></div>
        <div className="lab-panel-title sub">FINE TUNING</div>
        <Slider label="Eye spacing" value={recipe.proportions.eyeSpacing} min={.72} max={1.3} onChange={v=>setProp("eyeSpacing",v)}/>
        <div className="lab-panel-title sub">PALETTE</div>
        {(["primary","secondary","dark"] as const).map(k=><label className="color-field" key={k}><span>{k}</span><input type="color" value={recipe.palette[k]} onChange={e=>setRecipe(r=>({...r,palette:{...r.palette,[k]:e.target.value}}))}/><code>{recipe.palette[k]}</code></label>)}
      </aside>
      <div className="lab-viewer"><div className="viewer-badge"><Sparkles size={14}/> LIVE PROCEDURAL SPECIMEN</div><FangbitCanvas recipe={recipe} paused={paused}/><div className="viewer-footer"><span>DRAG TO ROTATE · WHEEL TO ZOOM · DOUBLE CLICK TO RESET</span><button onClick={()=>setPaused(v=>!v)}>{paused?"Play idle":"Pause idle"}</button></div></div>
      <aside className="lab-panel"><div className="lab-panel-title">PERSONALITY / IDLE</div><p className="lab-help">Fangbit has its own idle. The controls below tune personality only; they do not generate the character.</p>
        <Slider label="Bounce" value={recipe.personality.bounce} min={0} max={.24} onChange={v=>setAnim("bounce",v)}/>
        <Slider label="Head bob" value={recipe.personality.headBob} min={0} max={.18} onChange={v=>setAnim("headBob",v)}/>
        <Slider label="Tail wag" value={recipe.personality.tailWag} min={0} max={.35} onChange={v=>setAnim("tailWag",v)}/>
        <Slider label="Blink interval" value={recipe.personality.blinkRate} min={1.5} max={7} step={.1} onChange={v=>setAnim("blinkRate",v)}/>
        <div className="recipe-card"><span>SPECIES</span><strong>{recipe.name}</strong><small>{recipe.stage} · {recipe.engineVersion}</small></div>
        <details className="recipe-json"><summary>Recipe JSON</summary><pre>{json}</pre></details>
      </aside>
    </div>
    <div className="lab-note"><strong>MVP boundary</strong><span>This first pass deliberately saves the deterministic design recipe locally. Irys publishing comes after the Fangbit visual language is approved, so storage and art iteration stay separate.</span></div>
  </section>
}