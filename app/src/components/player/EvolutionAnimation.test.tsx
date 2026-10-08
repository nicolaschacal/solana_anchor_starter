// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Evolution } from "../../lib/rebyters/types";
import { EvolutionAnimation } from "./EvolutionAnimation";

type Fake = {
  assets: string[];
  disposed: boolean;
};
const h = vi.hoisted(() => ({ made: [] as Fake[], failConstruct: false }));
const made = h.made;
vi.mock("./creatureAsset", () => ({ loadEvolutionAsset: async () => ({}) }));
vi.mock("../../lib/rebyters/evolution-fx", () => ({
  EvolutionFx: class {
    settled = false;
    assets: string[] = [];
    disposed = false;
    constructor() {
      if (h.failConstruct) throw new Error("no webgl");
      h.made.push(this);
    }
    setFrom() {
      this.assets.push("from");
    }
    setTo() {
      this.assets.push("to");
    }
    resize() {}
    render() {}
    dispose() {
      this.disposed = true;
    }
    advance(_dt: number, settled: boolean) {
      this.settled = settled;
    }
    get ui() {
      return { reveal: this.settled ? 1 : 0, stageReached: this.settled, waiting: !this.settled };
    }
  },
}));

const evolution = (id: number, name: string, stage: number) => ({ id, name, stage }) as Evolution;
const from = evolution(10, "Fangbit", 1);
const to = evolution(20, "Caniform", 2);
const STAGES = ["ORIGIN", "BYTE", "KYLO", "MEGA", "GIGA", "TERA"];

let root: Root, host: HTMLDivElement;
beforeEach(() => {
  made.length = 0;
  h.failConstruct = false;
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const overlay = () => document.querySelector<HTMLElement>(".evo-fx");
const continueButton = () => document.querySelector<HTMLButtonElement>(".evo-banner button");
function deferred() {
  let resolve!: () => void, reject!: (e: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
async function mount(task: Promise<unknown>, onClose = vi.fn()) {
  await act(async () =>
    root.render(<EvolutionAnimation job={{ from, to, task }} stageNames={STAGES} onClose={onClose} />),
  );
  return onClose;
}

it("holds on the helix while the transaction is pending, then reveals the new form", async () => {
  const tx = deferred();
  const onClose = await mount(tx.promise);
  expect(overlay()?.getAttribute("role")).toBe("dialog");
  expect(document.body.textContent).toContain("Evolved · BYTE → KYLO");
  expect(document.body.textContent).toContain("Caniform");
  await vi.waitFor(() =>
    expect(document.querySelector<HTMLElement>(".evo-status")?.dataset.visible).toBe("true"),
  );
  expect(continueButton()?.disabled).toBe(true);

  await act(async () => tx.resolve());
  await vi.waitFor(() => expect(continueButton()?.disabled).toBe(false));
  const stages = [...document.querySelectorAll<HTMLElement>(".evo-rail li")].map((li) => li.dataset.state);
  expect(stages.slice(0, 4)).toEqual(["done", "done", "now", "todo"]);
  expect(document.activeElement).toBe(continueButton());
  await act(async () => continueButton()?.click());
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("fades out and steps aside when the transaction fails", async () => {
  const tx = deferred();
  const onClose = await mount(tx.promise);
  await act(async () => tx.reject(new Error("rejected")));
  await vi.waitFor(() => expect(overlay()?.dataset.leaving).toBe("true"));
  await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1), { timeout: 1500 });
});

it("handles Escape itself so the panel behind the overlay stays open", async () => {
  const behind = vi.fn();
  document.addEventListener("keydown", behind);
  await mount(new Promise(() => undefined));
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  expect(behind).not.toHaveBeenCalled();
  document.removeEventListener("keydown", behind);
});

it("draws the stage straight away, then hands the creatures over as they load", async () => {
  await mount(new Promise(() => undefined));
  expect(made).toHaveLength(1);
  expect(overlay()?.querySelector(".evo-stage canvas")).not.toBeNull();
  await vi.waitFor(() => expect(made[0].assets.sort()).toEqual(["from", "to"]));
});

it("cannot be skipped by clicking", async () => {
  await mount(new Promise(() => undefined));
  await act(async () => overlay()?.click());
  expect(continueButton()?.disabled).toBe(true);
});

it("releases the scene when it closes", async () => {
  await mount(new Promise(() => undefined));
  await act(async () => root.render(<div />));
  expect(made[0].disposed).toBe(true);
  expect(document.querySelector(".evo-stage canvas")).toBeNull();
});

it("steps aside once the transaction settles when the scene cannot be built", async () => {
  h.failConstruct = true;
  const tx = deferred();
  const onClose = await mount(tx.promise);
  expect(onClose).not.toHaveBeenCalled();
  await act(async () => tx.resolve());
  await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
});
