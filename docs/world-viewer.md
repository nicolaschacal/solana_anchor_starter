# Grounded game viewer

The player Home uses a procedural grassy ground with a continuous horizon, low-poly hills, contact shadow, and time-dependent sky/lighting. Night includes moon and stars. The Design Lab keeps its workshop platform. The camera preserves a fixed elevation, disables pan and zoom, and locks both horizontal and vertical orbit. Responsive framing fits the creature to approximately 70% of the portrait width.

The HUD clock replaces the compact bond badge; bond remains in the status details. All times are UTC, matching `utc_time_bucket` in the program: Night 00–06, Morning 06–12, Day 12–18, Evening 18–24.

`useWorldClock` reads the Solana Clock sysvar using one `getAccountInfo` request per RPC endpoint per page session. The shared promise deduplicates React StrictMode mounts and later navigation. The Unix timestamp at byte offset 32 anchors a local monotonic clock; a local one-second timer updates the UI without RPC polling. A full browser reload synchronizes again. If synchronization fails, the HUD identifies its local UTC estimate; it does not repeatedly retry. This is a visual/UI estimate, never an authoritative replacement for on-chain validation.

The growth card retains its original non-clickable layout, colors and progress behavior. Only the completed-timer label changes from “Time requirement met” to the subtle “Ready to evolve!”. This label reflects the timer only; full route eligibility is still checked in the evolution Lab and on-chain. The separate evolution-ready button remains removed.

No GLB or Irys asset is changed by this frontend update. The existing six clips still play on the ground. The current asset does not include a walk cycle, so no fake sliding or autonomous walking is introduced.

Validation: production build, clock UTC boundary/failure/request-deduplication tests, existing asset tests, and real-browser portrait inspection of day/night scenes.

## Controls and persistent companion

Home and Lab share a selected mint stored locally per wallet and RPC endpoint. Explicit selections survive navigation/reloads and reordered interaction refreshes. While ownership is incomplete, the UI does not substitute the first creature for a missing selected mint. Once a completed ownership response confirms the selected mint is absent, it may display an available companion instead. Local storage failure retains explicit selection in memory for the session.

The petting instruction is visually hidden, while tapping the creature and a keyboard-focusable accessible control still work. Mobile navigation and the action row share 14px side margins, 62px controls, 16px radii, icon treatment, borders and a blue palette. Active navigation is distinguished by a brighter fill and border. Browser measurements verified identical outer widths at 375px and 440px viewports.

## Meadow scene, wind and mobile budget

The same `meadow()` composition is used by the signed-out login scene (`GuestWorld`) and by the companion scene (`AssetViewer` with `landscape`).

- **Wind.** Trees, pines and berry bushes bend in the vertex shader, weighted by height so trunks stay planted, plus a few pollen/dust motes drifting with the breeze. No extra render loop or draw calls. `prefers-reduced-motion` lowers sway to 30% and hides the motes.
- **Shared cache.** Each environment GLB is downloaded, decoded and uploaded once per page; the login scene, the companion scene and day/night changes reuse it. Cached assets are never disposed by a scene.
- **Mobile.** Phones render at pixel ratio 1, reuse the same cached props as desktop, and reduce woodland repeats, instanced grass and motes. The login scene releases its WebGL context when it unmounts.
- **Asset budget.** All 14 environment GLBs total about 1 MB (about 65-90 KB each): 128-256 px WebP colour map, no metallic-roughness map, quantized + Meshopt geometry. Regenerate with `node scripts/assets/optimize-environment.mjs`.
- **Never ship raw Meshy exports.** They carry two 4096x4096 PNG textures (about 21 MB per model) that exhaust GPU memory on phones. Optimize first, then place the result in `app/public/assets/environment/`.
- **GLB padding.** `node scripts/assets/fix-glb-json-padding.mjs FILE.glb` repairs GLBs whose JSON chunk is padded with NUL bytes; three.js rejects those without a visible error in the scene.

## Layered lakeside composition

