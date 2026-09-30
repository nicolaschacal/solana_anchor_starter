# Rebyters admin content prototype

One Solana program, one React client. `programs/solana_anchor_starter/` is the **only on-chain program**. `app/` is the browser dashboard and command-line publishing client, not another Solana program. No backend/database or gameplay is included.

Mammal Chart v2 is active as on-chain **version 3**: 58 new creatures, 85 connections, one BIT origin (`mammal.exe`). It replaces the old collection completely. See [deployment addresses and receipts](docs/devnet-deployment.md).

The dashboard opens into a responsive collection grouped by BIT, BYTE, KYLO, MEGA, GIGA and TERA. Desktop shows multiple specimens per row; mobile starts at BIT with stage filters and an All option. Stage filters survive a visit to a specimen's lineage, and search spans all stages. Selecting a specimen shows its immediate predecessors and successors. The connection map remains an alternative view with pan, zoom and origin centering. Local concept sprites follow the workbook's body plans; supplied image assets take precedence. Detailed records and publication data are collapsible.

Workbook source: `../Rebyters_Mammal_EXE_Evolution_Graph_v2.xlsx`. Reimport with `python scripts/import-mammal-workbook.py` from `app/`. The workbook contains qualitative evolution rules; these are retained verbatim as `designRule`. Numeric eligibility thresholds are intentionally not invented, and this development dataset is not a gameplay eligibility engine.

## Local dashboard

```sh
cd app
npm ci
npm run dev
```

Open http://localhost:5173/admin. From the repository root, `npm run dev` also works after installing app dependencies. Codespaces: forward port 5173 in the Ports tab. The sample at `/admin/families/0?sample=1` is explicitly LOCAL / UNPUBLISHED; it remains usable without a wallet or working RPC. It never receives a Solana verification badge. Connect a devnet browser wallet to read the registry and, if authorized, edit/publish.

## Wallet and devnet deployment

The generated development keypair is `artifacts/private/admin-keypair.json`, mode 0600, ignored by Git. Its public address is `AQfKYtAVyZARgKxSt6ZpqwLAtDNeE1LF8Jk5FYWteqbv`. Fund it with **devnet SOL**, not mainnet SOL. Never expose its JSON through Vite or a public URL. The separate ignored `target/deploy/solana_anchor_starter-keypair.json` is the program deployment identity, not a second program or the funding wallet.

```sh
solana balance --url devnet --keypair artifacts/private/admin-keypair.json
anchor build
anchor deploy --provider.cluster devnet --provider.wallet artifacts/private/admin-keypair.json
cp target/idl/solana_anchor_starter.json app/src/idl/solana_anchor_starter.json
cd app
npm run publish:sample
```

If `anchor`'s AVM wrapper is unavailable in a restricted shell, the installed binary is `/home/codespace/.avm/bin/anchor-1.2.0`. The deployer must be funded before deployment. The sample command uses the generated wallet by default, reserves IDs, uploads to Irys devnet, registers/activates the tree, downloads it again, verifies both hashes, and saves public receipts in `artifacts/publication/`. `SOLANA_WALLET_PATH`, `IRYS_WALLET_PATH`, `SOLANA_RPC_URL`, and `IRYS_GATEWAY` override defaults. Export these variables in your shell; `.env.example` documents them. No private key is put in a `VITE_` variable. The script refuses non-devnet genesis hashes.

For browser authority actions, securely import this development keypair into a compatible wallet using that wallet's supported import workflow, or transfer registry authority to an existing browser wallet. The browser never loads the local secret automatically. Irys uploads require message signing as well as Solana transaction signing. Irys devnet data is test data and should not be assumed permanent; each publication is a new immutable object while retained by that network.

## Content workflow

From Mammal, select an evolution and expand Specimen data to edit fields, paths and grouped requirements. IDs are read-only. Add Evolution reserves one globally unique ID on-chain; abandoning an edit consumes that ID permanently. Preparing the workbook reserves 58 new IDs. Discard only removes local drafts. Sample preview IDs are illustrative and cannot be published through the sample view.

Publish validates the draft, uploads new canonical JSON, verifies the upload, creates the tiny tree PDA, activates it, confirms the registry and verifies downloaded content again. Upload receipts are saved in localStorage and reused if the unchanged draft is retried. Stale versions fail without overwriting anything. A retry refetches the registry first, including after ambiguous activation confirmation. Previous trees remain intact. Stored versions offers Activate for rollback and a separately confirmed Close action that recovers rent and permanently removes that rollback candidate. The explicit workbook replacement mode starts a fresh collection with disjoint IDs; normal edits continue to enforce identity compatibility.

## Program and trust boundary

Anchor 1.2.0, Solana CLI 4.1.2 and Rust 1.98.1 were preserved. RegistryRoot is 172 bytes including discriminator. EvolutionTree is 215 bytes including discriminator. Registry seed: `[b"registry"]`; tree seeds: `[b"tree", one-byte family ID, little-endian u32 version]`. Family IDs 0-7 are supported, 8-15 reserved. URI capacity is 128 UTF-8 bytes, HTTPS only. Versions start at 1 and never reuse closed addresses. IDs start at 1, max 65535; u32 next-ID counter represents exhaustion at 65536.

Bootstrap verifies the actual upgradeable-loader ProgramData PDA, owner, discriminator and upgrade authority; a random first caller cannot initialize. All later writes require the stored registry authority. Trees have no edit instruction. Six instructions: initialize_registry, reserve_evolution_ids, create_tree, activate_tree, close_tree, set_authority. Closing an active tree is forbidden. No token dependencies are added to Rust; Irys has indirect JS SPL dependencies, but no minting is implemented.

The on-chain program authenticates publication metadata, not JSON semantics. It cannot fetch Irys. The admin is trusted to publish correctly; the client rejects duplicate IDs and invalid rules and protects identities relative to its active base version. A malicious authority can bypass those client checks. A global counter guarantees unique *reservations*, not permanent cross-version identity semantics in arbitrary uploaded JSON. Rollback may omit newer identities and closing newer metadata may remove their discovery path. Before gameplay, define identity retention and the version used to resolve existing creatures; this prototype intentionally does not add a historical catalogue. Merkle verification authenticates bytes, not the truth or safety of the contained rules.

## Canonical JSON and proofs

See [docs/content-format.md](docs/content-format.md). `artifacts/sample/` contains local sample JSON, exact hashes, PDAs and a TypeScript-generated proof fixture verified by Rust. Local fixture hashes are not evidence of a live upload or on-chain publication.

## Checks

```sh
cd app
npm run sample
npm run lint
npm run typecheck
npm test
npm run build
cd ..
cargo fmt --check
cargo check
anchor build
cargo test
```

The LiteSVM integration tests load the compiled SBF artifact; build before running them. `npm run sample` regenerates the cross-language fixture before Rust compilation. No paid hosting is configured.
