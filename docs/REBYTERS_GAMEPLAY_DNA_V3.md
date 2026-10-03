# Rebyters Gameplay Architecture — DNA v3

This document is the canonical gameplay baseline for Rebyters after the DNA v3 redesign.

The implementation intentionally starts a clean generation. DNA v1/v2 Rebyters are not migrated in place. Existing development mints may be burned/ignored and reminted after the DNA v3 program + atlas are deployed.

## Product principles

1. A Rebyter is a persistent Token-2022 1/1 mint.
2. Its current form is identified by `evolutionId`; family, stage and atlas version are not duplicated in DNA.
3. Genetics are predispositions, never free progression.
4. Progress is earned through care, feeding, observed routine, training and time in the current form.
5. There are no interaction cooldowns.
6. Repeating an action is always allowed, but bad repetition changes state and can reduce gains or cause negative conditions.
7. Time-based state uses lazy materialization. Nothing needs to update on-chain every minute.
8. Evolution is verified against the currently active unified atlas selected by the Registry.
9. Skills are persistent individual history and are stored as a 64-bit bitset.
10. Species/evolution-specific natural-trait tables are deliberately not part of this architecture.

## DNA v3 binary layout

DNA v3 is stored in Token-2022 TokenMetadata under the custom `DNA` field as a base58-encoded 60-byte blob.

| Offset | Bytes | Field | Type | Meaning |
|---|---:|---|---|---|
| 0 | 1 | schemaVersion | u8 | Always `3` |
| 1 | 2 | evolutionId | u16 | Current form |
| 3 | 4 | genes | `[u8;4]` | metabolism, temperament, rhythm, mutation |
| 7 | 1 | weight | u8 | Current body weight |
| 8 | 1 | bond | u8 | Long-term relationship, 0-100 |
| 9 | 1 | discipline | u8 | Routine/training discipline, 0-100 |
| 10 | 1 | fullness | u8 | Current satiety, 0-100 |
| 11 | 1 | energy | u8 | Current energy, 0-100 |
| 12 | 1 | condition | u8 bitfield | tired/overfed/sick/injured |
| 13 | 8 | diet | `[u16;4]` | meat, plant, fish, fruit counters |
| 21 | 8 | timeInteractions | `[u16;4]` | night, morning, day, evening UTC |
| 29 | 2 | totalInteractions | u16 | Lifetime gameplay actions |
| 31 | 1 | cycle | u8 | Completed life cycles |
| 32 | 2 | hp | u16 | Health stat |
| 34 | 2 | atk | u16 | Attack stat |
| 36 | 2 | def | u16 | Defense stat |
| 38 | 2 | spd | u16 | Speed stat |
| 40 | 4 | lastStateAt | u32 | Last authoritative state action/materialization; replaces the old lastInteraction role |
| 44 | 4 | stageEnteredAt | u32 | Timestamp when current form was entered |
| 48 | 4 | createdAt | u32 | Birth timestamp |
| 52 | 8 | learnedSkills | u64 | Persistent skill bitset |

Total: **60 bytes**.

## Genetics

DNA v3 has exactly four genes. Each is generated in the range 0-100 at mint.

### Metabolism

Affects passive fullness decay, passive energy recovery and weight gain from food.

Current lazy-state formulas:

- `fullnessLossPerHour = 1 + floor(metabolism / 34)` → 1..3
- `energyRecoveryPerHour = 2 + floor(metabolism / 50)` → 2..4

Metabolism influences how the Rebyter develops; it does not satisfy combat/stat progression by itself.

### Temperament

Affects Bond gains from positive social actions.

Current bonus:

- `temperamentBondBonus = floor(temperament / 50)` → 0..2

### Rhythm

Represents an individual circadian predisposition. It is separate from actual observed behavior.

Actual behavior is recorded independently in `timeInteractions` using UTC buckets:

- 0: night, 00:00-05:59
- 1: morning, 06:00-11:59
- 2: day, 12:00-17:59
- 3: evening, 18:00-23:59

Evolution rules may consider the genetic predisposition and/or observed time distribution, but genetics is never a replacement for earned training.

