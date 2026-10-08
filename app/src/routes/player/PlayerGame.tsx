import { useEffect, useRef, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { Atom, BookOpen, CircleUserRound, X } from "lucide-react";
import { PlayerAccount, PlayerAtlas, PlayerHome, PlayerLab } from "./App";
import { usePlayerRebyters } from "../../hooks/usePlayerRebyters";
import { PlayerPanelContext, PlayerStateContext } from "./panel-context";
import { ScenePausedContext } from "../../components/assets/scene-visibility";

const panels = {
  lab: { title: "Lab", Icon: Atom, Content: PlayerLab },
  atlas: { title: "Atlas", Icon: BookOpen, Content: PlayerAtlas },
  account: { title: "Account", Icon: CircleUserRound, Content: PlayerAccount },
};
type Panel = keyof typeof panels;
const panelNames = Object.keys(panels) as Panel[];

export function PlayerGame() {
  const player = usePlayerRebyters();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const panel = panelNames.find((name) => pathname === `/${name}`);
  const [visited, setVisited] = useState<Panel[]>(() => (panel ? [panel] : []));
  const dialog = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (panel)
      setVisited((previous) =>
        previous.includes(panel) ? previous : [...previous, panel],
      );
  }, [panel]);

  useEffect(() => {
    if (!panel) {
      if (wasOpen.current) {
        const target = trigger.current?.isConnected
          ? trigger.current
          : document.querySelector<HTMLElement>(".persistent-game button");
        target?.focus();
      }
      wasOpen.current = false;
      return;
    }
    if (!wasOpen.current)
      trigger.current = document.activeElement as HTMLElement;
    wasOpen.current = true;
    dialog.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // Nested interaction sheets handle their own dismissal.
        if (
          dialog.current?.querySelector(
            ".player-panel-content:not([hidden]) .game-sheet-backdrop, .player-panel-content:not([hidden]) .origin-sheet-backdrop, .player-panel-content:not([hidden]) .money-sheet-backdrop",
          )
        )
          return;
        event.preventDefault();
        navigate("/");
      }
      if (event.key !== "Tab" || !dialog.current) return;
      const focusable = [
        ...dialog.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
        ),
      ].filter((element) => element.getClientRects().length > 0);
      const first = focusable[0],
        last = focusable.at(-1);
      if (!first) {
        event.preventDefault();
        return;
      }
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          document.activeElement === dialog.current)
      ) {
        event.preventDefault();
        last?.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last ||
          document.activeElement === dialog.current)
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [panel, navigate]);

  return (
    <PlayerStateContext.Provider value={player}>
      <ScenePausedContext.Provider value={!!panel}>
        <div
          className="persistent-game"
          inert={!!panel}
          aria-hidden={panel ? true : undefined}
        >
          <PlayerHome />
        </div>
      </ScenePausedContext.Provider>
      <div
        className="player-panel-backdrop rb-ui"
        hidden={!panel}
        onClick={(event) => {
          if (event.target === event.currentTarget) navigate("/");
        }}
      >
        <section
          ref={dialog}
          className="player-panel-dialog"
          role="dialog"
          aria-modal="true"
          aria-label={panel ? panels[panel].title : undefined}
          tabIndex={-1}
        >
          <header className="player-panel-header">
            <nav aria-label="Game panels">
              {panelNames.map((name) => {
                const { Icon, title } = panels[name];
                return (
                  <NavLink key={name} to={`/${name}`}>
                    <Icon />
                    <span>{title}</span>
                  </NavLink>
                );
              })}
            </nav>
            <button
              className="ui-close player-panel-close"
              aria-label="Back to companion"
              onClick={() => navigate("/")}
            >
              <X />
            </button>
          </header>
          <div className="player-panel-body">
            <PlayerPanelContext.Provider value={true}>
              {panelNames.map((name) => {
                if (!visited.includes(name) && panel !== name) return null;
                const { Content } = panels[name];
                return (
                  <ScenePausedContext.Provider
                    key={name}
                    value={panel !== name}
                  >
                    <div
                      className="player-panel-content"
                      hidden={panel !== name}
                      inert={panel !== name}
                    >
                      <Content />
                    </div>
                  </ScenePausedContext.Provider>
                );
              })}
            </PlayerPanelContext.Provider>
          </div>
        </section>
      </div>
    </PlayerStateContext.Provider>
  );
}
