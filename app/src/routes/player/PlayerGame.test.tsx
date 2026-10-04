// @vitest-environment jsdom
import { act, useContext, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ScenePausedContext } from "../../components/assets/scene-visibility";
import { PlayerGame } from "./PlayerGame";
import { PlayerStateContext } from "./panel-context";

vi.mock("../../hooks/usePlayerRebyters", () => ({
  usePlayerRebyters: function useSharedCollection() {
    const [evolutionId, setEvolutionId] = useState(1);
    return {
      owned: [{ evolutionId }],
      status: "",
      refresh: async () => {
        setEvolutionId(2);
      },
    };
  },
}));
const counts = vi.hoisted(() => ({ homeMounts: 0, homeUnmounts: 0 }));
vi.mock("./App", () => ({
  PlayerHome: function Home() {
    const paused = useContext(ScenePausedContext);
    const player = useContext(PlayerStateContext);
    useEffect(() => {
      counts.homeMounts++;
      return () => {
        counts.homeUnmounts++;
      };
    }, []);
    return (
      <div
        data-testid="home"
        data-paused={String(paused)}
        data-evolution={player?.owned[0]?.evolutionId}
      >
        Companion canvas
      </div>
    );
  },
  PlayerLab: function Lab() {
    const player = useContext(PlayerStateContext);
    return (
      <button onClick={() => void player?.refresh(true)}>
        Refresh evolved companion
      </button>
    );
  },
  PlayerAccount: () => <div>Wallet settings</div>,
  PlayerAtlas: function Atlas() {
    const [selected, setSelected] = useState(false);
    return (
      <button onClick={() => setSelected(true)}>
        {selected ? "Fangbit lineage" : "Select Fangbit"}
      </button>
    );
  },
}));
let root: Root, host: HTMLDivElement, navigate: ReturnType<typeof useNavigate>;
function Navigation() {
  navigate = useNavigate();
  return <PlayerGame />;
}
beforeEach(() => {
  counts.homeMounts = counts.homeUnmounts = 0;
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
async function open(path: string) {
  await act(async () => navigate(path));
}
it("retains Home and panel selection across routes, pauses the covered scene, and closes with Escape", async () => {
  await act(async () =>
    root.render(
      <MemoryRouter>
        <Navigation />
      </MemoryRouter>,
    ),
  );
  const home = host.querySelector('[data-testid="home"]');
  await open("/lab");
  expect(host.querySelector('[data-testid="home"]')).toBe(home);
  expect(home?.getAttribute("data-paused")).toBe("true");
  const refresh = host.querySelector(
    ".player-panel-content:not([hidden]) button",
  ) as HTMLButtonElement;
  await act(async () => refresh.click());
  expect(home?.getAttribute("data-evolution")).toBe("2");
  await open("/atlas");
  const atlas = host.querySelector(
    ".player-panel-content:not([hidden]) button",
  ) as HTMLButtonElement;
  await act(async () => atlas.click());
  await open("/account");
  await open("/atlas");
  expect(atlas.textContent).toBe("Fangbit lineage");
  expect(host.querySelector(".player-panel-content:not([hidden]) button")).toBe(
    atlas,
  );
  await act(async () =>
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    ),
  );
  expect(
    host.querySelector(".player-panel-backdrop")?.hasAttribute("hidden"),
  ).toBe(true);
  expect(home?.getAttribute("data-paused")).toBe("false");
  expect(counts).toEqual({ homeMounts: 1, homeUnmounts: 0 });
});
it("supports direct panel links and browser Back without replacing Home", async () => {
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={["/atlas"]}>
        <Navigation />
      </MemoryRouter>,
    ),
  );
  const home = host.querySelector('[data-testid="home"]');
  expect(
    host.querySelector('[role="dialog"]')?.getAttribute("aria-label"),
  ).toBe("Atlas");
  await open("/lab");
  await act(async () => navigate(-1));
  expect(
    host.querySelector('[role="dialog"]')?.getAttribute("aria-label"),
  ).toBe("Atlas");
  expect(host.querySelector('[data-testid="home"]')).toBe(home);
  expect(counts.homeMounts).toBe(1);
});