### Mutation

A permanent individual predisposition for unusual evolution/skill paths. It does not directly grant stats.

## Lazy state

Fullness and Energy do not require background jobs, crons, or automatic transactions.

Whenever a gameplay instruction or evolution check runs:

1. Read `lastStateAt`.
2. Compute whole elapsed hours.
3. Apply fullness decay and passive energy recovery.
4. Resolve time-sensitive condition changes.
5. Store the new materialized state and update `lastStateAt`.

The browser mirrors the same calculation for display, but the program is authoritative whenever a transaction occurs.

Current condition side effects during lazy materialization:

- Overfed clears once Fullness <= 80.
- Tired clears once Energy >= 40.
- If Fullness remains at 0 for at least 12 materialized hours, Sick is set.

## Derived mood / happiness

Happiness is **not** stored as another DNA field. The player UI derives a mood from the current state so it cannot drift out of sync.

Current priority:

- Sick condition → Sick
- Injured → Hurt
- Overfed → Uncomfortable
- Energy < 20 → Exhausted
- Fullness < 20 → Hungry
- otherwise Bond + Energy + Fullness are averaged:
  - >= 75 → Happy
  - >= 50 → Content
  - otherwise → Restless

This gives the Digimon-style happiness feedback without spending permanent bytes or introducing another independently mutable stat.

## Condition bitfield

`condition` uses bit flags:

| Bit | Flag | Meaning |
|---:|---|---|
| 0 | Tired | Energy abuse / exhaustion |
| 1 | Overfed | Excess feeding |
| 2 | Sick | Poor care, starvation or repeated abuse |
| 3 | Injured | Severe overtraining / future battle injuries |

Conditions may coexist.

## No-cooldown rule

There are **no cooldowns** for Feed, Play, Train, Care, Rest, or future Battle.

The user is always allowed to act. Repetition is controlled by consequences:

- overfeeding increases weight, lowers Discipline and can cause Sick;
- playing while depleted stops being positive and can reduce Bond/Discipline;
- training while tired reduces or removes stat gains and can cause Sick/Injured;
- unnecessary Rest gives no stat advantage and can still consume Fullness;
- future battle abuse should consume Energy/HP and increase injury risk.

This is intentionally a virtual-pet model, not a timer-gated app.

## Actions

### Feed

Food types:

0. Meat
1. Plants
2. Fish
3. Fruit

Current base effects:

| Food | Fullness | Base weight |
|---|---:|---:|
| Meat | +22 | +2 |
| Plants | +16 | +1 |
| Fish | +18 | +1 |
| Fruit | +14 | +1 |

All food:
- increments its diet counter;
- gives +4 Energy;
- can give Bond when feeding is appropriate;
- metabolism slightly mitigates weight gain, never below +1.

Overfeeding:
- lowers Discipline;
- sets Overfed;
- repeated feeding while already overfed/full can set Sick.

### Play

Base:
- Energy -12
- Fullness -4
- Weight -1
- positive Bond when sufficiently fed/rested
- SPD +1 if Energy >= 40 and not Sick

If depleted:
- no free Bond farming;
- Bond/Discipline may fall;
- Tired can be set;
- repeated forced play while Tired can set Sick.

### Care

Base:
- Energy -2
- Fullness -1
- Bond gain if the Rebyter is not severely depleted

Care can:
- clear Sick when Energy >= 50 and Fullness is in a healthy range;
- clear Injured when Energy >= 70;
- add a little Discipline when recovery is successful.

Repeated Care while depleted does not generate unlimited Bond.

### Rest

Base:
- Energy +30
- Fullness -2

If rest is actually needed:
- Discipline +1

Recovery:
- Tired clears at Energy >= 40
- Sick can clear at Energy >= 70 with healthy Fullness and no Overfed state
- Injured clears at Energy >= 85

Rest has no stat gain and cannot replace training.

## Training

`train(trainingType)` supports six machines.

