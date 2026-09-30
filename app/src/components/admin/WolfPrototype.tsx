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
  // warm russet coat, painted rather than modeled
  x.fillStyle="#c85f3c"; x.fillRect(0,0,256,256);
  // forehead / side fur value breakup
  x.fillStyle="#a94731";
  x.beginPath();x.moveTo(0,0);x.lineTo(58,0);x.lineTo(78,62);x.lineTo(48,105);x.lineTo(0,92);x.fill();
  x.beginPath();x.moveTo(256,0);x.lineTo(198,0);x.lineTo(178,62);x.lineTo(208,105);x.lineTo(256,92);x.fill();
  x.fillStyle="#dd744d";
  x.beginPath();x.moveTo(76,18);x.lineTo(128,3);x.lineTo(180,18);x.lineTo(166,62);x.lineTo(128,50);x.lineTo(90,62);x.fill();
  // cream facial mask, deliberately irregular / hand-painted
  x.fillStyle="#e8c98f";
  x.beginPath();x.moveTo(42,91);x.quadraticCurveTo(68,60,112,79);x.lineTo(121,142);x.quadraticCurveTo(86,161,53,139);x.fill();
  x.beginPath();x.moveTo(214,91);x.quadraticCurveTo(188,60,144,79);x.lineTo(135,142);x.quadraticCurveTo(170,161,203,139);x.fill();
  // eye sockets + amber iris + highlight
  for(const ex of [91,165]){
    x.fillStyle="#49353a";x.beginPath();x.ellipse(ex,104,25,30,0,0,Math.PI*2);x.fill();
    x.fillStyle="#d69a35";x.beginPath();x.ellipse(ex,108,15,19,0,0,Math.PI*2);x.fill();
    x.fillStyle="#211d22";x.beginPath();x.ellipse(ex+(ex<128?3:-3),110,6,11,0,0,Math.PI*2);x.fill();
    x.fillStyle="#fff0c6";x.beginPath();x.arc(ex-5,99,3.5,0,Math.PI*2);x.fill();
  }
  // soft brows
  x.strokeStyle="#8f3e31";x.lineWidth=10;x.lineCap="round";
  x.beginPath();x.moveTo(67,76);x.lineTo(108,84);x.stroke();x.beginPath();x.moveTo(189,76);x.lineTo(148,84);x.stroke();
  // muzzle patch / nose / mouth
  x.fillStyle="#f0d7a4";x.beginPath();x.ellipse(128,150,43,29,0,0,Math.PI*2);x.fill();
  x.fillStyle="#49353a";x.beginPath();x.ellipse(128,141,12,8,0,0,Math.PI*2);x.fill();
  x.strokeStyle="#7b4a3e";x.lineWidth=4;x.beginPath();x.moveTo(128,149);x.quadraticCurveTo(111,163,99,154);x.moveTo(128,149);x.quadraticCurveTo(145,163,157,154);x.stroke();
  // chest marking
  x.fillStyle="#e4c486";x.beginPath();x.moveTo(94,185);x.lineTo(112,170);x.lineTo(128,189);x.lineTo(144,170);x.lineTo(162,185);x.lineTo(150,228);x.lineTo(106,228);x.fill();
  // subtle painted tufts
  x.strokeStyle="#a94731";x.lineWidth=6;
  for(const [a,b,d,e] of [[55,168,73,158],[201,168,183,158],[77,205,91,194],[179,205,165,194]] as number[][]){x.beginPath();x.moveTo(a,b);x.lineTo(d,e);x.stroke()}
  const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;tex.magFilter=THREE.LinearFilter;tex.minFilter=THREE.LinearMipmapLinearFilter;return tex;
}

