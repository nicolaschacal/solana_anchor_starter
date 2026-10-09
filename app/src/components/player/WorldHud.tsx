import { Gift, Package, ShoppingBag } from "lucide-react";
import { CreatureSprite } from "../admin/CreatureSprite";
import type { WorldCreature } from "../world/PlayerWorld";
import { EMOTES } from "./emotes";

type Props = {
  creatures: WorldCreature[];
  /** The Rebyter that is selected in the game, if any (marked in the strip). */
  activeMint?: string;
  onSelect: (mint: string) => void;
  /** Daily ration waiting, and how many quests are done but not claimed yet. */
  rationReady: boolean;
  claimable: number;
  /** Quests finished today (claimed or not) out of the total. */
  questsDone: number;
  questsTotal: number;
  onDaily: () => void;
  onStore: () => void;
  onStorage: () => void;
  onDen: () => void;
};

/**
 * The open-world HUD: what needs you, today's rewards and the shortcuts you use most, in one
 * place at the bottom. Hidden once a Rebyter is selected (then its care controls take over).
 */
export function WorldHud({ creatures, activeMint, onSelect, rationReady, claimable, questsDone, questsTotal, onDaily, onStore, onStorage, onDen }: Props) {
  const needy = creatures.filter((c) => c.emote && EMOTES[c.emote].need).length;
  const ready = (rationReady ? 1 : 0) + claimable;
  const nudge = ready
    ? `${rationReady ? "Daily ration ready" : ""}${rationReady && claimable ? " · " : ""}${claimable ? `${claimable} quest reward${claimable > 1 ? "s" : ""} to claim` : ""}`
    : "";
  return (
    <div className="world-hud" aria-label="Game shortcuts">
      {nudge && (
        <button className="world-nudge gl-panel" onClick={onDaily}>
          <Gift aria-hidden="true" />
          <span>{nudge}</span>
          <b>Claim</b>
        </button>
      )}
      {creatures.length > 0 && (
        <div className="world-team gl-panel" role="group" aria-label={needy ? `${needy} companion${needy > 1 ? "s" : ""} need you` : "Your companions"}>
          <div className="world-team-list">
            {creatures.map((c) => {
              const emote = c.emote ? EMOTES[c.emote] : null;
              const need = !!emote?.need;
              return (
                <button key={c.mint} className="world-team-card" data-need={need} data-active={c.mint === activeMint} onClick={() => onSelect(c.mint)} title={need && emote ? emote.label : c.evolution.name}>
                  <span className="world-team-art">
                    <CreatureSprite evolution={c.evolution} />
                  </span>
                  <small>{c.evolution.name}</small>
                  {need && emote && (
                    <i className="world-team-need" aria-hidden="true">
                      {emote.Icon ? <emote.Icon aria-hidden="true" /> : <b>{emote.text}</b>}
                    </i>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <nav className="world-dock gl-panel" aria-label="Shortcuts">
        <button onClick={onDaily} data-hot={ready > 0}>
          <Gift aria-hidden="true" />
          <span>Daily</span>
          <small>{questsDone}/{questsTotal}</small>
          {ready > 0 && <b className="world-dock-dot">{ready}</b>}
        </button>
        <button onClick={onStore}>
          <ShoppingBag aria-hidden="true" />
          <span>Store</span>
        </button>
        <button onClick={onStorage}>
          <Package aria-hidden="true" />
          <span>Storage</span>
        </button>
        <button onClick={onDen}>
          <span className="den-grid-icon" aria-hidden="true"><i /><i /><i /><i /></span>
          <span>My Rebyters</span>
          <small>{creatures.length}</small>
        </button>
      </nav>
    </div>
  );
}
