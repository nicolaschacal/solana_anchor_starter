# Kenney low-poly valley

The player and guest worlds load `/assets/environments/kenney-valley/valley.glb`.
The habitat uses nine models from [Kenney Nature Kit](https://kenney.nl/assets/nature-kit),
published under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).
The original license is retained beside the GLB. The clearing, lake, mountains,
water ribbons and small arch are original scene assembly geometry.

The shipped scene contains two mesh primitives, no textures, no external files,
no animations and no real-time water reflections. Vertex colors and Meshopt
compression keep the environment small. Exact counts and download size are in
`app/public/assets/environments/kenney-valley/manifest.json`.

`meadow.ts` loads one cached compressed download, parses separate resources for
mounted viewers, and releases those resources when a view unmounts. A small
clearing remains visible if the asset cannot load. The existing UTC world clock
selects morning/day/evening/night skies, fog, sun/moon and directional lighting;
the viewer also adjusts ambient lighting for evening and night. Creature assets,
interactions and UI are unchanged.

To reproduce: download and extract the free Nature Kit ZIP from the source page,
then run from `app/`:

```sh
node scripts/assets/build-kenney-valley.mjs /path/to/extracted/nature-kit
```

The build script grades turquoise foliage toward green, recolors rock surfaces,
assembles and batches the selected geometry, and compresses the result. Set
`SCENE_QA_PATH` to export an additional uncompressed GLB for inspecting geometry.

Validation: production build, TypeScript, lint on changed TypeScript files, three
lifecycle tests (shared download/independent disposal, late load, network retry),
and offline inspection of the assembled geometry from mobile and desktop cameras.
This does not constitute device frame-rate benchmarking.
