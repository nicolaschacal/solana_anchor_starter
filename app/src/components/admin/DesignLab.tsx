import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Download, RotateCcw, Save, Sparkles } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";

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
  palette: { primary: "#D96A42", secondary: "#F4D59A", dark: "#46323A" },
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
      // FANGBIT / BYTE — silhouette-first bespoke mesh.
      // Unlike the earlier blob assembled from ellipsoids, the torso/head is
      // authored as a single tapered faceted volume. Small procedural parts
      // remain only where they help animation.
      const pulse=1+Math.sin(t*2.15)*.012;
      const orange=recipe.palette.primary, cream=recipe.palette.secondary, ink=recipe.palette.dark;
      const orangeLight=shade(orange,16), orangeDeep=shade(orange,-28);
      const innerEar=shade(cream,-8);

      // Custom rings create a deliberate cub silhouette: broad head/cheeks,
      // pinched neck, compact belly and a stable little base.
      const rings=[
        {y:-.86,r:.43,z:.03},
        {y:-.62,r:.64,z:.00},
        {y:-.22,r:.73,z:.00},
        {y:.18,r:.82,z:.01},
        {y:.48,r:.78,z:.02},
        {y:.72,r:.61,z:.00},
        {y:.86,r:.36,z:-.02},
      ];
      const seg=14;
      const bodyVerts:V3[]=[];
      for(const ring of rings){
        for(let i=0;i<seg;i++){
          const a=(i/seg)*Math.PI*2;
          const side=Math.sin(a), depth=Math.cos(a);
          const squash=ring.y>.12 ? 1+Math.abs(side)*.08 : 1;
          bodyVerts.push([
            side*ring.r*squash*pulse,
            ring.y*pulse+bob,
            ring.z+depth*ring.r*.78*pulse
          ]);
        }
      }
      for(let r=0;r<rings.length-1;r++){
        for(let i=0;i<seg;i++){
          const n=(i+1)%seg;
          const a=bodyVerts[r*seg+i], b=bodyVerts[r*seg+n],
                c=bodyVerts[(r+1)*seg+n], d=bodyVerts[(r+1)*seg+i];
          const light=((i+r)%3-1)*3;
          faces.push({p:[a,b,c,d],color:shade(orange,light)});
        }
      }

      // Cheek planes are colour accents, not separate giant balls.
      faces.push(...ellipsoid([-.40,.28+bob,.63],[.35,.31,.18],orangeLight,10,5));
      faces.push(...ellipsoid([.40,.28+bob,.63],[.35,.31,.18],orangeLight,10,5));

      // Low, outward-pointing ears give Fangbit a compact predator silhouette.
      faces.push(...prism([-.47,.70+bob,.02],[-.67,1.12+bob,.00],.12,orangeDeep));
      faces.push(...prism([.47,.70+bob,.02],[.67,1.12+bob,.00],.12,orangeDeep));
      faces.push(...prism([-.50,.78+bob,.14],[-.63,1.04+bob,.12],.052,innerEar));
      faces.push(...prism([.50,.78+bob,.14],[.63,1.04+bob,.12],.052,innerEar));

      // Graphic face. The eyes are slightly wider and lower than before so the
      // character reads cute rather than vertically stretched.
      const es=.29*recipe.proportions.eyeSpacing;
      faces.push(...ellipsoid([-es,.38+bob,.735],[.155,.185*blink,.045],ink,10,5));
      faces.push(...ellipsoid([es,.38+bob,.735],[.155,.185*blink,.045],ink,10,5));
      if(blink>.5){
        faces.push(...ellipsoid([-es-.03,.44+bob,.778],[.038,.042,.009],cream,5,2));
        faces.push(...ellipsoid([es-.03,.44+bob,.778],[.038,.042,.009],cream,5,2));
      }

      // Tiny muzzle, nose and signature fang pair.
      faces.push(...ellipsoid([0,.10+bob,.755],[.245,.145,.10],orangeLight,10,5));
      faces.push(...ellipsoid([0,.14+bob,.842],[.060,.045,.024],ink,5,2));
      faces.push(...prism([-.105,.035+bob,.825],[-.10,-.055+bob,.84],.017,cream));
      faces.push(...prism([.105,.035+bob,.825],[.10,-.055+bob,.84],.017,cream));

      // Small separated paws preserve the hand-drawn mascot read.
      const armWave=Math.sin(t*2.6)*.022;
      faces.push(...ellipsoid([-.68,-.24+bob+armWave,.31],[.19,.24,.17],orangeDeep,8,4));
      faces.push(...ellipsoid([.68,-.24+bob-armWave,.31],[.19,.24,.17],orangeDeep,8,4));
      faces.push(...ellipsoid([-.39,-.82+bob,.24],[.29,.15,.30],orangeDeep,9,4));
      faces.push(...ellipsoid([.39,-.82+bob,.24],[.29,.15,.30],orangeDeep,9,4));

      // Broad, curved animal tail: three masses instead of a stick.
      const tw=Math.sin(t*2.25)*recipe.personality.tailWag*.50;
      faces.push(...ellipsoid([.67,-.39+bob+tw*.18,-.55],[.28,.24,.25],orangeDeep,8,4));
      faces.push(...ellipsoid([.91,-.16+bob+tw*.55,-.49],[.30,.36,.27],orange,9,5));
      faces.push(...ellipsoid([1.04,.18+bob+tw,-.38],[.27,.38,.24],orangeLight,9,5));
      faces.push(...ellipsoid([1.08,.37+bob+tw*1.05,-.32],[.19,.22,.17],cream,8,4));
      const cy=Math.cos(yaw.current),sy=Math.sin(yaw.current);
      const project=(p:V3)=>{const x=p[0]*cy-p[2]*sy,z=p[0]*sy+p[2]*cy,y=p[1];const sc=(155*zoom.current)/(4.8-z);return [rect.width/2+x*sc,rect.height*.53-y*sc,z] as V3};
      const sorted=faces.map(f=>({f,q:f.p.map(project),z:f.p.reduce((a,p)=>a+(p[0]*sy+p[2]*cy),0)/f.p.length})).sort((a,b)=>a.z-b.z);
      ctx.lineJoin="round";
      for(const {f,q} of sorted){ctx.beginPath();ctx.moveTo(q[0][0],q[0][1]);for(let i=1;i<q.length;i++)ctx.lineTo(q[i][0],q[i][1]);ctx.closePath();ctx.fillStyle=f.color;ctx.fill()}
      raf=requestAnimationFrame(draw);
    };
    raf=requestAnimationFrame(draw);return()=>cancelAnimationFrame(raf);
  },[recipe,paused]);
  return <canvas ref={ref} className="design-canvas" onPointerDown={e=>{drag.current={x:e.clientX,yaw:yaw.current};e.currentTarget.setPointerCapture(e.pointerId)}} onPointerMove={e=>{if(drag.current)yaw.current=drag.current.yaw+(e.clientX-drag.current.x)*.008}} onPointerUp={()=>drag.current=null} onWheel={e=>{e.preventDefault();zoom.current=clamp(zoom.current-e.deltaY*.0016,.65,4.4)}} onDoubleClick={()=>{zoom.current=1.42}}/>;
}

