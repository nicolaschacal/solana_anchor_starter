import { useEffect, useRef } from "react";
import * as THREE from "three";

export function WolfPrototype({ paused=false }:{ paused?:boolean }){
  const host=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const el=host.current;if(!el)return;
    const scene=new THREE.Scene();
    const camera=new THREE.PerspectiveCamera(32,1,.1,100);
    camera.position.set(0,.15,5.4);
    const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});
    renderer.setPixelRatio(Math.min(devicePixelRatio,2));
    renderer.outputColorSpace=THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xfff4dc,0x26332e,2.1));
    const key=new THREE.DirectionalLight(0xffffff,2.4);key.position.set(-3,4,5);scene.add(key);
    const rim=new THREE.DirectionalLight(0x9bb7ff,1.0);rim.position.set(4,2,-3);scene.add(rim);

    const root=new THREE.Group();scene.add(root);
    const flat=(c:number)=>new THREE.MeshStandardMaterial({color:c,roughness:.92,metalness:0,flatShading:true});
    const fur=flat(0x3d5368), furDark=flat(0x263747), muzzle=flat(0xaeb8b6), white=flat(0xd7ded9);
    const eye=flat(0xe4a62d), pupil=flat(0x17181b), ear=flat(0x8f3f62);

    const ico=(r:number,detail=1,mat=fur)=>new THREE.Mesh(new THREE.IcosahedronGeometry(r,detail),mat);
    const body=ico(1.12,2);body.scale.set(1.05,.90,.92);root.add(body);

    // Forward muzzle built as its own low-poly volume.
    const snout=ico(.52,1,muzzle);snout.position.set(0,-.13,.91);snout.scale.set(1.18,.72,.72);root.add(snout);
    const nose=ico(.18,0,pupil);nose.position.set(0,.00,1.30);nose.scale.set(1.25,.75,.65);root.add(nose);

    // Eyes are physical shallow discs so they remain correct from every angle.
    const eyeGeo=new THREE.SphereGeometry(.245,8,5);
    for(const x of [-.36,.36]){
      const e=new THREE.Mesh(eyeGeo,eye);e.position.set(x,.37,.93);e.scale.set(1,.82,.28);root.add(e);
      const q=new THREE.Mesh(new THREE.SphereGeometry(.075,7,4),pupil);q.position.set(x+(x<0?.025:-.025),.36,1.145);q.scale.set(.72,1.1,.25);root.add(q);
    }

    // Triangular ears.
    const earGeo=new THREE.ConeGeometry(.30,.58,4);
    for(const x of [-.63,.63]){
      const e=new THREE.Mesh(earGeo,furDark);e.position.set(x,.94,.10);e.rotation.z=x<0?.22:-.22;root.add(e);
      const inn=new THREE.Mesh(new THREE.ConeGeometry(.15,.34,3),ear);inn.position.set(x,.98,.34);inn.rotation.z=x<0?.22:-.22;root.add(inn);
    }

    // Brows + mane tufts are cheap geometry but create the illustrated silhouette.
    const tuftGeo=new THREE.ConeGeometry(.16,.42,4);
    for(const [x,y,z,rz] of [[-.37,.68,.86,-.95],[.37,.68,.86,.95],[-.76,.55,.30,-1.0],[.76,.55,.30,1.0],[-.83,.25,.12,-1.15],[.83,.25,.12,1.15]] as number[][]){
      const m=new THREE.Mesh(tuftGeo,white);m.position.set(x,y,z);m.rotation.z=rz;root.add(m);
    }
    for(let i=0;i<5;i++){
      const m=new THREE.Mesh(tuftGeo,white);m.position.set((i-2)*.18,.92+Math.abs(i-2)*.03,.25-i*.035);m.rotation.z=(i-2)*.18;root.add(m);
    }

    // Tiny paws.
    for(const x of [-.78,.78]){const p=ico(.30,1,furDark);p.position.set(x,-.70,.24);p.scale.set(.75,.55,1);root.add(p)}
    // Two small signature fangs.
    for(const x of [-.18,.18]){const f=new THREE.Mesh(new THREE.ConeGeometry(.055,.22,5),white);f.position.set(x,-.34,1.22);f.rotation.z=Math.PI;root.add(f)}

    // Ground shadow only; no heavy environment.
    const shadow=new THREE.Mesh(new THREE.CircleGeometry(1.2,24),new THREE.MeshBasicMaterial({color:0x000000,transparent:true,opacity:.18,depthWrite:false}));
    shadow.rotation.x=-Math.PI/2;shadow.position.y=-1.03;shadow.position.z=-.05;scene.add(shadow);

    let dragging=false,lastX=0,targetY=-.28,zoom=5.4,raf=0,start=performance.now();
    const down=(e:PointerEvent)=>{dragging=true;lastX=e.clientX;renderer.domElement.setPointerCapture(e.pointerId)};
    const move=(e:PointerEvent)=>{if(!dragging)return;targetY+=(e.clientX-lastX)*.008;lastX=e.clientX};
    const up=()=>dragging=false;
    const wheel=(e:WheelEvent)=>{e.preventDefault();zoom=THREE.MathUtils.clamp(zoom+e.deltaY*.003,2.6,7.5)};
    renderer.domElement.addEventListener("pointerdown",down);renderer.domElement.addEventListener("pointermove",move);
    renderer.domElement.addEventListener("pointerup",up);renderer.domElement.addEventListener("wheel",wheel,{passive:false});

    const resize=()=>{const r=el.getBoundingClientRect();renderer.setSize(r.width,r.height,false);camera.aspect=r.width/Math.max(1,r.height);camera.updateProjectionMatrix()};
    const ro=new ResizeObserver(resize);ro.observe(el);resize();
    const draw=(now:number)=>{const t=(now-start)/1000;root.rotation.y+=(targetY-root.rotation.y)*.12;camera.position.z+=(zoom-camera.position.z)*.15;
      if(!paused){root.position.y=Math.sin(t*2.1)*.035;root.rotation.z=Math.sin(t*1.35)*.012}
      renderer.render(scene,camera);raf=requestAnimationFrame(draw)};
    raf=requestAnimationFrame(draw);
    return()=>{cancelAnimationFrame(raf);ro.disconnect();renderer.domElement.removeEventListener("pointerdown",down);renderer.domElement.removeEventListener("pointermove",move);renderer.domElement.removeEventListener("pointerup",up);renderer.domElement.removeEventListener("wheel",wheel);renderer.dispose();el.removeChild(renderer.domElement)};
  },[paused]);
  return <div ref={host} className="wolf-prototype" aria-label="Low-poly wolf prototype"/>;
}
