# Design Lab — rigged asset workshop

Implemented 2026-10-03. Route: `/admin/design-lab`. Uses the existing registry-authority gate. This workshop changes visual assets, not Solana instructions or evolution rules.

## Run in the existing Codespace

From repository root, on main with a clean working tree:

```sh
git pull --ff-only origin main
npm --prefix app ci
npm run dev
```

If Vite is already running, stop it before installing and restart afterward. Open port 5173 and append `/admin/design-lab`. Repository updates do not automatically sync into an already-running Codespace. Connect the registry authority wallet.

## Workflow

1. Select the exact species in the current atlas, or open Design Lab from its pencil editor.
2. Import a self-contained rigged GLB under 50 MB. PNG/JPEG/WebP embedded textures supported. Meshopt and Draco decoding are included; KTX2 authoring is not supported in this release.
3. Map body/head/tail and optional leg joints. Unique head/spine/tail names are suggested; ambiguous names require manual selection. Check local rotation axis and direction. Show skeleton to inspect, then test each action.
4. Adjust intensity/speed. Starter clips: `idle`, `feed`, `play`, `train`, `care`. Existing clips with other names are retained. Same-name game clips are replaced by workshop clips. No promise of automatic gait, foot contact, facial animation or compatibility across arbitrary rigs.
5. Prepare optimized GLB: export actual keyframe clips, resize textures to 256/512/1024, deduplicate/prune/resample, quantize/compress with Meshopt. Topology/skin weights are not deliberately simplified. PNG preserves alpha/data maps. Size may exceed 300 KB, which is a target rather than a forced cap.
6. The compressed GLB is reparsed and checked for game clips. Review this model using the optimized toggle, including all actions. Capture a 512×512 PNG thumbnail using the current camera, in rest pose with helpers hidden. Download GLB and thumbnail if desired.
7. Save project retains source bytes, rig map, settings, optimized bytes, thumbnail and upload receipts in IndexedDB, scoped by RPC/program/wallet/family/species. Settings edits require Save project; import and preparation save automatically. Restore project is explicit and does not silently overwrite work. Browser storage is not cross-device backup; retain original GLBs.
8. Upload & attach publishes model, thumbnail and metadata through the existing devnet-only Irys uploader. Metadata includes `image`, `animation_url` and typed files. Checkpoints retain successful receipts so a retry can resume. Changing motion invalidates the prepared bundle; recapturing a thumbnail keeps only the reusable model receipt.
9. Only after the complete bundle succeeds, merge asset URIs into the exact species of the shared atlas draft. Preserve other edits, reject stale and partially published drafts. Both top-level `modelUri` and `assets.modelUri` are written.
10. Open Atlas and Publish the draft with the existing wallet flow. Only then do players receive the new content. No private keys or wallet signatures are available to the coding agent; actual Irys uploads and on-chain publication are performed by the administrator in the app.

## Runtime

The home viewer and selected atlas lineage load GLB when present, falling back to the existing sprite on load failure. Atlas grid cards keep thumbnails, avoiding dozens of WebGL contexts. Successful Feed/Play/Train/Care transactions trigger the corresponding visual action. Render pauses when hidden/offscreen; resources are released on model changes.

Rest is a presentation effect: lights go out, the monster is concealed and a sleep indicator appears. It calls the existing rest instruction. On success the user can turn the lights on; on rejection the overlay closes. It does not invent an on-chain sleeping flag, duration or wake instruction. Design Lab has a Rest preview but exports no sleep clip.

## Validation and limits

- TypeScript and production build checked.
- Unit tests cover loop endpoints against the original rest pose, duplicate mappings, asset-only draft merging, stale drafts and resumable uploads/3D metadata.
- Chromium test with a synthetic skinned model: import, texture resize, clip export, Meshopt roundtrip, rest preview, IndexedDB restore, GLB download and desktop/mobile layout.
- The actual Caniform GLB was not provided. Real deformation quality, arbitrary Meshy rigs and iPhone/WebView performance still need verification with that file/device.
- No real wallet-funded Irys upload or on-chain publish was executed in development.
- Existing unrelated test failure: `publish recovery > rejects replacement collections that reuse prior identities before upload` in `src/lib/rebyters/publish.test.ts` (expects `fresh reserved IDs`, receives `Version already exists with different content`). Its implementation and test are unchanged.

## Next iteration

Use the actual Caniform to calibrate body/head/tail axes, movement amplitudes and camera. Add anatomy-specific presets only after testing additional real rigs. Facial controls, retargeting, gait/foot IK and animated food remain future work.

## Reviewed mammal.exe pilot (2026-10-03)

The owner assigned the supplied `Meshy_AI_Character_output.glb` to **mammal.exe**, not Caniform. The bundled pilot is `app/public/assets/rebyters/mesh-pilot/companion.glb`:

- Original: 21,902,392 bytes. Animated export: **172,320 bytes**, below a strict 300,000-byte budget.
- 1,039 triangles, 22 skin joints, one material. Both original maps were 4096×4096.
- Color: 512px opaque JPEG, quality 88, 4:4:4. Metallic/roughness: 128px lossless PNG. Meshopt geometry and animation compression.
- Embedded clips: `idle` (4s), `feed`, `play`, `train`, `care` (2.4s), `touch` (1.2s). All return to their starting pose.
- The imported rig has no useful jaw or eyelid weights. Feeding uses a body nod; no chewing or blinking is claimed. Ear and leg motions use the reviewed joints. Rest remains a screen overlay.

`modelUriFor` selects the published model URI first, with a bundled fallback only for the exact mammal.exe origin. This fallback makes the viewer usable before publication without rewriting the verified atlas or Merkle proofs. Atlas thumbnails use the reviewed image in place of the old bundled mammal placeholder. Other species are unchanged.

A pointer tap must hit the creature. Dragging the camera, tapping empty space, or touching while asleep does not trigger the reaction. The touch clip plays once and returns to idle; it does not create a blockchain transaction. A keyboard-accessible Pet button performs the same action. Existing feed/play/train/care transaction success handlers trigger their matching clips.

### Publish this prepared asset

1. Update the running checkout (`git pull --ff-only origin main`, then restart `npm run dev`).
2. Connect the registry admin wallet. Open `/admin/design-lab`, select **mammal.exe**, and click **Load animated mammal · 172 KB**.
3. Review the clips, check the review box, then **Upload & attach to atlas draft**. Sign the requested wallet operations. The prepared GLB and thumbnail are already included; do not remap or regenerate them.
4. Open the family Atlas and publish its draft. That activates the Irys model/image/metadata URIs for the exact current species ID.

No Irys receipt or on-chain publication is included in this change: the execution environment has no publishing wallet. The browser flow preserves upload checkpoints and rejects stale atlas drafts.

### Reproduce the asset

From `app`, with `sharp` available, run:

```sh
node scripts/assets/prepare-meshy-pilot.mjs /path/to/Meshy_AI_Character_output.glb public/assets/rebyters/mesh-pilot/companion.glb
```

This script is specific to the reviewed rig; it is not a generic auto-rigger. It preserves the source file and aborts if the output exceeds 300,000 bytes. The original upload is not stored in Git.