export function FangbitPrototype({ paused=false }:{ paused?:boolean }){
  const host=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const el=host.current;if(!el)return;
    const scene=new THREE.Scene(); const camera=new THREE.PerspectiveCamera(30,1,.1,100);camera.position.set(0,.05,5.0);
    const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputColorSpace=THREE.SRGBColorSpace;el.appendChild(renderer.domElement);
    scene.add(new THREE.HemisphereLight(0xfff0d8,0x27322e,2.25));const key=new THREE.DirectionalLight(0xffffff,1.35);key.position.set(-3,4,5);scene.add(key);
    const root=new THREE.Group();scene.add(root);const texture=makePaintedTexture();
    const skin=new THREE.MeshStandardMaterial({map:texture,roughness:1,metalness:0,flatShading:false});
    const russet=new THREE.MeshStandardMaterial({color:0xa94731,roughness:1});
    const inner=new THREE.MeshStandardMaterial({color:0x7d4552,roughness:1});
    const cream=new THREE.MeshStandardMaterial({color:0xe8c98f,roughness:1});
    const dark=new THREE.MeshStandardMaterial({color:0x49353a,roughness:1});

    // Compact micro-creature silhouette: one dominant body/head volume.
    const bodyGeo=new THREE.SphereGeometry(1.08,14,9);
    const pos=bodyGeo.attributes.position,uv=bodyGeo.attributes.uv;
    for(let i=0;i<pos.count;i++){const px=pos.getX(i)/1.08,py=pos.getY(i)/1.08;uv.setXY(i,THREE.MathUtils.clamp(px*.5+.5,0,1),THREE.MathUtils.clamp(py*.5+.5,0,1))}
    uv.needsUpdate=true;
    const body=new THREE.Mesh(bodyGeo,skin);body.scale.set(1.02,.92,.92);root.add(body);

    // Pointed mammal ears establish Fangbit's predator tendency.
    for(const sx of [-1,1]){
      const e=new THREE.Mesh(new THREE.ConeGeometry(.28,.56,5),russet);e.position.set(.59*sx,.91,.02);e.rotation.z=-sx*.22;root.add(e);
      const ei=new THREE.Mesh(new THREE.ConeGeometry(.135,.32,4),inner);ei.position.set(.59*sx,.94,.23);ei.rotation.z=-sx*.22;root.add(ei);
    }
    // Small muzzle only adds projection; its character is mostly painted.
    const muzzle=new THREE.Mesh(new THREE.SphereGeometry(.40,10,6),cream);muzzle.position.set(0,-.20,.92);muzzle.scale.set(1.15,.65,.50);root.add(muzzle);
    const nose=new THREE.Mesh(new THREE.SphereGeometry(.105,8,5),dark);nose.position.set(0,-.11,1.15);nose.scale.set(1.25,.72,.60);root.add(nose);
    // Signature baby fangs.
    for(const sx of [-1,1]){const fang=new THREE.Mesh(new THREE.ConeGeometry(.038,.16,5),cream);fang.position.set(.145*sx,-.39,1.10);fang.rotation.z=Math.PI;root.add(fang)}
    // Tiny paws barely break the spherical silhouette.
    for(const sx of [-1,1]){const paw=new THREE.Mesh(new THREE.SphereGeometry(.23,8,5),russet);paw.position.set(.70*sx,-.73,.16);paw.scale.set(.95,.54,1.05);root.add(paw)}
    // One short expressive tail, made from two cheap volumes.
    const tail=new THREE.Group();tail.position.set(.86,-.36,-.22);root.add(tail);
    const t1=new THREE.Mesh(new THREE.CapsuleGeometry(.12,.40,3,6),russet);t1.rotation.z=-.72;t1.position.set(.12,.18,0);tail.add(t1);
    const tip=new THREE.Mesh(new THREE.SphereGeometry(.18,7,4),cream);tip.position.set(.34,.43,0);tail.add(tip);

    const shadow=new THREE.Mesh(new THREE.CircleGeometry(1.12,24),new THREE.MeshBasicMaterial({color:0,transparent:true,opacity:.14,depthWrite:false}));shadow.rotation.x=-Math.PI/2;shadow.position.y=-1.00;scene.add(shadow);
    let dragging=false,lastX=0,targetY=-.18,zoom=5.0,raf=0,start=performance.now();
    const down=(e:PointerEvent)=>{dragging=true;lastX=e.clientX;renderer.domElement.setPointerCapture(e.pointerId)};
    const move=(e:PointerEvent)=>{if(!dragging)return;targetY+=(e.clientX-lastX)*.008;lastX=e.clientX};const up=()=>dragging=false;
    const wheel=(e:WheelEvent)=>{e.preventDefault();zoom=THREE.MathUtils.clamp(zoom+e.deltaY*.003,2.45,7)};
    renderer.domElement.addEventListener("pointerdown",down);renderer.domElement.addEventListener("pointermove",move);renderer.domElement.addEventListener("pointerup",up);renderer.domElement.addEventListener("wheel",wheel,{passive:false});
    const resize=()=>{const r=el.getBoundingClientRect();renderer.setSize(r.width,r.height,false);camera.aspect=r.width/Math.max(1,r.height);camera.updateProjectionMatrix()};const ro=new ResizeObserver(resize);ro.observe(el);resize();
    const draw=(now:number)=>{const t=(now-start)/1000;root.rotation.y+=(targetY-root.rotation.y)*.12;camera.position.z+=(zoom-camera.position.z)*.15;if(!paused){root.position.y=Math.sin(t*2)*.03;root.rotation.z=Math.sin(t*1.3)*.009;tail.rotation.z=Math.sin(t*2.4)*.12}renderer.render(scene,camera);raf=requestAnimationFrame(draw)};raf=requestAnimationFrame(draw);
    return()=>{cancelAnimationFrame(raf);ro.disconnect();texture.dispose();bodyGeo.dispose();renderer.dispose();if(renderer.domElement.parentElement===el)el.removeChild(renderer.domElement)};
  },[paused]);
  return <div ref={host} className="wolf-prototype" aria-label="Painted Fangbit prototype"/>;
}
