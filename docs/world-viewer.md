# Grounded game viewer

The player Home uses a procedural grassy ground with a continuous horizon, low-poly hills, contact shadow, and time-dependent sky/lighting. Night includes moon and stars. The Design Lab keeps its workshop platform. The camera preserves a fixed elevation, disables pan and zoom, and permits horizontal orbit only. Responsive framing fits the creature to approximately 70% of the portrait width.

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
- **Mobile.** Phones render at pixel ratio 1 and load 8 of the 11 props with fewer tiles and motes. The login scene releases its WebGL context when it unmounts.
- **Asset budget.** All 14 environment GLBs total about 1 MB (about 65-90 KB each): 128-256 px WebP colour map, no metallic-roughness map, quantized + Meshopt geometry. Regenerate with `node scripts/assets/optimize-environment.mjs`.
- **Never ship raw Meshy exports.** They carry two 4096x4096 PNG textures (about 21 MB per model) that exhaust GPU memory on phones. Optimize first, then place the result in `app/public/assets/environment/`.
- **GLB padding.** `node scripts/assets/fix-glb-json-padding.mjs FILE.glb` repairs GLBs whose JSON chunk is padded with NUL bytes; three.js rejects those without a visible error in the scene.
