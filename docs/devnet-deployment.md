# Devnet deployment

Published on 2026-09-29. One Anchor program, one RegistryRoot, active Mammal v3. Development content; no gameplay or NFTs.

## Active collection: Mammal Chart v2

The new Excel has 58 forms and 85 edges. The user confirmed all 58 should be used. All prior forms are excluded from the active collection. IDs 96-153 are fresh reservations; `mammal.exe` is the single BIT origin. The workbook revision is v2, while its new immutable on-chain account is v3.

| Item | Public value |
|---|---|
| Active PDA | `CWotQb28TKJF1NwQ6tdzvapQd6b6iCxBSXxxfPwSVuB1` |
| Merkle root | `6b8c8339e1c817bf03814c56e79513b85008d1ba553dc9388bd786e65b22fb9a` |
| Content hash | `c07a31b03c48f433970d7ecaa16bc41ad459163a3a41e077794b0d132d2c62ba` |
| Forms by stage | BIT 1 / BYTE 4 / KYLO 12 / MEGA 22 / GIGA 13 / TERA 6 |

[Active Irys JSON](https://gateway.irys.xyz/Ezq4kowCxAFH8S4eCgwn4EcCHNYsTDVHEQpcUCPmMWQf)

[Active PDA explorer](https://explorer.solana.com/address/CWotQb28TKJF1NwQ6tdzvapQd6b6iCxBSXxxfPwSVuB1?cluster=devnet)

- Reserve IDs: `2bcGk2turjyTBUWpJ1mMjxus6wxeiQztWjzCYK11zSnbFqjb4rkyCK9WDtpmi3a9Q6qK1v9L7xMhfF6c5PD21V5R`
- Create PDA: `5DFU7i3Zwd9NGHA9tnXvUxQ7PoyzoJpUtWzu1DKE4vZ3RpcG2n957Qd3jR6BQHRuQS9yiMWE6tabfiQTN6Ce7dzm`
- Activate: `4qXZgq2ieyMFNraWe71NvZGRJaHXAETktNtMu23FEe5fnsR7PAt3PoPGWRf5pGaFYFDnLtaKuCdBD9GxdibR3jNH`

The CLI verified the uploaded content, created the PDA, activated it, confirmed the registry pointer, then downloaded and verified the content again. Public artifacts: `artifacts/publication/mammal-chart-v2.json` and `mammal-chart-v2-report.json`. Resume with `npm run publish:workbook`; its journal is `mammal-chart-v2-pending.json`. Replacement publications require fresh IDs; ordinary edits still preserve identities. Historical accounts remain unchanged.

Local atlas for this revision: http://localhost:5174/admin. Start with `npm run dev -- --port 5174` in `app/`. Browser checks: `node --import tsx scripts/browser-check.ts --live`.

## Historical v2 deployment

| Item | Public value |
|---|---|
| Program | `7AnfhSTGK11PUqep6wdfkCcSuwhAsaU4RwYfDGdcWyfp` |
| Authority wallet | `AQfKYtAVyZARgKxSt6ZpqwLAtDNeE1LF8Jk5FYWteqbv` |
| RegistryRoot | `EUyxmiAzboxWddes71PfDGAvr6Yd7tMXWzkQXYFirqNX` |
| Active Mammal v2 PDA | `BsjgB3f8th8vj5pEzE3jsTaYCUwK68kHo2DJw785yAte` |
| v2 Merkle root | `53e392d456d4bd763e58c995dd841fcc180b96eb2fca5824ec2567fd585b3499` |
| v2 content hash | `c736ee11ed5b644596c7cc43670bd466f0154b470cfd483be3aa8d273f01905e` |
| Enabled workbook forms | `89` (IDs `7-95`) |
| Retained v1 identities | `6` disabled records (IDs `1-6`) |

[Immutable Mammal v2 JSON](https://gateway.irys.xyz/7zv2p9pXZzxg99LTSFaiqD2ToNdurCq91FBEjq1nC5Tw)

[Rollback Mammal v1 JSON](https://gateway.irys.xyz/CU7kV1W1iJs8wxFCEFXF1oFZ1g6sUDALNmhWTxsujQFp)

[Program explorer](https://explorer.solana.com/address/7AnfhSTGK11PUqep6wdfkCcSuwhAsaU4RwYfDGdcWyfp?cluster=devnet)

[Private Codespaces dashboard](https://scaling-acorn-vg67p9454v63p54q-5173.app.github.dev/admin)

Local URL: http://localhost:5173/admin. Run `npm run dev` from the repository root. Codespaces port 5173 is forwarded privately; keep the dev server running.

The wallet file is `artifacts/private/admin-keypair.json`, excluded from Git, mode 0600, and explicitly blocked by Vite. This file is not a browser asset. Fund this address only with devnet SOL for this prototype. Import the development key using your wallet's supported secure workflow, or transfer registry authority to your existing browser wallet, to access write controls.

## Transaction receipts

- Initialize registry: `5BiratZfibRaNecEvtnXXXyvcncANvGVhr7q2ohcEMdRfw9YGtsMZgVTsAc4LrkGbxj43pMxFtDvMKw31iiYT164`
- Reserve IDs 1-6: `2WVZ8NvjnR55bvsKNydnqjJuk2Ha7B3CJnoFfv61wj36Z1pc9G3zvdbt69QanvVMUtfA5LoHvyBdbAmujqRTuC4G`
- Create Mammal v1: `5ZvDakAgEXsqSCXUZnDWCpbBDfanTksZ4i2kJake21YiyE2zk8bbTp6epJ8Rta51GUeteydMrUiTahsGBrMd2xmm`
- Activate Mammal v1: `3rFKHV2sxiX1gcnhU9EMgVhm9pTiSGG16CU3qPXm1qRBcMAmoJTJWmRpyC8uVbj869wzA3Apc7cBWnetgJ6dKTLf`
- Reserve workbook IDs 7-95: `61NeHQorv1YxrtqURoz6Jp2hQtMtV1DVscfZC5zKzPJcWcJ6dTBD7cSHMpHzAqdPXpsb7mTVbUibdRY9wn4Tjdp3`
- Create Mammal v2: `43KfamPMaRSMMqU2xK1n2AkFyZ167N1tdevucK3DxWCt9buKo8TEPRuBMxkDd463ANxaN8GuHyruhcja79ki6m8G`
- Activate Mammal v2: `5q5UrB198w4WNTN2tgWzZt6LJvQyaygvFqPC8z69MoRNFuVHcNtH8jV9XuXeYpE3AaMWXFteHBcrKn3edhyfg5qg`

The CLI confirmed the active registry pointer, downloaded the Irys object and verified both stored commitments. The v1 machine-readable report remains at `artifacts/publication/report.json`; v2 is at `artifacts/publication/mammal-workbook-v2-report.json`. IDs 1-6 remain reserved and named Kitten, Cat, Lion, Tiger, Leopard and Sabertooth; v2 disables them without deleting their identities.

## Next publication

Connect the authority wallet, open the active Mammal tree and edit a form. Add Evolution reserves a new ID automatically. Publish v3 creates a new immutable Irys object and PDA and activates it only after upload verification. Stored versions keeps v1 and v2 available for rollback. Activating an older version switches the active pointer; closing a version requires confirmation and permanently removes that rollback candidate.

No funding or credential blocker remained for this deployment. Irys devnet is a test environment with limited retention; immutable does not mean permanent availability on devnet. Content integrity failures are shown explicitly. See README for the prototype's trusted-authority and future identity-retention limitations.

## Mammal workbook migration

Completed on 2026-09-29. Mammal v2 contains the 89 workbook evolutions (IDs 7-95) and retains the six v1 identities as disabled, pathless records. v1 remains available for rollback.

To repeat or resume the migration command, run `npm run publish:workbook` from `app/`. It uses the protected authority keypair and a separate journal at `artifacts/publication/mammal-workbook-pending.json`; it does not overwrite the original v1 journal or report. The script verifies the Irys object before creating and activating the new tree PDA. Re-running after successful publication is idempotent.
