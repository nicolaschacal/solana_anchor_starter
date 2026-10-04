import { describe, it, expect } from "vitest";
import { selectedCompanion } from "./useSelectedRebyter";
describe("selected companion", () => {
  const mammal = { mint: "mammal" },
    wolf = { mint: "wolf" };
  it("retains the selected mint when refreshed results reorder", () => {
    expect(selectedCompanion([wolf, mammal], "mammal", true)).toBe(mammal);
    expect(selectedCompanion([mammal, wolf], "mammal", true)).toBe(mammal);
  });
  it("does not switch to the first mint while selected data is loading", () => {
    expect(selectedCompanion([wolf], "mammal", false)).toBeUndefined();
  });
  it("falls back only when ownership is fully loaded or no selection exists", () => {
    expect(selectedCompanion([wolf], "mammal", true)).toBe(wolf);
    expect(selectedCompanion([wolf], "", false)).toBe(wolf);
  });
});
