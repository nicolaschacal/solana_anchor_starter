import { Apple, Bandage, Eye, Heart, Thermometer, Utensils } from "lucide-react";
import type { ComponentType } from "react";
import { REBYTER_CONDITION } from "../../lib/rebyters/companions";
import type { CareState, careGuidance } from "../../lib/rebyters/guidance";

/**
 * What a companion shows above its head. Icons are only for needs; when it has
 * none it just watches you (an eye) or, if it is happy, shows a heart.
 */
export type Emote = "watch" | "love" | "food" | "sleep" | "sick" | "hurt" | "full";
export const EMOTES: Record<
  Emote,
  { Icon?: ComponentType<{ "aria-hidden"?: boolean | "true" | "false" }>; text?: string; label: string; need: boolean }
> = {
  watch: { Icon: Eye, label: "Your companion is watching you.", need: false },
  love: { Icon: Heart, label: "Your companion is happy.", need: false },
  food: { Icon: Apple, label: "Your companion is hungry.", need: true },
  sleep: { text: "Zzz", label: "Your companion wants to sleep.", need: true },
  sick: { Icon: Thermometer, label: "Your companion is sick.", need: true },
  hurt: { Icon: Bandage, label: "Your companion is hurt.", need: true },
  full: { Icon: Utensils, label: "Your companion is too full.", need: true },
};

/** The emote for what the companion needs right now, from the care guidance. */
export function needEmote(state: CareState, guidance: ReturnType<typeof careGuidance>): Emote | null {
  if (!guidance.message) return null;
  if (guidance.recommended === "feed") return "food";
  if (guidance.recommended === "rest") return "sleep";
  if (guidance.recommended === "care") return state.condition & REBYTER_CONDITION.sick ? "sick" : "hurt";
  return "full";
}
