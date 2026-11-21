import { expect, test } from "@playwright/test";
import { collectErrors, dist, lassoSelect, pickPaint, pixel, tapImage } from "./helpers";

// Back wall of public/samples/room.jpg, avoiding the sofa and the picture.
const WALL_POLY = [[480, 260], [1040, 260], [1040, 600], [480, 600]] as const;

async function openRoomWithWall(page: import("@playwright/test").Page, path: string) {
  await page.goto(path);
  await page.getByTestId("sample-room").click();
  await expect(page.getByTestId("render-canvas")).toBeVisible();
  await expect.poll(async () => dist(await pixel(page, 700, 450), [0, 0, 0])).toBeGreaterThan(100);
  await lassoSelect(page, WALL_POLY);
  await expect(page.getByTestId("surface-list")).not.toContainText(" 0% ");
}

test("RAL chart: search in Arabic, apply a paint, the wall shows it", async ({ page }) => {
  const errors = collectErrors(page);
  await openRoomWithWall(page, "/ar/editor");
  await page.getByTestId("tab-catalog").click();
  await page.getByTestId("scope-ral-classic").click();
  await page.getByTestId("color-search").fill("أبيض نقي");
  const first = page.locator('[data-testid="catalog-grid"] button').first();
  await expect(first).toHaveAttribute("data-code", "RAL 9010");
  const before = await pixel(page, 700, 450);
  await first.click();
  await expect(page.getByTestId("current-code")).toHaveText("RAL 9010");
  await expect(page.getByTestId("current-paint")).toContainText("أبيض نقي");
  await expect(page.getByTestId("surface-list")).toContainText("RAL 9010");
  await expect.poll(async () => dist(await pixel(page, 700, 450), before)).toBeGreaterThan(8);
  const white = await pixel(page, 700, 450);
  expect(Math.min(...white)).toBeGreaterThan(200); // a white wall, lighting preserved

  // Family filter: only blues.
  await page.getByTestId("color-search").fill("");
  await page.getByTestId("family-blue").click();
  const codes = await page.locator('[data-testid="catalog-grid"] button').evaluateAll((els) => els.map((e) => e.getAttribute("data-hex")!));
  expect(codes.length).toBeGreaterThan(10);
  for (const hex of codes) expect(parseInt(hex.slice(5, 7), 16)).toBeGreaterThan(parseInt(hex.slice(1, 3), 16)); // blue > red
  expect(errors).toEqual([]);
});

test("NCS: find by code (also codes outside the chart) and apply", async ({ page }) => {
  const errors = collectErrors(page);
  await openRoomWithWall(page, "/de/editor");
  await pickPaint(page, "S 1050-Y90R");
  await expect(page.getByTestId("current-code")).toHaveText("S 1050-Y90R");
  const red = await pixel(page, 700, 450);
  expect(red[0]).toBeGreaterThan(red[2] + 30);

  await page.getByTestId("color-search").fill("ncs s 1052y92r");
  await expect(page.locator('[data-testid="catalog-grid"] button').first()).toHaveAttribute("data-code", "S 1052-Y92R");
  expect(errors).toEqual([]);
});

test("eyedropper → closest paints → use", async ({ page, isMobile }) => {
  const errors = collectErrors(page);
  await openRoomWithWall(page, "/en/editor");
  const sofa = await pixel(page, 950, 800);
  await page.getByTestId("tab-match").click();
  await page.getByTestId("eyedropper").click();
  await tapImage(page, 950, 800, !!isMobile);
  const hex = await page.getByTestId("picked-hex").innerText();
  const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  expect(dist(rgb, sofa)).toBeLessThan(12);
  const items = page.getByTestId("closest-list").locator("li");
  await expect(items).toHaveCount(6);
  await expect(items.first()).toContainText(/ΔE₀₀/);
  const use = items.first().locator("button");
  const code = (await use.getAttribute("data-testid"))!.replace(/^use-/, "");
  await use.click();
  await expect(page.getByTestId("current-code")).toHaveText(code);
  expect(errors).toEqual([]);
});

test("ideas: harmony palette and photo colours; apply palette to two surfaces", async ({ page }) => {
  const errors = collectErrors(page);
  await openRoomWithWall(page, "/en/editor");
  await page.getByTestId("add-surface").click();
  await lassoSelect(page, [[40, 820], [380, 880], [380, 1000], [40, 1100]]);

  await page.getByTestId("tab-ideas").click();
  // Current colour + colours found in the photo (sofa, floor…).
  await expect.poll(() => page.getByTestId("idea-bases").locator("button").count()).toBeGreaterThanOrEqual(3);
  await page.getByTestId("harmony-complementary").click();
  const palette = page.getByTestId("harmony-palette").locator("[data-code]");
  await expect(palette).toHaveCount(5);
  const second = (await palette.nth(1).getAttribute("data-code"))!;
  await palette.nth(1).click();
  await expect(page.getByTestId("current-code")).toHaveText(second);

  await page.getByTestId("harmony-palette-apply").click();
  const codes = await palette.evaluateAll((els) => els.map((e) => e.getAttribute("data-code")!));
  const list = await page.getByTestId("surface-list").innerText();
  expect(list).toContain(codes[0]!);
  expect(list).toContain(codes[1]!);

  // Style presets exist for all five styles.
  for (const s of ["modern", "scandinavian", "mediterranean", "classic", "moroccan"]) await expect(page.getByTestId(`style-${s}`).locator("[data-code]")).toHaveCount(5);
  expect(errors).toEqual([]);
});

test("work is saved: after a reload or going back, 'Continue' restores walls and colours", async ({ page }) => {
  const errors = collectErrors(page);
  await openRoomWithWall(page, "/en/editor");
  await pickPaint(page, "RAL 5004");
  await expect(page.getByTestId("current-code")).toHaveText("RAL 5004");
  const painted = await pixel(page, 700, 450);
  await page.waitForTimeout(2500); // autosave is debounced

  // Simulates the browser reloading the page (e.g. a phone running low on memory).
  await page.reload();
  await expect(page.getByTestId("resume")).toBeVisible();
  await page.getByTestId("resume-button").click();
  await expect(page.getByTestId("current-code")).toHaveText("RAL 5004");
  await expect(page.getByTestId("surface-list")).toContainText("RAL 5004");
  await expect.poll(async () => dist(await pixel(page, 700, 450), painted)).toBeLessThan(12);

  // Back (button or edge swipe) returns to the upload screen of the editor, not the home page.
  await page.goBack();
  await expect(page).toHaveURL(/\/en\/editor$/);
  await expect(page.getByTestId("resume")).toBeVisible();
  expect(errors).toEqual([]);
});
