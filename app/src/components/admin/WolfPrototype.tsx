import { useEffect, useRef } from "react";
import * as THREE from "three";

/**
 * Texture-first low-poly proof of concept.
 * The mesh only provides volume/silhouette. Character detail is painted into a
 * tiny generated texture, exactly as it would be with a hand-painted UV atlas.
 */
function makePaintedTexture(){
  const c=document.createElement("canvas"); c.width=256; c.height=256;
  const x=c.getContext("2d")!;
  x.fillStyle="#52687a"; x.fillRect(0,0,256,256);
  // painterly fur patches / soft value breakup
  x.fillStyle="#40566a";
  for(const [px,py,rx,ry] of [[28,35,30,42],[222,38,34,45],[34,195,40,50],[215,190,42,52],[128,20,38,20]] as number[][]){
    x.beginPath();x.ellipse(px,py,rx,ry,0,0,Math.PI*2);x.fill();
  }
  x.fillStyle="#d7d6c8";
  x.beginPath();x.ellipse(128,151,75,55,0,0,Math.PI*2);x.fill();
  // cheek fur painted as jagged shapes
  x.fillStyle="#e6e3d3";
  x.beginPath();x.moveTo(58,130);x.lineTo(36,143);x.lineTo(57,151);x.lineTo(40,166);x.lineTo(70,163);x.lineTo(80,137);x.fill();
  x.beginPath();x.moveTo(198,130);x.lineTo(220,143);x.lineTo(199,151);x.lineTo(216,166);x.lineTo(186,163);x.lineTo(176,137);x.fill();
  // eyes: painted sockets + warm iris + pupils/highlights
  for(const ex of [91,165]){
    x.fillStyle="#2b3039";x.beginPath();x.ellipse(ex,105,27,31,0,0,Math.PI*2);x.fill();
    x.fillStyle="#d99a2b";x.beginPath();x.ellipse(ex,108,18,21,0,0,Math.PI*2);x.fill();
    x.fillStyle="#171a1d";x.beginPath();x.ellipse(ex+(ex<128?4:-4),110,7,13,0,0,Math.PI*2);x.fill();
    x.fillStyle="#fff4cf";x.beginPath();x.arc(ex-5,99,4,0,Math.PI*2);x.fill();
  }
  // brows
  x.strokeStyle="#e7e4d5";x.lineWidth=13;x.lineCap="round";
  x.beginPath();x.moveTo(66,77);x.lineTo(107,88);x.stroke();
  x.beginPath();x.moveTo(190,77);x.lineTo(149,88);x.stroke();
  // muzzle details
  x.fillStyle="#22262b";x.beginPath();x.ellipse(128,145,18,12,0,0,Math.PI*2);x.fill();
  x.strokeStyle="#6b625d";x.lineWidth=5;x.beginPath();x.moveTo(128,156);x.quadraticCurveTo(105,176,87,162);x.moveTo(128,156);x.quadraticCurveTo(151,176,169,162);x.stroke();
  // painted lower fur
  x.fillStyle="#bbc2bd";x.beginPath();x.moveTo(83,184);x.lineTo(102,169);x.lineTo(114,190);x.lineTo(128,172);x.lineTo(142,190);x.lineTo(155,169);x.lineTo(176,184);x.lineTo(164,218);x.lineTo(92,218);x.fill();
  const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;tex.magFilter=THREE.LinearFilter;tex.minFilter=THREE.LinearMipmapLinearFilter;
  return tex;
}

