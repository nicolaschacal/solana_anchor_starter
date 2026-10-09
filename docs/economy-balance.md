# Rebyters economy: design, balance and costs (devnet numbers)

This is the current design. It replaced an earlier two-currency model (Gems + Sparks, food as tokens).
No migration exists or is planned: when the design changes, the economy is recreated from scratch and
players start a new account.

## Design in one page

- **One currency: Gems.** Bought with SOL, spent (burned) in the store, non-transferable, no cash-out.
  There is no second currency. Whoever pays network fees has access to everything.
- **Food is not a token.** It is four small counters (meat, plants, fish, fruit) inside the player's single
  `PlayerProfile` account. Claiming the ration, completing a quest or buying food only changes numbers in that
  account, so there are no token accounts to create and no deposits to lock. Feeding uses up one meal.
  Because food can neither be sent nor sold, free food cannot be farmed into anything tradable.
- **Assets are real tokens in the wallet and are transferable:** decor and machines (fungible, one mint each)
  and habitats (below). What is not in the wallet does not show in the game.
- **A habitat is a 1/1 NFT that stores its own layout.** Where the Rebyters stand and where each object sits is a
  fixed-size field (`LAYOUT`, 230 bytes as hex) inside the habitat's own metadata, so saving never reallocates
  and the layout travels with the habitat if it is transferred. The profile only remembers which habitat is
  `active_habitat`. Objects only show if the wallet holds them (decor beyond what is held is hidden, not deleted).
- **One PDA per player:** `PlayerProfile` (`profile4`): pokedex, ration day, quest counters, food, starter flag,
  active habitat.
- **Starter pack,** claimed once per wallet together with the first Rebyter (own transaction, because a second
  mint does not fit next to the evolution proof): the profile, a free Verdant Meadow (5x5) habitat NFT and 3 meals
  of each food. The starter decor (tree, rocks, bush) is part of the engine and free for everyone.
- **Storage** (game menu) lists what the wallet holds grouped by type, lets the player pick which habitat opens
  with the game, and returns the deposit of empty token accounts.

On-chain pieces: `buy_gems`, `buy_item` (decor/machines), `buy_food`, `create_habitat` (free starter or Gems),
`set_habitat_layout`, `select_habitat`, `claim_daily_ration`, `claim_quest`, `set_food` and
`create_habitat_type` / `create_item_type` (admin). PDA seeds: `economy2`, `item2`, `profile4`,
`habitat_authority`.

## Demand: what feeding costs

- A Rebyter loses ~2 fullness per hour (48 per day). One meal restores 14-22 (meat 22, fish 18, plants 16, fruit 14).
- Staying healthy therefore needs ~2.7 meals per Rebyter per day. Feeding above 90 fullness is a care mistake,
  so extra food is not wasted *usefully*: overfeeding is punished.
- Every meal removes one unit from the counter. Food is a pure sink.
- The diet history (which of the four foods was eaten) matters for evolution, so the free mix is rarely the mix you want.

## Supply: what a free player earns per day

| Source | Amount | Meals |
|---|---|---|
| Daily ration | 2 of each of the 4 foods | 8 |
| Daily quests (3) | 1-2 meals each, a different food each (`quest_food`) | ~4.1 |
| **Total** | | **~12 meals/day** |

Compared with demand of 2.7 meals per Rebyter:

| Setup | Needs | Free supply covers |
|---|---|---|
| 5x5, 3 Rebyters | ~8 meals/day | Yes, with ~4 meals/day to steer the diet |
| 10x10, 6 Rebyters | ~16 meals/day | Most of it; ~4 meals/day to buy |
| 15x15, 10 Rebyters | ~27 meals/day | About half; ~15 meals/day to buy |

A free player can keep roughly 4-5 Rebyters alive. More than that is a choice that costs real (small) money.

## Prices

- Gems: 1 Gem = 0.0001 SOL (500 Gems = 0.05 SOL, bigger packs are ~10-30% cheaper per Gem).
- Food: a pack is 5 meals; meat and fish 20 Gems, plants and fruit 15 (3-4 Gems per meal, ~0.0003-0.0004 SOL).
- Decor 40-400 Gems, machines 700-1,200, habitats 2,500 (10x10) and 6,000 (15x15).
- Rough monthly food bill for the paying part: 6 Rebyters ~0.04 SOL, 10 Rebyters ~0.15 SOL.

## Why it holds together

- Every faucet is capped per wallet per day (one ration, three quests, each paid once). Nothing mints on demand.
- Gems and food cannot leave the wallet or the profile, and nothing can be cashed out, so extra wallets can
  only feed their own Rebyters. Quests pay food, never Gems, so free play cannot be turned into tradable assets.
- Food is destroyed when eaten and Gems when spent, so balances do not inflate without bound.
- Difficulty comes from timing and mix, not from a wall: starving makes a Rebyter sick after ~62 h at zero
  fullness, overfeeding adds care mistakes, and steering a diet needs food beyond the free ration.

## Knobs, in the order to reach for them

