# Rebyters Gameplay Architecture

This document is the canonical gameplay baseline for the current Rebyters generation.

There is **no DNA schema byte and no backward-compatibility path**. The program and frontend always expect the current 50-byte layout. Development mints from previous layouts are intentionally ignored/burned/reminted.

## Product principles

1. A Rebyter is a Token-2022 1/1 mint.
2. Persistent gameplay state lives in the mint's TokenMetadata `DNA` field.
3. Evolution identity comes from how the player raises the Rebyter: diet, daily rhythm, body weight, training and care.
4. There are no genetics/predisposition fields.
5. There is no total-interaction counter and no DNA birth timestamp.
6. Fullness and Energy remain passive/lazy systems using `lastStateAt`; no server or cron is required.
7. `stageEnteredAt` powers short evolution timers capped at 60 minutes.
8. `careMistakes` records poor care during the current form and resets on evolution.
9. Sick/Injured/Tired/Overfed remain temporary gameplay states, but are not generic evolution gates.
10. The active unified Atlas is the source of truth for evolution rules.

## Current 50-byte DNA layout

The base58-encoded DNA payload contains no version byte.

| Offset | Bytes | Field | Type |
|---|---:|---|---|
| 0 | 2 | evolutionId | u16 |
| 2 | 1 | weight | u8 |
| 3 | 1 | bond | u8 |
| 4 | 1 | discipline | u8 |
| 5 | 1 | careMistakes | u8 |
| 6 | 1 | fullness | u8 |
| 7 | 1 | energy | u8 |
| 8 | 1 | condition | u8 bitfield |
| 9 | 8 | diet | [u16;4] meat, plant, fish, fruit |
| 17 | 8 | timeInteractions | [u16;4] night, morning, day, evening |
| 25 | 1 | cycle | u8 |
| 26 | 2 | hp | u16 |
| 28 | 2 | atk | u16 |
| 30 | 2 | def | u16 |
| 32 | 2 | spd | u16 |
| 34 | 4 | lastStateAt | u32 |
| 38 | 4 | stageEnteredAt | u32 |
| 42 | 8 | learnedSkills | u64 |

Total: **50 bytes**.

## Passive state

`lastStateAt` exists only to materialize passive state without a background service.

For each whole hour since the last authoritative state update:
- Fullness -2
- Energy +3

Temporary conditions are then resolved:
- Overfed clears when Fullness <= 80
- Tired clears when Energy >= 40
- prolonged zero Fullness can set Sick

The browser mirrors the same calculation for display; the program is authoritative on transactions.

## Care mistakes

`careMistakes` starts at 0 and resets to 0 whenever the Rebyter evolves.

Examples that can add a mistake:
- repeated overfeeding;
- forcing Play while depleted;
- training with no effective energy / severe overtraining;
- allowing prolonged starvation to make the Rebyter Sick.

Care and Rest are recovery actions and do not themselves add care mistakes.

A later evolution can require, for example, `Care mistakes <= 2`.

## Evolution timer

The timer is intentionally short and is shown separately from route identity requirements:

| Target stage | Minimum time in current form |
|---|---:|
| BYTE | 1 min |
| KYLO | 10 min |
| MEGA | 20 min |
| GIGA | 40 min |
| TERA | 60 min |

No evolution timer exceeds one hour.

## Evolution identity

Diet/time counters and care mistakes reset when the Rebyter evolves, so each form is raised as a new stage. The player-facing Lab does not show raw percentages or internal thresholds.

A route reads like:

- +Meat
- +Nocturnal
- Speed ++
- Bond ++
- Light weight
- Care mistakes <= 2

Internally, diet and time-of-day are derived from their four counters as percentages so the program can verify a dominant tendency. The UI only exposes the semantic requirement.

`+`, `++`, and `+++` represent progressively higher preset bands for trainable/care stats.

## Physiology-driven Mammal Atlas

The Mammal Atlas contains 58 forms and 85 routes. Requirements are authored from the target form's biological/archetypal identity rather than pseudo-random distribution.

Examples:
- Wolf: meat, nocturnal, medium body, speed, bond.
- Bear: fruit/omnivore proxy, evening activity, heavy body, defense, discipline.
- Dolphin: fish, diurnal, medium body, speed, high bond.
- Elephant: vegetables, diurnal, very heavy body, defense, high bond.
- Bat: fruit proxy, nocturnal, light body, speed.
- Deer: vegetables, early-bird, light body, speed, bond.
- Seal: fish, evening, heavy body, defense, bond.
- Whale: fish, diurnal, very heavy body, HP, bond.

Fantasy forms inherit and intensify the identity of their source archetype.

## Actions

Available player actions remain:
- Feed
- Play
- Train
- Care
- Rest

Food types:
- meat
- plants
- fish
- fruit

Training machines:
- Power
- Endurance
- Defense
- Speed
- Combat
- Balanced

There are no cooldowns. Poor repetition is handled through Energy, Fullness, conditions, Discipline, Bond and care mistakes.

## Skills

`learnedSkills` remains a u64 bitset so the current layout can support up to 64 persistent skills without another migration when battle is added.

## Publication model

The current generation uses fresh evolution IDs. No old gameplay identity is preserved.

The dedicated publisher:
- reads the active Mammal Atlas only to reuse already-uploaded image/metadata/model URIs by form key;
- reserves 58 fresh IDs;
- builds the current physiology-authored Atlas;
- uploads immutable JSON to Irys;
- creates and activates the new tree.

Use:

```sh
npm run publish:current
```

## Deployment checklist

```sh
git pull origin main

anchor build
cp target/idl/solana_anchor_starter.json app/src/idl/solana_anchor_starter.json

cd app
npm run typecheck
npm run build
cd ..

anchor deploy --provider.cluster devnet --provider.wallet artifacts/private/admin-keypair.json
npm run publish:current
```

After publication, mint a new Rebyter. Previous-layout mints are not supported.
