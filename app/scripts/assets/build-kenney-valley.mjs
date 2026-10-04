// Usage: node scripts/assets/build-kenney-valley.mjs /path/to/extracted/kenney_nature-kit
// Only the selected CC0 OBJ geometry is included; no textures or full pack at runtime.
import fs from 'node:fs/promises';
import process from 'node:process';
import console from 'node:console';
import { URL } from 'node:url';
import path from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, dedup, prune, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
const source=process.argv[2];
if(!source) throw Error('Supply the extracted Kenney Nature Kit directory.');
const out=new URL('../../public/assets/environments/kenney-valley/',import.meta.url);
await fs.mkdir(out,{recursive:true});
const positions=[],normals=[],colors=[],sources=new Set();
const cache=new Map();
let seed=42;const random=()=>((seed=(1664525*seed+1013904223)>>>0)/4294967296);
const v=new THREE.Vector3(),normal=new THREE.Vector3(),normalMatrix=new THREE.Matrix3();
function append(geometry,matrix,color){
 const g=geometry.index?geometry.toNonIndexed():geometry;
 if(!g.getAttribute('normal'))g.computeVertexNormals();
 const p=g.getAttribute('position'),n=g.getAttribute('normal'),c=g.getAttribute('color');
 normalMatrix.getNormalMatrix(matrix);
 for(let i=0;i<p.count;i++){
  v.fromBufferAttribute(p,i).applyMatrix4(matrix);positions.push(v.x,v.y,v.z);
  normal.fromBufferAttribute(n,i).applyMatrix3(normalMatrix).normalize();normals.push(normal.x,normal.y,normal.z);
  if(c)colors.push(c.getX(i),c.getY(i),c.getZ(i));else colors.push(color.r,color.g,color.b);
 }
}
const matrix=(x,y,z,sx,sy,sz,rotation=0)=>new THREE.Matrix4().compose(new THREE.Vector3(x,y,z),new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),rotation),new THREE.Vector3(sx,sy,sz));
function primitive(g,x,y,z,sx,sy,sz,color,rotation=0){append(g,matrix(x,y,z,sx,sy,sz,rotation),new THREE.Color(color));g.dispose()}
async function asset(name,x,y,z,height,rotation=0,width=1){
 let data=cache.get(name);
 if(!data){
  const obj=await fs.readFile(path.join(source,'Models/OBJ format',name+'.obj'),'utf8');
  const mtl=await fs.readFile(path.join(source,'Models/OBJ format',name+'.mtl'),'utf8');
  const materials={};let current='';
  for(const line of mtl.split(/\r?\n/)){const [type,...values]=line.trim().split(/\s+/);if(type==='newmtl')current=values[0];if(type==='Kd'){
   let rgb=values.map(Number);
   // Nature Kit uses turquoise foliage; grade it toward meadow green.
   if(/leaf|grass|plant/i.test(current))rgb=[rgb[0]*1.2,rgb[1]*.76,rgb[2]*.34];
   if(current==='dirt')rgb=[.52,.57,.54];
   if(current==='stone')rgb=[.60,.65,.63];
   materials[current]=new THREE.Color().setRGB(...rgb,THREE.SRGBColorSpace);
  }}
  const verts=[],p=[],c=[];current='';
  for(const line of obj.split(/\r?\n/)){const [type,...values]=line.trim().split(/\s+/);if(type==='v')verts.push(values.map(Number));if(type==='usemtl')current=values[0];if(type==='f'){
   const indices=values.map(f=>Number(f.split('/')[0])-1),color=materials[current]||new THREE.Color('#719858');
   for(let j=1;j<indices.length-1;j++)for(const i of [indices[0],indices[j],indices[j+1]]){p.push(...verts[i]);c.push(color.r,color.g,color.b)}
  }}
  const g=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(p,3)).setAttribute('color',new THREE.Float32BufferAttribute(c,3));g.computeVertexNormals();g.computeBoundingBox();
  data={g,min:g.boundingBox.min.y,height:g.boundingBox.max.y-g.boundingBox.min.y};cache.set(name,data);sources.add(name);
 }
 const scale=height/data.height;append(data.g,matrix(x,y-data.min*scale,z,scale*width,scale,scale*width,rotation));
}
// A continuous playable clearing, with the lake and landmarks behind the companion.
primitive(new THREE.BoxGeometry(1,1,1),0,-.24,0,120,.4,120,'#739747');
// Faceted mountain silhouettes; distinct near/far colors convey depth without postprocessing.
for(let i=0;i<11;i++){
 const x=(i-5)*6,z=-34-random()*9,h=6+random()*6;
 primitive(new THREE.ConeGeometry(1,1,5,1),x,h/2-.1,z,5,h,4,'#709cab',random());
}
for(const side of [-1,1]){
 for(let i=0;i<5;i++)await asset('rock_largeA',side*(6+i*1.4),-.06,-9-i*2,3+random()*5,random()*6,.28);
 for(let i=0;i<13;i++)await asset(i%3?'tree_pineTallA':'tree_oak_dark',side*(3.8+random()*7),0,-2-i*1.5,2.8+random()*3.5,random()*6);
}
for(let i=0;i<17;i++)await asset(i%4?'tree_pineTallA':'tree_oak_dark',(i-8)*1.35,0,-21-random()*3,2.8+random()*2,random()*6);
// The left cliff frames a waterfall; no expensive fluid or reflection shader.
await asset('cliff_large_stone',-6.5,0,-12,8,0,1.1);
await asset('cliff_waterfall_stone',-5.2,0,-10.9,6.3,0,.75);
primitive(new THREE.PlaneGeometry(1,1),-2.9,3,-11,.8,6,1,'#85d9e4');
primitive(new THREE.PlaneGeometry(1,1),-2.7,3,-10.99,.09,6,1,'#cff4f1');
await asset('tree_pineTallA',-7,8,-12,3.6);
await asset('tree_pineTallA',-5.8,8,-12.6,3.1);
// Small weathered arch on the cliff: original arrangement using simple geometry.
for(const x of [-7.5,-5.7])primitive(new THREE.BoxGeometry(1,1,1),x,9.1,-12.1,.45,2.4,.55,'#b8b39c');
primitive(new THREE.BoxGeometry(1,1,1),-6.6,10.35,-12.1,2.25,.38,.6,'#c6c0a7');
// Foreground stones and vegetation frame the empty walking area rather than obscure it.
for(let i=0;i<18;i++){
 const a=random()*Math.PI*2,r=3.5+random()*8;
 await asset('rock_largeA',Math.cos(a)*r,0,Math.sin(a)*r,.25+random()*.65,random()*6);
}
for(let i=0;i<28;i++){
 const side=i%2?1:-1,x=side*(1.5+random()*6),z=2-random()*12;
 await asset(i%4?'grass':'plant_bush',x,0,z,.15+random()*.35,random()*6);
}
// A few bright flowers retain the animated, welcoming mood of the reference.
for(let i=0;i<14;i++)await asset(i%2?'flower_yellowA':'flower_redA',(i%2?1:-1)*(1.3+random()*2),0,2-random()*5,.18+random()*.12,random()*6);
const doc=new Document(),buffer=doc.createBuffer(),scene=doc.createScene('Kenney CC0 valley');
function accessor(name,type,array){return doc.createAccessor(name).setType(type).setArray(array).setBuffer(buffer)}
const material=doc.createMaterial('Flat vertex colors').setRoughnessFactor(1).setMetallicFactor(0);
const mesh=doc.createMesh('Batched landscape').addPrimitive(doc.createPrimitive().setAttribute('POSITION',accessor('positions','VEC3',new Float32Array(positions))).setAttribute('NORMAL',accessor('normals','VEC3',new Float32Array(normals))).setAttribute('COLOR_0',accessor('colors','VEC3',new Float32Array(colors))).setMaterial(material));
scene.addChild(doc.createNode('Landscape').setMesh(mesh));
// One separate, opaque water draw. The lake sits above the clearing floor.
const water=new THREE.CircleGeometry(1,40);water.rotateX(-Math.PI/2);water.scale(8,1,8);water.translate(0,-.015,-11);
const wp=water.getAttribute('position'),wn=water.getAttribute('normal');
const waterMaterial=doc.createMaterial('Lake').setBaseColorFactor([.12,.47,.62,1]).setRoughnessFactor(.65).setMetallicFactor(0);
scene.addChild(doc.createNode('Lake').setMesh(doc.createMesh('Lake').addPrimitive(doc.createPrimitive().setAttribute('POSITION',accessor('water positions','VEC3',new Float32Array(wp.array))).setAttribute('NORMAL',accessor('water normals','VEC3',new Float32Array(wn.array))).setIndices(accessor('water indices','SCALAR',new Uint16Array(water.index.array))).setMaterial(waterMaterial))));
await Promise.all([MeshoptEncoder.ready,MeshoptDecoder.ready]);
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.encoder':MeshoptEncoder,'meshopt.decoder':MeshoptDecoder});
// Save an uncompressed scratch copy for independent QA.
if(process.env.SCENE_QA_PATH) await io.write(process.env.SCENE_QA_PATH,doc);
await doc.transform(weld(),dedup(),prune(),meshopt({encoder:MeshoptEncoder,level:'high'}));
await io.write(new URL('valley.glb',out).pathname,doc);
const report={provider:'Kenney Nature Kit 2.1',source:'https://kenney.nl/assets/nature-kit',license:'CC0-1.0',models:[...sources].sort(),bytes:(await fs.stat(new URL('valley.glb',out))).size,triangles:positions.length/9+40,meshDraws:2,textures:0};
await fs.writeFile(new URL('manifest.json',out),JSON.stringify(report,null,2)+'\n');
await fs.copyFile(path.join(source,'License.txt'),new URL('License.txt',out));
console.log(JSON.stringify(report,null,2));
