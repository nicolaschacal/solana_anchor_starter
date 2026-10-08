// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Evolution } from "../../lib/rebyters/types";
import { EvolutionAnimation } from "./EvolutionAnimation";

class FakeFx {
  settled = false;
  resize() {}
  render() {}
  dispose() {}
  advance(_dt: number, settled: boolean) {
    this.settled = settled;
  }
  get ui() {
    return { reveal: this.settled ? 1 : 0, stageReached: this.settled, waiting: !this.settled };
  }
}
const session = (ready: Promise<unknown> = Promise.resolve(new FakeFx())) => ({
  key: "10>20",
  canvas: document.createElement("canvas"),
  ready: ready as Promise<never>,
  dispose: vi.fn(),
});

const evolution = (id: number, name: string, stage: number) => ({ id, name, stage }) as Evolution;
const from = evolution(10, "Fangbit", 1);
const to = evolution(20, "Caniform", 2);
const STAGES = ["ORIGIN", "BYTE", "KYLO", "MEGA", "GIGA", "TERA"];

let root: Root, host: HTMLDivElement;
beforeEach(() => {
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
async function mount(task: Promise<unknown>, onClose = vi.fn(), s = session()) {
  await act(async () =>
    root.render(<EvolutionAnimation job={{ from, to, task, session: s }} stageNames={STAGES} onClose={onClose} />),
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

it("puts the prepared canvas on screen immediately and cannot be skipped by clicking", async () => {
  const s = session();
  await mount(new Promise(() => undefined), vi.fn(), s);
  expect(overlay()?.contains(s.canvas)).toBe(true);
  await act(async () => overlay()?.click());
  expect(continueButton()?.disabled).toBe(true);
});

it("steps aside when the scene cannot be built", async () => {
  const tx = deferred();
  const onClose = await mount(tx.promise, vi.fn(), session(Promise.reject(new Error("no webgl"))));
  await act(async () => tx.resolve());
  await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
});