| ID | Machine | Stat gains at full effectiveness | Energy | Weight |
|---:|---|---|---:|---:|
| 0 | Power | HP +1, ATK +3 | -22 | -1 |
| 1 | Endurance | HP +4, SPD +1 | -24 | -2 |
| 2 | Defense | HP +1, DEF +3 | -18 | 0 |
| 3 | Speed | ATK +1, SPD +3 | -22 | -2 |
| 4 | Combat | ATK +2, DEF +1, SPD +1 | -25 | -1 |
| 5 | Balanced | HP/ATK/DEF/SPD +1 | -16 | -1 |

Effectiveness tiers:

- Energy >= 50: full gain
- Energy 20-49: half gain
- Energy < 20: zero gain
- Sick/Injured reduces the tier by one

Consequences of overtraining:
- zero-effect training lowers Discipline and Bond;
- Tired is set;
- repeating training while already Tired can cause Sick + Injured;
- very low Energy can cause Injured.

Training is therefore unlimited but self-limiting through state.

## Skills

Skills use a `u64 learnedSkills` bitset: up to 64 persistent learned skills without storing strings.

Current reserved/implemented catalog:

| Bit | Skill | Current source |
|---:|---|---|
| 0 | Bite | reserved / future evolution or battle |
| 1 | Guard | reserved |
| 2 | Quick Step | reserved |
| 3 | Heavy Strike | Power training, ATK >= 50 |
| 4 | Second Wind | Endurance training, HP >= 150 |
| 5 | Iron Guard | Defense training, DEF >= 50 |
| 6 | Dash | Speed training, SPD >= 50 |
| 7 | Battle Instinct | Combat training, ATK+DEF+SPD >= 150 |
| 8 | Adapt | Balanced training, HP >= 120 and ATK/DEF/SPD >= 35 |

A skill unlock only occurs on a full-effect training session.

Future sources can add bits without changing the storage model:
- battle observation / battle rewards;
- evolution-granted techniques;
- special items/events.

The battle engine itself is **not implemented yet**; DNA v3 already reserves condition/stat/skill support for it.

## Evolution model

DNA stores only `evolutionId`. Family, stage and atlas version are not duplicated.

The current infrastructure still keeps **versioned EvolutionTree PDAs** in the Registry. DNA v3 is not pinned to one historical version: an evolution transaction must use the Registry's currently active tree version.

Therefore:

- publishing/activating a new atlas can change future eligibility for existing DNA v3 Rebyters;
- old NFT DNA does not require migration merely because the active atlas changes;
- the currently active tree + Merkle proof is the source of truth for routes and rules.

This is different from converting the Registry itself to a single mutable tree PDA. The current implementation intentionally preserves versioned publication/rollback infrastructure while removing atlas-version coupling from individual Rebyters.

## On-chain evolution metrics

Compact rule metric IDs are:

| ID | Metric |
|---:|---|
| 0 | genetics.metabolism |
| 1 | genetics.temperament |
| 2 | genetics.rhythm |
| 3 | genetics.mutation |
| 4 | diet.meat |
| 5 | diet.fish |
| 6 | diet.plant |
| 7 | diet.fruit |
| 8 | time.morning |
| 9 | time.day |
| 10 | time.evening |
| 11 | time.night |
| 12 | physical.weight |
| 13 | care.bond |
| 14 | care.discipline |
| 15 | state.fullness |
| 16 | state.energy |
| 17 | progression.interactions |
| 18 | progression.cycle |
| 19 | progression.stageAgeHours |
| 20 | battle.hp |
| 21 | battle.attack |
| 22 | battle.defense |
| 23 | battle.speed |
| 24 | state.sick |
| 25 | state.injured |
| 26 | skills.count |

## Mammal Atlas v3 balance

The development Mammal seed contains:

- 58 forms
- 85 evolution routes
- 27 gameplay metrics

Every evolution route now has mandatory gates:

1. **a trained stat** (HP, ATK, DEF or SPD depending on route);
2. minimum time in the current form;
3. minimum total interactions;
4. not Sick;
5. not Injured.

After mandatory gates, branch identity is shaped by optional route groups:

- diet;
- observed interaction rhythm;
- Bond or Discipline;
- weight;
- one genetic predisposition.