const Slider=({label,value,min,max,step=.01,onChange}:{label:string;value:number;min:number;max:number;step?:number;onChange:(v:number)=>void})=><label className="lab-slider"><span>{label}<code>{value.toFixed(2)}</code></span><input type="range" min={min} max={max} step={step} value={value} onChange={e=>onChange(Number(e.target.value))}/></label>;

export function DesignLab(){
  const [params]=useSearchParams();
  const targetName=params.get("name"), targetStage=params.get("stage"), targetId=params.get("species");
  const linkedFromAtlas=!!targetId;
  const [recipe,setRecipe]=useState<Recipe>(()=>{try{return JSON.parse(localStorage.getItem("rebyters:design:fangbit")||"null")||DEFAULT}catch{return DEFAULT}});
  const [paused,setPaused]=useState(false),[saved,setSaved]=useState(false);
  const setProp=(k:keyof Recipe["proportions"],v:number)=>setRecipe(r=>({...r,proportions:{...r.proportions,[k]:v}}));
  const setAnim=(k:keyof Recipe["personality"],v:number)=>setRecipe(r=>({...r,personality:{...r.personality,[k]:v}}));
  const json=useMemo(()=>JSON.stringify(recipe,null,2),[recipe]);
  function save(){localStorage.setItem("rebyters:design:fangbit",json);setSaved(true);setTimeout(()=>setSaved(false),1400)}
  function download(){const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([json],{type:"application/json"}));a.download="fangbit.recipe.json";a.click();URL.revokeObjectURL(a.href)}
  return <section className="design-lab">
    <div className="page-heading"><div>{linkedFromAtlas && <Link className="back design-back" to="/admin/families/0"><ArrowLeft size={14}/> Atlas</Link>}<span className="eyebrow">SPECIMEN DESIGN SYSTEM / MVP 01</span><h1>Design Lab <span className="title-suffix">/ {targetName || "Fangbit"}</span></h1>{linkedFromAtlas && targetName?.toLowerCase()!=="fangbit" && <p className="design-target-note">{targetName} / {targetStage} is selected from the Atlas. Its bespoke renderer has not been authored yet, so the canvas keeps Fangbit as the current reference instead of pretending it is the selected model.</p>}</div><div className="heading-actions"><button onClick={()=>setRecipe(DEFAULT)}><RotateCcw size={15}/>Reset</button><button onClick={download}><Download size={15}/>Export recipe</button><button className="primary" onClick={save}><Save size={15}/>{saved?"Saved":"Save draft"}</button></div></div>
    <div className="design-grid">
      <aside className="lab-panel"><div className="lab-panel-title">FANGBIT / BYTE 01</div><p className="lab-help">Silhouette-first low-poly cub. Fangbit uses one bespoke faceted body mesh, a graphic face and only a handful of animated parts, keeping the character expressive, lightweight and easy to reproduce.</p>
        <div className="design-signature"><span>SILHOUETTE</span><strong>CUSTOM CUB / COMPACT</strong><span>SIGNATURE</span><strong>EARS + BABY FANGS</strong><span>LINEAGE</span><strong>MAMMAL / PREDATOR</strong></div>
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