1. `RATION_UNITS` in `app/scripts/setup-economy.ts` (free supply): 2 to 3 makes the free tier comfortable for 4-5 Rebyters.
2. Food prices and pack size (`catalog.ts`, `PACK_MEALS`): both are stored on-chain by `set_food`.
3. Quest rewards (`QUEST_TEMPLATES` in the program, needs a redeploy; `quests.ts` mirrors it).
4. Gem pack sizes and decor/machine prices (revenue side; `setup-economy` reconciles item prices).

Edit, push, run the `setup-economy` action: it reconciles the chain with the catalog.

## What actions cost on Solana

SOL ~ $113 (rate implied by an earlier wallet screenshot). Run `cost-report` in the devnet-ops workflow to measure.

- **Network fee:** every transaction carries an explicit compute budget; the base fee is 0.000005 SOL (~$0.0006).
  Without it, wallets add their own priority fee (0.000045 SOL, 9x more).
- **Deposits (rent) are not fees,** they are refundable: closing an empty token account returns it.
- With food as counters, the daily routine (claim ration, claim quests, feed, play, care, rest, save layout) creates
  no accounts at all, so a typical day (~25 actions) costs ~0.000125 SOL (~$0.014), about $0.42 a month.
- One-time costs of a new player: the starter pack (profile + habitat NFT mint) and the Rebyter mint, plus
  ~0.0015 SOL for the first token account of each decor/machine item type and of Gems.

Measured on devnet (new wallet, real client code, `cost-report`):

| Action | Network fee | Deposit locked |
|---|---|---|
| claim ration, feed, play, care, rest, save layout, buy food | 0.000005 SOL | none |
| starter pack (profile + habitat NFT + first meals) | 0.00001 SOL | 0.0086 SOL |
| create first Rebyter | 0.00001 SOL | 0.0053 SOL |
| buy Gems (first time) | 0.000005 SOL | 0.0015 SOL |
| buy a decor item (first of its type) | 0.000005 SOL | 0.0015 SOL |

Before this redesign, claiming the first ration locked 0.0061 SOL and the Rebyter 0.0075 SOL; now the daily loop
locks nothing. The one-time total for a new player is ~0.016 SOL (~$1.8) before any purchase.

## Food tiers, training machines and evolution items (deployed)

**Food: 4 foods × 4 tiers = 16 meals**, all counters in the profile (no token accounts). A higher tier gives more fullness
and counts more in the diet history that drives evolution; price per point of fullness stays about equal, so a big meal
saves transactions and fees rather than Gems.

| Tier | Fullness | Diet weight | Meat / Fish price | Plants / Fruit price |
|---|---|---|---|---|
| 0 plain (Meat Bite, Leaves, Sardine, Berries) | ×1.0 | ×1 | 4 | 3 |
| 1 (Steak, Salad, Salmon, Apple) | ×1.5 | ×2 | 6 | 4 |
| 2 (Big Steak, Garden Bowl, Tuna Steak, Fruit Basket) | ×2.2 | ×3 | 9 | 6 |
| 3 (Feast Roast, Harvest Feast, Sushi Platter, Golden Fruit) | ×3.0 | ×4 | 12 | 8 |

The free daily ration and the quests give plain (tier 0) meals only. Tiers 1–3 are bought with Gems.

**Training.** Everyone trains at the normal rate with no item. In the store, specialised machines (transferable tokens held in the
wallet) boost the gains of one training: standard +50% (700–1200 Gems) and pro +100% (1900–3200 Gems). The app passes the best machine
owned for that training automatically. Machines are not consumed.

**Evolution items.** 10 items (rare 1800 Gems, ultra 4500 Gems) for the mammal line. Using one burns 1 and skips the rule's requirements
for that single target; the route must still exist in the active atlas. Ids are resolved by evolution key at setup time.

**Seeds** are `economy3` / `item3` / `profile4`: old devnet accounts are never read (no backward compatibility).

**Measured on devnet after the change:** starter pack 0.0087 SOL locked, Rebyter mint 0.0053 SOL locked, every daily action
(ration, feed, play, care, train, rest, layout, buy food) 0.000005 SOL fee only, first decor token account 0.0015 SOL.

## Habitats: capacity by island size (deployed)

The layout inside a habitat NFT now grows with use and the owner pays the rent of the extra bytes when saving
(a blank habitat is 1 byte, so the starter pack locks 0.0064 SOL instead of 0.0087). Capacity is about one Rebyter per 8 tiles
and the program accepts at most 12 Rebyters and 50 objects per habitat; the app limits each island by its size:

| Island | Rebyters | Objects |
|---|---|---|
| 5x5 (starter) | 3 | 14 |
| 10x10 | 12 | 30 |
| 15x15 | 12 | 50 |

## Game HUD (open world)

With no Rebyter selected the main screen shows a bottom HUD: a daily nudge (ration/quests ready, one tap to the Daily sheet),
a strip with every companion and what it needs (tap to open it), and a dock with Daily (quests done), Store, Storage and My Rebyters.

## Roadmap status

- Done: one currency, food tiers, starter pack, training machines, evolution items, habitat NFTs with growing on-chain layout and
  capacity by island size, open-world HUD, Storage menu.
- Next: vending-machine sales, Irys uploads on request, cleanup of the leftover partial-clone folder in Documents.
