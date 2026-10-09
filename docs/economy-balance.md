# Rebyters economy: balance and sustainability (devnet numbers)

All numbers live in one of two places so they can be tuned without redeploying the program:
`RATION_UNITS` and the prices in `app/scripts/setup-economy.ts` / `app/src/lib/economy/catalog.ts`.
Edit, push, run the `setup-economy` action: it reconciles the chain with the catalog.

## Demand: what feeding costs

- A Rebyter loses ~2 fullness per hour (48 per day). One meal restores 14–22 (meat 22, fish 18, plants 16, fruit 14).
- Staying healthy therefore needs ~2.7 meals per Rebyter per day. Feeding above 90 fullness is a care mistake,
  so extra food is not wasted *usefully*: overfeeding is punished.
- Every meal burns one unit on-chain (account-bound units first). Food is a pure sink.
- The diet history (which of the four foods was eaten) matters for evolution, so the free mix is rarely the mix you want.

## Supply: what a free player earns per day

| Source | Amount | Meals |
|---|---|---|
| Daily ration | 2 of each of the 4 foods | 8 |
| Daily quests (3), avg 11.9 Sparks each | ~36 Sparks, food bought at 8 Sparks/meal | ~4.5 |
| **Total** | | **~12.5 meals/day** |

Compared with demand of 2.7 meals per Rebyter:

| Setup | Needs | Free supply covers |
|---|---|---|
| 5x5, 3 Rebyters | ~8 meals/day | Yes, with ~4 meals/day to steer the diet |
| 10x10, 6 Rebyters | ~16 meals/day | Most of it; ~3.5 meals/day to buy |
| 15x15, 10 Rebyters | ~27 meals/day | About half; ~14 meals/day to buy |

A free player can keep roughly 4–5 Rebyters alive. More than that is a choice that costs real (small) money.

## Prices

- Gems: 1 Gem = 0.0001 SOL (500 Gems = 0.05 SOL, bigger packs are ~10–30% cheaper per Gem).
- Gem food: 3–4 Gems per meal (≈ 0.0003–0.0004 SOL); the ×99 meat pack is ~10% cheaper per meal.
- Sparks food: 8 Sparks per meal (40 per pack of 5), so Sparks cost nothing but are scarce. Sparks also buy decor (60–180), which competes with food for the same ~36/day.
- Rough monthly food bill for the paying part: 6 Rebyters ≈ 0.04 SOL, 10 Rebyters ≈ 0.15 SOL.

## Why it holds together

- Every faucet is capped per wallet per day (one ration, three quests, each paid once). Nothing mints on demand.
- Gems and Sparks are non-transferable and there is no way to cash anything out, so extra wallets can only feed
  their own Rebyters: farming gains nothing that can leave the game.
- Every unit of food is destroyed when eaten and Gems/Sparks are destroyed when spent, so balances do not
  inflate without bound; stockpiles only delay demand.
- Difficulty comes from timing and mix, not from a wall: starving makes a Rebyter sick after ~62 h at zero
  fullness, overfeeding adds care mistakes, and steering a diet needs food beyond the free ration.

## Knobs, in the order to reach for them

1. `RATION_UNITS` (free supply): 2 → 3 makes the free tier comfortable for 4–5 Rebyters.
2. Sparks food price (8/meal): lowering it makes quests more rewarding.
3. Quest rewards (`QUEST_TEMPLATES` in the program, needs a redeploy).
4. Gem food prices and Gem pack sizes (revenue side).
