import { useEffect, useRef } from "react";
import * as THREE from "three";

/**
 * Texture-first low-poly proof of concept.
 * The mesh only provides volume/silhouette. Character detail is painted into a
 * tiny generated texture, exactly as it would be with a hand-painted UV atlas.
 */
function makePaintedTexture(){
  const c=document.createElement("canvas");c.width=256;c.height=256;const x=c.getContext("2d")!;
  x.fillStyle="#3f4054";x.fillRect(0,0,256,256);
  // Painted fur breakup: broad shapes, not modeled tufts.
  x.fillStyle="#505069";x.beginPath();x.moveTo(0,0);x.lineTo(256,0);x.lineTo(222,65);x.lineTo(166,46);x.lineTo(128,70);x.lineTo(90,46);x.lineTo(34,65);x.fill();
  x.fillStyle="#eee2c9";
  // central blaze
  x.beginPath();x.moveTo(128,20);x.lineTo(151,64);x.lineTo(143,104);x.lineTo(128,126);x.lineTo(113,104);x.lineTo(105,64);x.fill();
  // face mask
  x.beginPath();x.moveTo(33,94);x.quadraticCurveTo(65,66,108,87);x.lineTo(119,151);x.quadraticCurveTo(77,169,42,139);x.fill();
  x.beginPath();x.moveTo(223,94);x.quadraticCurveTo(191,66,148,87);x.lineTo(137,151);x.quadraticCurveTo(179,169,214,139);x.fill();
  // eyes
  for(const ex of [88,168]){x.fillStyle="#332d35";x.beginPath();x.ellipse(ex,108,23,28,0,0,Math.PI*2);x.fill();x.fillStyle="#e8a43b";x.beginPath();x.ellipse(ex,111,15,20,0,0,Math.PI*2);x.fill();x.fillStyle="#4a2d21";x.beginPath();x.ellipse(ex,113,7,12,0,0,Math.PI*2);x.fill();x.fillStyle="#fff3d6";x.beginPath();x.arc(ex-5,101,4,0,Math.PI*2);x.fill()}
  // eyebrows and cheek accents
  x.strokeStyle="#343344";x.lineWidth=8;x.lineCap="round";x.beginPath();x.moveTo(66,79);x.quadraticCurveTo(88,70,107,80);x.stroke();x.beginPath();x.moveTo(190,79);x.quadraticCurveTo(168,70,149,80);x.stroke();
  x.fillStyle="#c97970";x.beginPath();x.ellipse(61,143,10,4,-.25,0,Math.PI*2);x.fill();x.beginPath();x.ellipse(195,143,10,4,.25,0,Math.PI*2);x.fill();
  // lower chest marking
  x.fillStyle="#e9ddc5";x.beginPath();x.moveTo(91,184);x.lineTo(109,169);x.lineTo(128,190);x.lineTo(147,169);x.lineTo(165,184);x.lineTo(151,235);x.lineTo(105,235);x.fill();
  const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;tex.magFilter=THREE.LinearFilter;tex.minFilter=THREE.LinearMipmapLinearFilter;return tex;
}

function customBodyGeometry(){
  // Deliberately authored rings: compact cub head, narrow neck, little torso.
  const rings=[
    {y:1.00,rx:.36,rz:.31},{y:.82,rx:.67,rz:.54},{y:.47,rx:.82,rz:.68},
    {y:.08,rx:.76,rz:.69},{y:-.31,rx:.61,rz:.58},{y:-.66,rx:.47,rz:.44},{y:-.82,rx:.30,rz:.29}
  ],seg=12,verts:number[]=[],uvs:number[]=[],idx:number[]=[];
  for(let r=0;r<rings.length;r++)for(let i=0;i<seg;i++){const a=i/seg*Math.PI*2;verts.push(Math.sin(a)*rings[r].rx,rings[r].y,Math.cos(a)*rings[r].rz);uvs.push(i/seg,1-r/(rings.length-1))}
  for(let r=0;r<rings.length-1;r++)for(let i=0;i<seg;i++){const n=(i+1)%seg,a=r*seg+i,b=r*seg+n,c=(r+1)*seg+i,d=(r+1)*seg+n;idx.push(a,c,b,b,c,d)}
  const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.Float32BufferAttribute(verts,3));g.setAttribute("uv",new THREE.Float32BufferAttribute(uvs,2));g.setIndex(idx);g.computeVertexNormals();return g;
}

