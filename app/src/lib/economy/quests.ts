/**
 * Daily quests, derived from the UTC day number alone. This is a port of `game_day` and `quest_for`
 * in the program (programs/solana_anchor_starter/src/lib.rs): the chain decides what counts, the app
 * only needs the same table to label things. quests.test.ts pins the two together.
 */
export const SECONDS_PER_DAY = 86_400;
export const QUESTS_PER_DAY = 3;

export type ActionKind = 0 | 1 | 2 | 3 | 4;
export const ACTION_LABEL = ["Feed", "Play with", "Care for", "Rest", "Train"] as const;
export const ACTION_PAST = ["feeds", "play sessions", "care visits", "rests", "training sessions"] as const;

/** [action kind, target, meals]: must match QUEST_TEMPLATES in the program. */
export const QUEST_TEMPLATES: readonly (readonly [ActionKind, number, number])[] = [
  [0, 3, 1],
  [1, 3, 1],
  [2, 2, 1],
  [4, 1, 1],
  [0, 5, 2],
  [1, 5, 2],
  [3, 1, 1],
  [4, 3, 2],
];
const OFFSETS = [0, 3, 5];

export const gameDay = (unixSeconds: number) => Math.floor(Math.max(0, unixSeconds) / SECONDS_PER_DAY) + 1;

/** Which food (0 meat, 1 plants, 2 fish, 3 fruit) a quest pays: `quest_food` in the program. */
export const questFood = (day: number, slot: number) => (day + slot) % 4;

export type Quest = { slot: number; kind: ActionKind; target: number; reward: number; food: number; title: string };

export function questFor(day: number, slot: number): Quest {
  const [kind, target, reward] = QUEST_TEMPLATES[(day + OFFSETS[slot]) % QUEST_TEMPLATES.length];
  const title = kind === 3 ? "Let a Rebyter rest" : `${ACTION_LABEL[kind]} your Rebyters ${target}×`;
  return { slot, kind, target, reward, food: questFood(day, slot), title };
}

export const questsFor = (day: number) => Array.from({ length: QUESTS_PER_DAY }, (_, slot) => questFor(day, slot));

/** Seconds until the next UTC day starts. */
export const secondsToReset = (unixSeconds: number) => SECONDS_PER_DAY - (Math.floor(unixSeconds) % SECONDS_PER_DAY);
