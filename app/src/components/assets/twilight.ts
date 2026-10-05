import type { WorldPeriod } from "../../hooks/useWorldClock";

// Visual twilight stays inside Evening; gameplay's four UTC periods are unchanged.
export function nightBlend(period: WorldPeriod, unixMs: number): number {
  if (period === "Night") return 1;
  if (period !== "Evening") return 0;
  const hour = (((unixMs / 3600000) % 24) + 24) % 24;
  const t = Math.max(0, Math.min(1, (hour - 19.5) / 3.5));
  return t * t * (3 - 2 * t);
}
