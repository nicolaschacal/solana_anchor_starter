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
- **One PDA per player:** `PlayerProfile` (`profile3`): pokedex, ration day, quest counters, food, starter flag,
  active habitat.
- **Starter pack,** claimed once per wallet together with the first Rebyter (own transaction, because a second
  mint does not fit next to the evolution proof): the profile, a free Verdant Meadow (5x5) habitat NFT and 3 meals
  of each food. The starter decor (tree, rocks, bush) is part of the engine and free for everyone.
- **Storage** (game menu) lists what the wallet holds grouped by type, lets the player pick which habitat opens
  with the game, and returns the deposit of empty token accounts.

On-chain pieces: `buy_gems`, `buy_item` (decor/machines), `buy_food`, `create_habitat` (free starter or Gems),
`set_habitat_layout`, `select_habitat`, `claim_daily_ration`, `claim_quest`, `set_food` and
`create_habitat_type` / `create_item_type` (admin). PDA seeds: `economy2`, `item2`, `profile3`,
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
  The measured table is at the end of this file (filled from `cost-report`).
