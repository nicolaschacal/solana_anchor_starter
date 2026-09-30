# Rebyters 3D assets

Design Lab no longer generates character anatomy from Three.js primitives.

Final character pipeline:

1. Approve the 2D turnaround/concept.
2. Author a dedicated low-poly mesh from that concept.
3. UV unwrap the mesh.
4. Paint one small texture atlas (target: 128x128 or 256x256).
5. Add the minimal rig and named animation clips.
6. Export one optimized binary GLB.
7. Preview the exact GLB in Design Lab.
8. After approval, upload that same GLB to Irys and store its URI in the Rebyter asset metadata.

## Fangbit contract

Place the authored file at:

`app/public/models/fangbit.glb`

Recommended first-pass budget:

- 250–500 triangles
- 1 material
- 1 texture atlas, 256x256 maximum for the first production pass
- no normal/roughness/metallic texture maps unless a later design truly needs them
- minimal bones/pivots only for parts that animate
- animation clip named `Idle` (Design Lab will use the first clip as fallback)

The viewer intentionally does not contain fallback procedural geometry. If the GLB is absent, Design Lab displays the asset slot instead of silently showing a different interpretation of Fangbit.