export function WolfPrototype({ paused=false }:{ paused?:boolean }){
  const host=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const el=host.current;if(!el)return;
    const scene=new THREE.Scene();
    const camera=new THREE.PerspectiveCamera(30,1,.1,100); camera.position.set(0,.08,5.1);
    const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});
    renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputColorSpace=THREE.SRGBColorSpace;el.appendChild(renderer.domElement);
    scene.add(new THREE.HemisphereLight(0xfff4df,0x26312f,2.4));
    const key=new THREE.DirectionalLight(0xffffff,1.5);key.position.set(-3,4,5);scene.add(key);

    const root=new THREE.Group();scene.add(root);
    const texture=makePaintedTexture();
    // Smooth lighting is intentional: polygons define shape, not the final look.
    const skin=new THREE.MeshStandardMaterial({map:texture,roughness:1,metalness:0,flatShading:false});
    const dark=new THREE.MeshStandardMaterial({color:0x314354,roughness:1,flatShading:false});
    const inner=new THREE.MeshStandardMaterial({color:0x7c3f59,roughness:1,flatShading:false});
    const ivory=new THREE.MeshStandardMaterial({color:0xe8e2c8,roughness:1,flatShading:false});

    // UV sphere kept deliberately tiny. The 256px painted atlas supplies the face.
    const headGeo=new THREE.SphereGeometry(1.12,16,10);
    const pos=headGeo.attributes.position, uv=headGeo.attributes.uv;
    // Front-project the UVs so our illustrated atlas sits on the face and remains
    // attached to the surface while the model rotates.
    for(let i=0;i<pos.count;i++){
      const px=pos.getX(i)/1.12, py=pos.getY(i)/1.12;
      uv.setXY(i,THREE.MathUtils.clamp(px*.5+.5,0,1),THREE.MathUtils.clamp(py*.5+.5,0,1));
    }
    uv.needsUpdate=true;
    const head=new THREE.Mesh(headGeo,skin);head.scale.set(1.03,.96,.91);root.add(head);

    // Only silhouette-changing details get geometry.
    const earGeo=new THREE.ConeGeometry(.29,.58,5);
    for(const sx of [-1,1]){
      const e=new THREE.Mesh(earGeo,dark);e.position.set(.61*sx,.91,.04);e.rotation.z=-sx*.23;root.add(e);
      const ei=new THREE.Mesh(new THREE.ConeGeometry(.14,.34,4),inner);ei.position.set(.61*sx,.94,.24);ei.rotation.z=-sx*.23;root.add(ei);
    }
    // small muzzle projection: same painted language, no faceted "rock" look
    const muzzleMat=new THREE.MeshStandardMaterial({color:0xc8cdc5,roughness:1,flatShading:false});
    const muzzle=new THREE.Mesh(new THREE.SphereGeometry(.46,10,6),muzzleMat);muzzle.position.set(0,-.22,.91);muzzle.scale.set(1.18,.66,.55);root.add(muzzle);
    const nose=new THREE.Mesh(new THREE.SphereGeometry(.13,8,5),dark);nose.position.set(0,-.12,1.19);nose.scale.set(1.3,.75,.65);root.add(nose);
    for(const sx of [-1,1]){
      const fang=new THREE.Mesh(new THREE.ConeGeometry(.045,.18,5),ivory);fang.position.set(.17*sx,-.40,1.12);fang.rotation.z=Math.PI;root.add(fang);
      const paw=new THREE.Mesh(new THREE.SphereGeometry(.25,8,5),dark);paw.position.set(.72*sx,-.76,.18);paw.scale.set(.9,.55,1);root.add(paw);
    }

    const shadow=new THREE.Mesh(new THREE.CircleGeometry(1.15,24),new THREE.MeshBasicMaterial({color:0,transparent:true,opacity:.16,depthWrite:false}));
    shadow.rotation.x=-Math.PI/2;shadow.position.y=-1.02;scene.add(shadow);

    let dragging=false,lastX=0,targetY=-.18,zoom=5.1,raf=0,start=performance.now();
    const down=(e:PointerEvent)=>{dragging=true;lastX=e.clientX;renderer.domElement.setPointerCapture(e.pointerId)};
    const move=(e:PointerEvent)=>{if(!dragging)return;targetY+=(e.clientX-lastX)*.008;lastX=e.clientX};
    const up=()=>dragging=false;
    const wheel=(e:WheelEvent)=>{e.preventDefault();zoom=THREE.MathUtils.clamp(zoom+e.deltaY*.003,2.5,7)};
    renderer.domElement.addEventListener("pointerdown",down);renderer.domElement.addEventListener("pointermove",move);renderer.domElement.addEventListener("pointerup",up);renderer.domElement.addEventListener("wheel",wheel,{passive:false});
    const resize=()=>{const r=el.getBoundingClientRect();renderer.setSize(r.width,r.height,false);camera.aspect=r.width/Math.max(1,r.height);camera.updateProjectionMatrix()};
    const ro=new ResizeObserver(resize);ro.observe(el);resize();
    const draw=(now:number)=>{const t=(now-start)/1000;root.rotation.y+=(targetY-root.rotation.y)*.12;camera.position.z+=(zoom-camera.position.z)*.15;if(!paused){root.position.y=Math.sin(t*2)*.03;root.rotation.z=Math.sin(t*1.3)*.01}renderer.render(scene,camera);raf=requestAnimationFrame(draw)};
    raf=requestAnimationFrame(draw);
    return()=>{cancelAnimationFrame(raf);ro.disconnect();texture.dispose();headGeo.dispose();renderer.dispose();if(renderer.domElement.parentElement===el)el.removeChild(renderer.domElement)};
  },[paused]);
  return <div ref={host} className="wolf-prototype" aria-label="Painted low-poly wolf prototype"/>;
}