The fixed-camera habitat has foreground bushes, stones, mushrooms and instanced flowers; an open companion clearing; asymmetric tree framing; a winding trail and animated lake; a wooded far bank; and three overlapping mountain silhouettes. Clouds, foliage, narrow grass blades, water ripples and airborne motes use the existing animation loop. The camera pulls back in landscape view to keep the companion grounded and fully visible.

Imported props are normalized inside a separate pivot before placement and rotation. Mountain depth is constrained to keep the model's terrain apron behind the lake. Fog begins behind the near woodland and gradually separates the distant ridges. Mobile uses the same scene structure with fewer repeated plants. Scene disposal releases procedural meshes, instanced buffers and cloned mountain materials while preserving cached GLB resources.

No additional asset is required. An optional low-poly ruined tower or stone arch on the far bank would add a landmark resembling the reference; export it with a ground-level pivot and optimize it before use.


## Painted grass and moonlit habitat

The lawn now combines a seamless 512px canvas-painted texture (one tile per 3m) with 950 mobile / 1,800 desktop instanced tufts. Each tuft uses two alpha-cutout cards carrying curved painted leaves, with upward shading and a height-weighted breeze. Textures are cached across scenes and period changes; no extra GLBs or network texture downloads are needed.

The playable clearing and lake basin stay flat through a radius of 28m, so the terrain cannot cover the water. The lake uses analytic wave normals, Fresnel sky color and broken highlights forming a moonlight path. The overlapping shore tile is removed. Clouds use three cached 256×128 painted sprites behind the mountains; the moon has subtle surface detail and stars remain depth-tested.

Night uses a higher moonlight angle, soft warm frontal fill, cyan edge light, blue atmospheric separation and neutral tone mapping. One 512px mobile / 1024px desktop shadow map is refreshed only when the scenery is assembled or the period changes. Animated creatures use the existing contact shadow rather than entering the static shadow map. Terrain and near props receive the scenery shadows.

Implementation is in `habitat-materials.ts`, `habitat-lighting.ts`, `meadow.ts` and the shared viewer. Existing animation, training and account logic is retained. Real-device frame timing and visual comparison still require a browser review; a successful Vercel build checks TypeScript and bundling, not WebGL shader rendering.

## Habitat Editor (admin)

`/admin/habitat-editor` is a diorama builder. It starts with an empty block of earth (4×4, 8×8 or 16×16 tiles of 1 m) lit and skied like the game, with the real `mammal.exe` standing on one tile in the middle. The creature GLB is loaded from the Irys URI published in the atlas, never from a bundled file. "Ver escena de prueba" opens the game's own `meadow()` scene (read-only) to compare.

Views: panorámica and móvil (perspective) and cenital (orthographic), one or all three. Tools (single-letter shortcuts): Seleccionar (V), Relieve (R), Agua (A), Suelo (G), Pasto alto (P), Objetos (O), Borrar (E), Cámara (H). A toolbox on the left, the options of the active tool on the right, scene size, undo/redo, export/import and views on top, and a lighting popover ("Luz") with period presets and sliders for sun, ambient, rim, brightness, warmth, sun azimuth/elevation and shadows.

Rules: the creature and every solid prop occupy exactly one tile. Water cannot cover them and they cannot stand on water (reeds and shore rocks excepted); the creature rides the height of its tile. Clicking on the creature's body targets its own tile, so mounds can be raised under it. Tall grass is a brush: tufts (`grass_clump_mobile.glb`) are placed or removed anywhere, and the grass carpet can be taken away per tile. Each diorama size autosaves separately in localStorage; JSON export/import is available.

Code: `components/admin/HabitatEditor.tsx` (UI), `components/admin/habitat/world.ts` (engine), `habitat/tiles.ts` (tile maths and meshes). `meadow()` gained opt-in `props`, `scenery`, `spawn` and `removeProp`; its default game behaviour is unchanged. Rendering was checked in headless Chromium only; review on real devices.
