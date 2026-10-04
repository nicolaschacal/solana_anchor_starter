# Grounded game viewer

The player Home uses a procedural grassy ground with a continuous horizon, low-poly hills, contact shadow, and time-dependent sky/lighting. Night includes moon and stars. The Design Lab keeps its workshop platform. The camera preserves a fixed elevation, disables pan and zoom, and permits horizontal orbit only. Responsive framing fits the creature to approximately 70% of the portrait width.

The HUD clock replaces the compact bond badge; bond remains in the status details. All times are UTC, matching `utc_time_bucket` in the program: Night 00–06, Morning 06–12, Day 12–18, Evening 18–24.

`useWorldClock` reads the Solana Clock sysvar using one `getAccountInfo` request per RPC endpoint per page session. The shared promise deduplicates React StrictMode mounts and later navigation. The Unix timestamp at byte offset 32 anchors a local monotonic clock; a local one-second timer updates the UI without RPC polling. A full browser reload synchronizes again. If synchronization fails, the HUD identifies its local UTC estimate; it does not repeatedly retry. This is a visual/UI estimate, never an authoritative replacement for on-chain validation.

The growth card links to the evolution Lab. It says “Ready to evolve!” only when the existing full eligibility evaluation passes, using the synchronized stage age. The separate evolution-ready button is removed. Merely meeting the timer shows “Growth complete · check traits” if other requirements remain.

No GLB or Irys asset is changed by this frontend update. The existing six clips still play on the ground. The current asset does not include a walk cycle, so no fake sliding or autonomous walking is introduced.

Validation: production build, clock UTC boundary/failure/request-deduplication tests, existing asset tests, and real-browser portrait inspection of day/night scenes.
