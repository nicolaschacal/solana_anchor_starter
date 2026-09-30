import { chromium, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { sampleMammal } from "../src/lib/rebyters/sample";
import { immediateEvolutionNeighborhood } from "../src/lib/rebyters/graph";
const base = process.env.ATLAS_URL || "http://localhost:5174";
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
});
const errors: string[] = [];
await mkdir("../artifacts/screenshots", { recursive: true });
try {
  for (const [name, width, height] of [
    ["desktop", 1440, 1000],
    ["tablet", 900, 1000],
    ["mobile", 390, 844],
  ] as const) {
    if (process.argv.includes("--mobile") && name !== "mobile") continue;
    const page = await browser.newPage({
      viewport: { width, height },
      colorScheme: "light",
    });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${base}/admin/families/0?sample=1`);
    const filters = page.getByRole("group", { name: "Filter by stage" });
    await expect(page.locator(".specimen-tile")).toHaveCount(
      width <= 600 ? 1 : 58,
    );
    await filters.getByRole("button", { name: /^All / }).click();
    await expect(page.locator(".specimen-tile")).toHaveCount(58);
    await expect(page.locator(".collection-stage")).toHaveCount(6);
    if (width >= 1200) {
      const bounds = await page.locator(".collection-overview").boundingBox();
      expect(bounds!.height).toBeLessThan(830);
    }
    const bit = await page
      .locator('.collection-stage[data-stage="0"]')
      .boundingBox();
    const byte = await page
      .locator('.collection-stage[data-stage="1"]')
      .boundingBox();
    expect(byte!.y).toBeGreaterThanOrEqual(bit!.y + bit!.height);
    expect(byte!.x).toBe(bit!.x);
    expect(byte!.width).toBe(bit!.width);
    await page.getByRole("button", { name: "Dark mode", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator(".specimen-tile").first()).toHaveCSS(
      "background-color",
      "rgb(34, 42, 38)",
    );
    await page.screenshot({
      path: `../artifacts/screenshots/${name}-dark-collection.png`,
      fullPage: true,
    });
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Dark mode", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.getByRole("button", { name: "Dark mode", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.getByRole("button", { name: "All forms", exact: true }).click();
    await page.screenshot({
      path: `../artifacts/screenshots/${name}-grouped-all.png`,
      fullPage: true,
    });
    await filters.getByRole("button", { name: /^MEGA / }).click();
    await expect(page.locator(".specimen-tile")).toHaveCount(22);
    const row = await page
      .locator(".specimen-tile")
      .evaluateAll((elements) =>
        elements.slice(0, 2).map((e) => e.getBoundingClientRect().top),
      );
    expect(row[0]).toBe(row[1]);
    await page.screenshot({
      path: `../artifacts/screenshots/${name}-grouped-mega.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "Dark mode", exact: true }).click();
    await page.getByRole("button", { name: "Fox, MEGA", exact: true }).click();
    await expect(page.locator(".creature-node.is-selected strong")).toHaveText(
      "Fox",
    );
    await page
      .getByRole("button", { name: "Back to collection", exact: true })
      .click();
    await expect(page.locator(".specimen-tile")).toHaveCount(22);
    await expect(
      filters.getByRole("button", { name: /^MEGA / }),
    ).toHaveAttribute("aria-pressed", "true");
    await page
      .getByRole("textbox", { name: "Find a creature" })
      .fill("Musteloid");
    await expect(page.locator(".specimen-tile")).toHaveCount(1);
    await expect(page.locator(".specimen-tile strong")).toHaveText("Musteloid");
    await page
      .getByRole("textbox", { name: "Find a creature" })
      .fill("zz-no-match");
    await expect(page.getByText("No matching specimens.")).toBeVisible();
    await page.getByRole("button", { name: "All forms", exact: true }).click();
    await expect(page.locator(".specimen-tile")).toHaveCount(58);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
    await page
      .getByRole("button", { name: "Connection map", exact: true })
      .click();
    await expect(page.locator(".creature-node")).toHaveCount(58);
    await expect(page.locator(".react-flow__edge")).toHaveCount(85);
    await expect(page.locator(".stage-label")).toHaveCount(6);
    await page.waitForTimeout(750);
    await page.screenshot({
      path: `../artifacts/screenshots/${name}-atlas.png`,
      fullPage: true,
    });
    const before = await page
      .locator(".atlas-viewport-tools > span")
      .innerText();
    await page.getByRole("button", { name: "Zoom in", exact: true }).click();
    await expect(page.locator(".atlas-viewport-tools > span")).not.toHaveText(
      before,
    );
    await page
      .getByRole("button", { name: "Fit visible tree", exact: true })
      .click();
    const tree = sampleMammal();
    for (const target of [
      "mammal.exe",
      "Musteloid",
      "Moon Beast",
      "Wolverine",
      "Kitsune",
    ]) {
      await page.getByRole("textbox", { name: "Find a creature" }).fill(target);
      await page
        .locator(".atlas-results button")
        .filter({ hasText: target })
        .click();
      const specimen = tree.evolutions.find((e) => e.name === target)!;
      const expected = immediateEvolutionNeighborhood(tree, specimen.id)
        .map((e) => e.name)
        .sort();
      await expect(
        page.locator(".creature-node.is-selected strong"),
      ).toHaveText(target);
      await expect(page.locator(".creature-node")).toHaveCount(expected.length);
      await expect(
        page.locator(".creature-node .node-rule-summary"),
      ).toHaveCount(0);
      const actual = await page
        .locator(".creature-node strong")
        .allTextContents();
      expect(actual.sort()).toEqual(expected);
      if (target === "Musteloid") {
        await page.waitForTimeout(500);
        await page.screenshot({
          path: `../artifacts/screenshots/${name}-lineage.png`,
          fullPage: true,
        });
      }
    }
    await page
      .getByRole("button", { name: "Back to collection", exact: true })
      .click();
    await expect(page.locator(".creature-node")).toHaveCount(58);
    await page
      .getByRole("button", { name: "Center origin", exact: true })
      .click();
    await page.waitForTimeout(400);
    await page
      .getByRole("button", { name: "mammal.exe, BIT", exact: true })
      .click();
    await expect(page.locator(".creature-node")).toHaveCount(5);
    await page.reload();
    await expect(page.locator(".creature-node.is-selected strong")).toHaveText(
      "mammal.exe",
    );
    await page.getByRole("button", { name: "View JSON", exact: true }).click();
    await expect(
      page.getByRole("dialog", { name: "JSON preview" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Close JSON", exact: true }).click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
    const secret = await page.request.get(
      `${base}/@fs/workspaces/codespaces-blank/solana_anchor_starter/artifacts/private/admin-keypair.json`,
    );
    expect(secret.status()).toBe(403);
    if (process.argv.includes("--live")) {
      await page.goto(`${base}/admin`);
      await expect(
        page.getByText("Verified against Solana", { exact: false }),
      ).toBeVisible({ timeout: 60000 });
      await expect(page.locator(".specimen-tile")).toHaveCount(
        width <= 600 ? 1 : 58,
      );
      await page
        .getByRole("button", { name: "All forms", exact: true })
        .click();
      await expect(page.locator(".specimen-tile")).toHaveCount(58);
      await page.waitForTimeout(600);
      await page.screenshot({
        path: `../artifacts/screenshots/${name}-atlas-live.png`,
        fullPage: true,
      });
    }
    await page.close();
    console.log(
      `${name}: grouped stages, compact wrapping, filter persistence, global search, 58 forms, 85 edges, direct lineage, zoom, navigation, JSON and no overflow`,
    );
  }
  expect(errors).toEqual([]);
} finally {
  await browser.close();
}
