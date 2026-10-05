import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { WorldPeriod } from "../../hooks/useWorldClock";

const palettes = {
  Night: { sky: 0x101e42, ground: 0x244539, grass: 0x41614b, light: 0xa9c5ff, intensity: 1.4 },
  Morning: { sky: 0x9bbfcb, ground: 0x607b40, grass: 0x92ab58, light: 0xffe4ba, intensity: 2.4 },
  Day: { sky: 0x83c4e3, ground: 0x5c843c, grass: 0x95b953, light: 0xfff2d5, intensity: 2.6 },
  Evening: { sky: 0x696886, ground: 0x4c6240, grass: 0x818453, light: 0xffc191, intensity: 2 },
};
const ENV="/assets/environment/";
const files={
 plain:"grass-plain.glb", detail:"grass-tile.glb", dirt:"dirt-transition.glb",
 mountains:"distant-mountains.glb", pine:"pine-tree.glb", tree:"deciduous-tree.glb",
 bush:"berry-bush.glb", rocks:"mossy-rocks.glb", stump:"tree-stump.glb",
 log:"hollow-log.glb", mushrooms:"red-mushrooms.glb",
} as const;

function disposeGroup(group:THREE.Object3D){
 const gs=new Set<THREE.BufferGeometry>(),ms=new Set<THREE.Material>(),ts=new Set<THREE.Texture>();
 group.traverse(n=>{const m=n as THREE.Mesh;if(m.geometry)gs.add(m.geometry);if(m.material)for(const x of(Array.isArray(m.material)?m.material:[m.material]))ms.add(x)});
 gs.forEach(x=>x.dispose());ms.forEach(m=>{for(const v of Object.values(m))if(v instanceof THREE.Texture)ts.add(v);m.dispose()});ts.forEach(x=>x.dispose());
}
function fit(o:THREE.Object3D,height:number){
 o.updateMatrixWorld(true);let b=new THREE.Box3().setFromObject(o),s=b.getSize(new THREE.Vector3());
 o.scale.setScalar(height/Math.max(s.y,.001));o.updateMatrixWorld(true);b=new THREE.Box3().setFromObject(o);
 const c=b.getCenter(new THREE.Vector3());o.position.set(-c.x,-b.min.y,-c.z);return o;
}
function fitGround(o:THREE.Object3D,width:number){
 o.updateMatrixWorld(true);let b=new THREE.Box3().setFromObject(o),s=b.getSize(new THREE.Vector3());
 o.scale.setScalar(width/Math.max(s.x,s.z,.001));o.updateMatrixWorld(true);b=new THREE.Box3().setFromObject(o);
 const c=b.getCenter(new THREE.Vector3());o.position.set(-c.x,-b.min.y,-c.z);return o;
}
function put(src:THREE.Object3D|null,parent:THREE.Group,x:number,z:number,h:number,r=0){
 if(!src)return null;const o=fit(src.clone(true),h);o.position.x+=x;o.position.z+=z;o.rotation.y=r;parent.add(o);return o;
}
export function meadow(scene:THREE.Scene,period:WorldPeriod){
 const colors=palettes[period],group=new THREE.Group();scene.add(group);scene.background=new THREE.Color(colors.sky);scene.fog=new THREE.Fog(colors.sky,18,50);
 const floor=new THREE.Mesh(new THREE.PlaneGeometry(120,120),new THREE.MeshStandardMaterial({color:colors.ground,roughness:1}));
 floor.rotation.x=-Math.PI/2;floor.position.y=-.04;group.add(floor);
 let seed=12345;const rand=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296};
 const orb=new THREE.Mesh(new THREE.SphereGeometry(period==="Night"?.65:1,16,10),new THREE.MeshBasicMaterial({color:period==="Night"?0xe2eeff:0xffe3af,fog:false}));
 orb.position.set(-3,6,-28);group.add(orb);
 if(period==="Night"){const p:number[]=[];for(let i=0;i<70;i++){const a=rand()*Math.PI*2;p.push(Math.cos(a)*35,4+rand()*14,Math.sin(a)*35)}const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.Float32BufferAttribute(p,3));group.add(new THREE.Points(g,new THREE.PointsMaterial({color:0xd4e6ff,size:.085,fog:false})))}
 const canvas=document.createElement("canvas");canvas.width=canvas.height=64;const ctx=canvas.getContext("2d")!,grad=ctx.createRadialGradient(32,32,6,32,32,32);
 grad.addColorStop(0,"rgba(3,10,7,.72)");grad.addColorStop(.65,"rgba(3,10,7,.2)");grad.addColorStop(1,"rgba(3,10,7,0)");ctx.fillStyle=grad;ctx.fillRect(0,0,64,64);
 const shadow=new THREE.Mesh(new THREE.PlaneGeometry(2.7,1.7),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(canvas),transparent:true,depthWrite:false}));
 shadow.rotation.x=-Math.PI/2;shadow.position.set(0,.19,.1);group.add(shadow);

 const loader=new GLTFLoader(),mobile=matchMedia("(pointer: coarse)").matches||innerWidth<=700;let disposed=false;
 const living:{o:THREE.Object3D;baseX:number;baseZ:number;phase:number;amount:number}[]=[];
 const load=async(k:keyof typeof files)=>{try{return(await loader.loadAsync(ENV+files[k])).scene}catch(e){console.warn("[Rebyters] env",files[k],e);return null}};
 const keys=(mobile?["plain","mountains","tree","pine","bush","detail","dirt","rocks"]:["plain","mountains","tree","pine","bush","detail","dirt","rocks","stump","log","mushrooms"]) as (keyof typeof files)[];
 void(async()=>{
   const a:Partial<Record<keyof typeof files,THREE.Group|null>>={};
   // Sequential loading is deliberate: stable on iOS and visually progressive.
   for(const k of keys){if(disposed)return;a[k]=await load(k)}
   if(disposed)return;
   const plain=a.plain;
   if(plain){
     const coords=mobile?[[-3.8,-3.8],[0,-3.8],[3.8,-3.8],[-3.8,0],[0,0],[3.8,0],[-3.8,3.8],[0,3.8],[3.8,3.8]]
                        :[[-7.6,-3.8],[-3.8,-3.8],[0,-3.8],[3.8,-3.8],[7.6,-3.8],[-7.6,0],[-3.8,0],[0,0],[3.8,0],[7.6,0],[-7.6,3.8],[-3.8,3.8],[0,3.8],[3.8,3.8],[7.6,3.8]];
     coords.forEach(([x,z],i)=>{const t=fitGround(plain.clone(true),4.05);t.position.set(x,-.02,z);t.rotation.y=(i%4)*Math.PI/2;group.add(t)});
   }
   // One detailed tile and one dirt transition break repetition without clutter.
   if(a.detail){const t=fitGround(a.detail.clone(true),4.2);t.position.set(-3.7,-.012,2.8);t.rotation.y=Math.PI/2;group.add(t)}
   if(a.dirt){const t=fitGround(a.dirt.clone(true),4.2);t.position.set(3.6,-.01,2.9);t.rotation.y=-Math.PI/2;group.add(t)}
   // Mountains are backdrop only; two instances create depth with a tiny asset budget.
   if(a.mountains){const m1=fit(a.mountains.clone(true),mobile?6.5:8);m1.position.set(-7,0,-15);group.add(m1);if(!mobile){const m2=fit(a.mountains.clone(true),7);m2.position.set(7,0,-17);m2.rotation.y=Math.PI;group.add(m2)}}
   const tall=mobile?[ [a.tree,-5,-5.2,5.5,.15],[a.pine,5.1,-5.8,6.2,-.2] ]:[ [a.tree,-5,-5.2,6,.15],[a.pine,5.2,-5.8,6.8,-.2],[a.pine,-7,-1,5.5,.25],[a.tree,7,-1.5,5.8,-.25] ];
   tall.forEach(([src,x,z,h,r],i)=>{const o=put(src as THREE.Object3D|null,group,x as number,z as number,h as number,r as number);if(o)living.push({o,baseX:o.rotation.x,baseZ:o.rotation.z,phase:i*.9,amount:.012})});
   const bushes=mobile?[[-3.8,-2.5],[3.9,-2.8]]:[[-3.8,-2.5],[3.9,-2.8],[-4.5,2.4],[4.6,2.1]];
   bushes.forEach(([x,z],i)=>{const o=put(a.bush??null,group,x,z,1.05,i*.7);if(o)living.push({o,baseX:o.rotation.x,baseZ:o.rotation.z,phase:i*.63,amount:.02})});
   put(a.rocks??null,group,-2.9,1.8,.65,.3);if(!mobile){put(a.stump??null,group,-4,.2,.85,.2);put(a.log??null,group,4.2,.3,.75,-.5);put(a.mushrooms??null,group,-2,-1.8,.4,.15)}
 })();

 // Wind is updated from the viewer's existing animation loop: no second RAF.
 const update=(time:number)=>{for(const x of living){x.o.rotation.z=x.baseZ+Math.sin(time*.72+x.phase)*x.amount;x.o.rotation.x=x.baseX+Math.sin(time*.48+x.phase*1.7)*x.amount*.35}};
 return{colors,groundY:.18,update,dispose(){disposed=true;disposeGroup(group);scene.remove(group)}};
}
