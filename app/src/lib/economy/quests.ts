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

/** [action kind, target, Sparks]: must match QUEST_TEMPLATES in the program. */
export const QUEST_TEMPLATES: readonly (readonly [ActionKind, number, number])[] = [
  [0, 3, 10],
  [1, 3, 10],
  [2, 2, 10],
  [4, 1, 10],
  [0, 5, 15],
  [1, 5, 15],
  [3, 1, 5],
  [4, 3, 20],
];
const OFFSETS = [0, 3, 5];

export const gameDay = (unixSeconds: number) => Math.floor(Math.max(0, unixSeconds) / SECONDS_PER_DAY) + 1;

export type Quest = { slot: number; kind: ActionKind; target: number; reward: number; title: string };

export function questFor(day: number, slot: number): Quest {
  const [kind, target, reward] = QUEST_TEMPLATES[(day + OFFSETS[slot]) % QUEST_TEMPLATES.length];
  const title = kind === 3 ? "Let a Rebyter rest" : `${ACTION_LABEL[kind]} your Rebyters ${target}×`;
  return { slot, kind, target, reward, title };
}

export const questsFor = (day: number) => Array.from({ length: QUESTS_PER_DAY }, (_, slot) => questFor(day, slot));

/** Seconds until the next UTC day starts. */
export const secondsToReset = (unixSeconds: number) => SECONDS_PER_DAY - (Math.floor(unixSeconds) % SECONDS_PER_DAY);