Early routes require 2 optional groups. Later routes require 3.

This guarantees that genetics alone cannot make a fresh mint evolution-ready.

### Current age gates by target stage

| Target stage | Minimum time in current form |
|---|---:|
| BYTE | 1 hour |
| KYLO | 6 hours |
| MEGA | 24 hours |
| GIGA | 72 hours |
| TERA | 168 hours |

### Current interaction gates by target stage

| Target stage | Minimum interactions |
|---|---:|
| BYTE | 5 |
| KYLO | 12 |
| MEGA | 30 |
| GIGA | 60 |
| TERA | 100 |

The exact per-route stat/diet/time/care/weight/genetic selection in `mammal.seed.json` is the **first DNA v3 development balance**. It is intentionally data-driven so individual routes can later be tuned without redesigning DNA or program instructions.

## Frontend behavior

The player UI exposes:

- Feed
- Play
- Train
- Care
- Rest

Train opens the six training machines.

The Rebyter status sheet exposes:
- personality/rhythm/diet/body summary;
- Fullness;
- Energy;
- Bond;
- Discipline;
- Condition flags;
- learned Skills;
- HP/ATK/DEF/SPD.

The browser computes lazy Fullness/Energy for display from `lastStateAt`. Transactions rematerialize the authoritative state on-chain before applying the action.

## RPC behavior

Player reads are cached and deduplicated in the frontend.

Current behavior:
- shared player snapshot cache: 30 seconds;
- concurrent identical player loads share one in-flight Promise;
- wallet balance has its own 30-second cache;
- mutations invalidate the player snapshot and force one fresh read.

This is intended to avoid repeated devnet RPC saturation while preserving immediate state after gameplay actions.

## Old mints / migration policy

There is no DNA v1/v2 compatibility path in the new gameplay model.

The frontend ignores non-v3 DNA when discovering playable Rebyters, and the program rejects non-v3 DNA for interactions/evolution.

For development migration:

1. deploy the DNA v3 program upgrade;
2. publish and activate the DNA v3 Mammal atlas;
3. burn/ignore the old development Rebyters;
4. mint new DNA v3 Rebyters.

Do not add migration code unless production requirements later make old assets valuable.

## Deployment checklist

From repository root / Codespaces:

```sh
git pull origin main

anchor build
cp target/idl/solana_anchor_starter.json app/src/idl/solana_anchor_starter.json

cd app
npm run typecheck
npm run build
cd ..

cargo fmt --check
cargo check
anchor test
```

Then deploy to devnet with the configured authority:

```sh
anchor deploy --provider.cluster devnet --provider.wallet artifacts/private/admin-keypair.json
```

After deployment, publish/activate a **new** Mammal atlas version with the dedicated identity-preserving publisher:

```sh
cd app
npm run publish:dna-v3
cd ..
```

This command reads the active Mammal atlas, preserves the existing evolution IDs and published assets, applies the canonical DNA v3 rules/balance, uploads the new immutable JSON to Irys, creates the next versioned tree PDA and activates it. It does **not** reserve a fresh creature collection. The Merkle root must be rebuilt because the old active root cannot verify the new rule bytes.

Finally mint a fresh Rebyter and test, in order:

1. Feed and overfeed.
2. Play into low Energy.
3. Rest and verify recovery.
4. Care while healthy and Sick.
5. Each of the six training machines.
6. Skill unlock thresholds.
7. Lazy Fullness/Energy after elapsed time.
8. Sick/Injured evolution gates.
9. Stage-age gate.
10. A complete evolution proof against the newly active atlas.

## Future work

The architecture intentionally leaves these systems for later without changing DNA layout:

- battle engine;
- battle-derived skill learning;
- evolution-granted skills;
- end-of-life/rebirth behavior using `cycle`;
- skill loadout/active moves if gameplay needs fewer equipped skills than learned skills;
- items/shop;
- tuning individual Mammal routes based on playtesting.

Any future change that alters the 60-byte binary layout must increment `schemaVersion`. Changes to Atlas rules, thresholds or route data alone do **not** require a DNA schema change.
