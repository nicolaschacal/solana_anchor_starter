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
  // Micro-cat reference: soft lilac coat with painted face and side patches.
  x.fillStyle="#a985df"; x.fillRect(0,0,256,256);
  const g=x.createLinearGradient(0,0,0,256);g.addColorStop(0,"rgba(255,215,255,.24)");g.addColorStop(.58,"rgba(255,255,255,.04)");g.addColorStop(1,"rgba(80,45,120,.16)");x.fillStyle=g;x.fillRect(0,0,256,256);
  // forehead glow
  x.fillStyle="rgba(221,181,246,.42)";x.beginPath();x.ellipse(128,57,70,46,0,0,Math.PI*2);x.fill();
  // closed happy eyes
  x.strokeStyle="#3b263f";x.lineWidth=10;x.lineCap="round";
  x.beginPath();x.arc(86,104,19,3.45,5.95);x.stroke();
  x.beginPath();x.arc(170,104,19,3.45,5.95);x.stroke();
  // cheek blush
  x.fillStyle="rgba(245,132,211,.26)";x.beginPath();x.ellipse(70,135,22,13,0,0,Math.PI*2);x.fill();x.beginPath();x.ellipse(186,135,22,13,0,0,Math.PI*2);x.fill();
  // muzzle cloud
  x.fillStyle="#c9a7e9";x.beginPath();x.ellipse(105,145,34,27,-.18,0,Math.PI*2);x.fill();x.beginPath();x.ellipse(151,145,34,27,.18,0,Math.PI*2);x.fill();
  // pink nose
  x.fillStyle="#f08acb";x.beginPath();x.ellipse(128,130,13,10,0,0,Math.PI*2);x.fill();
  x.fillStyle="#ffd0eb";x.beginPath();x.ellipse(124,126,4,3,0,0,Math.PI*2);x.fill();
  // tiny smile
  x.strokeStyle="#68446f";x.lineWidth=4;x.beginPath();x.moveTo(128,139);x.quadraticCurveTo(117,151,107,144);x.moveTo(128,139);x.quadraticCurveTo(139,151,149,144);x.stroke();
  // side dark patches like the reference
  x.fillStyle="#3f304b";x.beginPath();x.moveTo(25,150);x.lineTo(48,137);x.lineTo(58,157);x.lineTo(43,173);x.lineTo(56,194);x.lineTo(30,199);x.fill();
  x.beginPath();x.moveTo(231,150);x.lineTo(208,137);x.lineTo(198,157);x.lineTo(213,173);x.lineTo(200,194);x.lineTo(226,199);x.fill();
  // belly value
  x.fillStyle="rgba(224,192,247,.38)";x.beginPath();x.ellipse(128,215,55,38,0,0,Math.PI*2);x.fill();
  const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;tex.magFilter=THREE.LinearFilter;tex.minFilter=THREE.LinearMipmapLinearFilter;return tex;
}