export function FangbitPrototype({paused=false}:{paused?:boolean}){
 const host=useRef<HTMLDivElement>(null);
 useEffect(()=>{const el=host.current;if(!el)return;
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(29,1,.1,100);camera.position.set(0,.03,4.65);
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputColorSpace=THREE.SRGBColorSpace;el.appendChild(renderer.domElement);
  scene.add(new THREE.HemisphereLight(0xfff4df,0x252838,2.35));const key=new THREE.DirectionalLight(0xfff7e8,1.35);key.position.set(-3,4,5);scene.add(key);
  const root=new THREE.Group();root.rotation.y=-.08;scene.add(root),tex=makePaintedTexture();
  const fur=new THREE.MeshStandardMaterial({map:tex,roughness:.96,flatShading:false}),dark=new THREE.MeshStandardMaterial({color:0x3f4054,roughness:.98}),cream=new THREE.MeshStandardMaterial({color:0xeee2c9,roughness:.98}),pink=new THREE.MeshStandardMaterial({color:0xd36f73,roughness:.98}),noseMat=new THREE.MeshStandardMaterial({color:0x332d35,roughness:.9});
  const bodyGeo=customBodyGeometry(),body=new THREE.Mesh(bodyGeo,fur);root.add(body);
  // broad triangular ears
  for(const sx of [-1,1]){const e=new THREE.Mesh(new THREE.ConeGeometry(.31,.61,3),dark);e.position.set(.49*sx,.91,.01);e.rotation.z=-sx*.14;root.add(e);const inn=new THREE.Mesh(new THREE.ConeGeometry(.16,.34,3),pink);inn.position.set(.49*sx,.94,.18);inn.rotation.z=-sx*.14;root.add(inn)}
  // compact cream muzzle
  for(const sx of [-1,1]){const m=new THREE.Mesh(new THREE.SphereGeometry(.27,10,6),cream);m.position.set(.14*sx,-.02,.66);m.scale.set(1,.72,.52);root.add(m)}
  const nose=new THREE.Mesh(new THREE.SphereGeometry(.09,8,5),noseMat);nose.position.set(0,.05,.84);nose.scale.set(1.2,.72,.58);root.add(nose);
  for(const sx of [-1,1]){const fang=new THREE.Mesh(new THREE.ConeGeometry(.035,.15,5),cream);fang.position.set(.13*sx,-.23,.80);fang.rotation.z=Math.PI;root.add(fang)}
  // four tiny paws, visible as in approved sheet
  for(const sx of [-1,1]){const front=new THREE.Mesh(new THREE.SphereGeometry(.18,8,5),cream);front.position.set(.37*sx,-.72,.35);front.scale.set(.82,.58,1.05);root.add(front);const back=new THREE.Mesh(new THREE.SphereGeometry(.19,8,5),dark);back.position.set(.57*sx,-.68,-.18);back.scale.set(.9,.55,1.05);root.add(back)}
  // bushy two-lobe tail with cream tip
  const tail=new THREE.Group();tail.position.set(.62,-.37,-.47);root.add(tail);const tb=new THREE.Mesh(new THREE.SphereGeometry(.28,8,5),dark);tb.scale.set(.65,1.25,.65);tb.rotation.z=-.72;tail.add(tb);const tt=new THREE.Mesh(new THREE.SphereGeometry(.20,8,5),cream);tt.position.set(.19,.30,.02);tt.scale.set(.72,1.15,.72);tt.rotation.z=-.72;tail.add(tt);
  const shadow=new THREE.Mesh(new THREE.CircleGeometry(.82,24),new THREE.MeshBasicMaterial({color:0,transparent:true,opacity:.13,depthWrite:false}));shadow.rotation.x=-Math.PI/2;shadow.position.y=-.86;scene.add(shadow);
  let dragging=false,lastX=0,targetY=-.08,zoom=4.65,raf=0,start=performance.now();const down=(e:PointerEvent)=>{dragging=true;lastX=e.clientX;renderer.domElement.setPointerCapture(e.pointerId)},move=(e:PointerEvent)=>{if(!dragging)return;targetY+=(e.clientX-lastX)*.008;lastX=e.clientX},up=()=>dragging=false,wheel=(e:WheelEvent)=>{e.preventDefault();zoom=THREE.MathUtils.clamp(zoom+e.deltaY*.003,2.25,7)};
  renderer.domElement.addEventListener("pointerdown",down);renderer.domElement.addEventListener("pointermove",move);renderer.domElement.addEventListener("pointerup",up);renderer.domElement.addEventListener("wheel",wheel,{passive:false});
  const resize=()=>{const r=el.getBoundingClientRect();renderer.setSize(r.width,r.height,false);camera.aspect=r.width/Math.max(1,r.height);camera.updateProjectionMatrix()},ro=new ResizeObserver(resize);ro.observe(el);resize();
  const draw=(now:number)=>{const t=(now-start)/1000;root.rotation.y+=(targetY-root.rotation.y)*.12;camera.position.z+=(zoom-camera.position.z)*.15;if(!paused){root.position.y=Math.sin(t*2)*.022;root.rotation.z=Math.sin(t*1.3)*.007;tail.rotation.z=Math.sin(t*2.2)*.08}renderer.render(scene,camera);raf=requestAnimationFrame(draw)};raf=requestAnimationFrame(draw);
  return()=>{cancelAnimationFrame(raf);ro.disconnect();tex.dispose();bodyGeo.dispose();renderer.dispose();if(renderer.domElement.parentElement===el)el.removeChild(renderer.domElement)}
 },[paused]);
 return <div ref={host} className="wolf-prototype" aria-label="Fangbit approved concept 3D blockout"/>;
}