export function FangbitPrototype({ paused=false }:{ paused?:boolean }){
  const host=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const el=host.current;if(!el)return;
    const scene=new THREE.Scene();const camera=new THREE.PerspectiveCamera(30,1,.1,100);camera.position.set(0,.05,4.7);
    const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputColorSpace=THREE.SRGBColorSpace;el.appendChild(renderer.domElement);
    scene.add(new THREE.HemisphereLight(0xffe8ff,0x3b3150,2.5));const key=new THREE.DirectionalLight(0xfff6ff,1.45);key.position.set(-3,4,5);scene.add(key);
    const root=new THREE.Group();root.rotation.y=-.08;scene.add(root);
    const texture=makePaintedTexture();
    const coat=new THREE.MeshStandardMaterial({map:texture,color:0xffffff,roughness:.92,metalness:0,flatShading:false});
    const lilac=new THREE.MeshStandardMaterial({color:0xa985df,roughness:.95});
    const lilacLight=new THREE.MeshStandardMaterial({color:0xc8a7eb,roughness:.95});
    const pink=new THREE.MeshStandardMaterial({color:0xe884c5,roughness:.95});
    const white=new THREE.MeshStandardMaterial({color:0xffeefb,roughness:.9});

    // Reference silhouette: squat pear/egg, subtly flattened at the base.
    const bodyGeo=new THREE.SphereGeometry(1,12,8);
    const pos=bodyGeo.attributes.position,uv=bodyGeo.attributes.uv;
    for(let i=0;i<pos.count;i++){const px=pos.getX(i),py=pos.getY(i);uv.setXY(i,THREE.MathUtils.clamp(px*.5+.5,0,1),THREE.MathUtils.clamp(py*.5+.5,0,1))}
    uv.needsUpdate=true;
    const body=new THREE.Mesh(bodyGeo,coat);body.scale.set(.88,1.00,.76);body.position.y=.02;root.add(body);

    // Small triangular cat ears, wide-set and integrated into the head.
    for(const sx of [-1,1]){
      const ear=new THREE.Mesh(new THREE.ConeGeometry(.24,.43,3),lilac);ear.position.set(.56*sx,.88,.02);ear.rotation.z=-sx*.12;ear.rotation.y=sx*.08;root.add(ear);
      const inner=new THREE.Mesh(new THREE.ConeGeometry(.115,.25,3),pink);inner.position.set(.56*sx,.91,.17);inner.rotation.z=-sx*.12;root.add(inner);
    }

    // Puffy muzzle volumes reproduce the reference's soft protruding cheeks.
    for(const sx of [-1,1]){const cheek=new THREE.Mesh(new THREE.SphereGeometry(.27,9,6),lilacLight);cheek.position.set(.16*sx,-.10,.76);cheek.scale.set(1,.72,.52);root.add(cheek)}
    const nose=new THREE.Mesh(new THREE.SphereGeometry(.07,8,5),pink);nose.position.set(0,.00,.94);nose.scale.set(1.12,.82,.65);root.add(nose);

    // Tiny flipper-like forepaws on the sides, matching the micro-cat.
    for(const sx of [-1,1]){
      const paw=new THREE.Mesh(new THREE.SphereGeometry(.23,7,5),lilac);paw.position.set(.79*sx,-.38,.04);paw.scale.set(.62,1.02,.50);paw.rotation.z=sx*.22;root.add(paw);
      // painted-looking toe tips
      for(const dy of [-.055,.035,.125]){const toe=new THREE.Mesh(new THREE.SphereGeometry(.025,5,3),pink);toe.position.set(.895*sx,-.43+dy,.18);root.add(toe)}
    }

    // Three whiskers per side: extremely cheap geometry, visually important.
    for(const sx of [-1,1])for(const [i,dy] of [[0,-.05],[1,.02],[2,.09]] as const){
      const w=new THREE.Mesh(new THREE.CylinderGeometry(.009,.009,.38,5),white);w.rotation.z=Math.PI/2+sx*(i-1)*.08;w.position.set(.48*sx,-.08+dy,.79);root.add(w);
    }

    // Back detail: a tiny curled tail, kept as geometry because it changes silhouette.
    const tail=new THREE.Group();tail.position.set(.60,-.35,-.52);root.add(tail);
    const ta=new THREE.Mesh(new THREE.TorusGeometry(.18,.055,5,10,Math.PI*1.45),lilacLight);ta.rotation.y=Math.PI/2;ta.rotation.z=.35;tail.add(ta);

    const shadow=new THREE.Mesh(new THREE.CircleGeometry(.84,24),new THREE.MeshBasicMaterial({color:0,transparent:true,opacity:.13,depthWrite:false}));shadow.rotation.x=-Math.PI/2;shadow.position.y=-.98;scene.add(shadow);
    let dragging=false,lastX=0,targetY=-.08,zoom=4.7,raf=0,start=performance.now();
    const down=(e:PointerEvent)=>{dragging=true;lastX=e.clientX;renderer.domElement.setPointerCapture(e.pointerId)};
    const move=(e:PointerEvent)=>{if(!dragging)return;targetY+=(e.clientX-lastX)*.008;lastX=e.clientX};const up=()=>dragging=false;
    const wheel=(e:WheelEvent)=>{e.preventDefault();zoom=THREE.MathUtils.clamp(zoom+e.deltaY*.003,2.35,7)};
    renderer.domElement.addEventListener("pointerdown",down);renderer.domElement.addEventListener("pointermove",move);renderer.domElement.addEventListener("pointerup",up);renderer.domElement.addEventListener("wheel",wheel,{passive:false});
    const resize=()=>{const r=el.getBoundingClientRect();renderer.setSize(r.width,r.height,false);camera.aspect=r.width/Math.max(1,r.height);camera.updateProjectionMatrix()};const ro=new ResizeObserver(resize);ro.observe(el);resize();
    const draw=(now:number)=>{const t=(now-start)/1000;root.rotation.y+=(targetY-root.rotation.y)*.12;camera.position.z+=(zoom-camera.position.z)*.15;if(!paused){root.position.y=Math.sin(t*2)*.025;root.rotation.z=Math.sin(t*1.25)*.008;tail.rotation.z=Math.sin(t*1.8)*.10}renderer.render(scene,camera);raf=requestAnimationFrame(draw)};raf=requestAnimationFrame(draw);
    return()=>{cancelAnimationFrame(raf);ro.disconnect();texture.dispose();bodyGeo.dispose();renderer.dispose();if(renderer.domElement.parentElement===el)el.removeChild(renderer.domElement)};
  },[paused]);
  return <div ref={host} className="wolf-prototype" aria-label="Micro cat reference reconstruction"/>;
}
