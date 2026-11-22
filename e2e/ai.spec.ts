import { expect, test } from "@playwright/test";
import { collectErrors, coverageOf, dist, pixel, tapImage, toScreen, waitForAi } from "./helpers";

// These tests run the real SlimSAM model in the browser (downloaded from the
// Hugging Face Hub on first use), so they are slower than the others.
test.describe.configure({ timeout: 180_000 });

// Points in public/samples/room.jpg (1600×1200).
const BACK_WALL = [700, 450] as const;
const SOFA = [950, 800] as const;
const CEILING = [800, 100] as const;
const LEFT_WALL = [370, 800] as const;
const FRAME = [1200, 430] as const;

async function openRoom(page: import("@playwright/test").Page, path = "/en/editor") {
  await page.goto(path);
  await page.getByTestId("sample-room").click();
  await expect(page.getByTestId("render-canvas")).toBeVisible();
  await waitForAi(page);
}

test("tap a wall: AI selects exactly that wall; variants; done", async ({ page, isMobile }) => {
  const errors = collectErrors(page);
  await openRoom(page);
  await expect(page.getByTestId("tool-smart")).toHaveAttribute("aria-checked", "true");

  const before = {
    wall: await pixel(page, ...BACK_WALL),
    sofa: await pixel(page, ...SOFA),
    ceiling: await pixel(page, ...CEILING),
    frame: await pixel(page, ...FRAME),
  };
  await tapImage(page, ...BACK_WALL, !!isMobile);

  await expect.poll(async () => dist(await pixel(page, ...BACK_WALL), before.wall), { timeout: 30_000 }).toBeGreaterThan(20);
  expect(dist(await pixel(page, ...SOFA), before.sofa)).toBeLessThan(4);
  expect(dist(await pixel(page, ...CEILING), before.ceiling)).toBeLessThan(4);
  expect(dist(await pixel(page, ...FRAME), before.frame)).toBeLessThan(4);
  // Scene understanding joins the other wall of the same colour; "This part only" undoes it.
  const joined = page.getByTestId("only-this-part");
  if (await joined.isVisible()) {
    expect(await coverageOf(page)).toBeGreaterThan(32);
    await joined.click();
    await expect.poll(() => coverageOf(page), { timeout: 30_000 }).toBeLessThan(32);
  }
  const cov = await coverageOf(page);
  expect(cov).toBeGreaterThan(18);
  expect(cov).toBeLessThan(32);

  // Alternative hypotheses: try a larger one and come back.
  const larger = page.getByTestId("variant-larger");
  await expect(larger).toBeVisible();
  if (await larger.isEnabled()) {
    await larger.click();
    await expect.poll(() => coverageOf(page)).not.toBeCloseTo(cov, 0);
    await page.getByTestId("variant-smaller").click();
    await expect.poll(() => coverageOf(page)).toBeCloseTo(cov, 0);
  }

  await page.getByTestId("smart-done").click();
  await expect(page.getByTestId("smart-done")).toBeHidden();
  expect(errors).toEqual([]);
});

test("remove mode takes a tapped surface away again", async ({ page, isMobile }) => {
  const errors = collectErrors(page);
  await openRoom(page, "/ar/editor");
  const wall = await pixel(page, ...BACK_WALL);
  await tapImage(page, ...BACK_WALL, !!isMobile);
  await expect.poll(() => coverageOf(page), { timeout: 30_000 }).toBeGreaterThan(18);
  await page.getByTestId("smart-done").click();

  await page.getByTestId("smart-erase").click();
  await tapImage(page, ...BACK_WALL, !!isMobile);
  await expect.poll(() => coverageOf(page), { timeout: 30_000 }).toBeLessThan(1);
  await expect.poll(async () => dist(await pixel(page, ...BACK_WALL), wall)).toBeLessThan(4);
  expect(errors).toEqual([]);
});

test("detect all surfaces, pick two, add them as surfaces", async ({ page, isMobile }) => {
  const errors = collectErrors(page);
  await openRoom(page, "/de/editor");
  const before = { ceiling: await pixel(page, ...CEILING), left: await pixel(page, ...LEFT_WALL), sofa: await pixel(page, ...SOFA) };

  await page.getByTestId("detect").click();
  const add = page.getByTestId("add-detected");
  await expect(add).toBeVisible({ timeout: 60_000 });
  await expect(add).toBeDisabled();
  await tapImage(page, ...CEILING, !!isMobile);
  await tapImage(page, ...LEFT_WALL, !!isMobile);
  await expect(add).toContainText("(2)");
  await add.click();
  await expect(add).toBeHidden({ timeout: 30_000 });

  // The empty first surface is reused, one more is created.
  await expect(page.getByTestId("surface-list").locator("li")).toHaveCount(2);
  await expect.poll(async () => dist(await pixel(page, ...CEILING), before.ceiling)).toBeGreaterThan(15);
  await expect.poll(async () => dist(await pixel(page, ...LEFT_WALL), before.left)).toBeGreaterThan(15);
  expect(dist(await pixel(page, ...SOFA), before.sofa)).toBeLessThan(4);
  expect(errors).toEqual([]);
});

test("server fallback computes embeddings on the server", async ({ page, isMobile }) => {
  const errors = collectErrors(page);
  await openRoom(page, "/en/editor?sam=server");
  await expect(page.getByTestId("ai-status")).toContainText("server");
  const wall = await pixel(page, ...BACK_WALL);
  await tapImage(page, ...BACK_WALL, !!isMobile);
  await expect.poll(async () => dist(await pixel(page, ...BACK_WALL), wall), { timeout: 30_000 }).toBeGreaterThan(20);
  const cov = await coverageOf(page);
  expect(cov).toBeGreaterThan(18);
  expect(cov).toBeLessThan(45); // the back wall, possibly joined with the same-coloured left wall
  expect(errors).toEqual([]);
});

test("snap edges: a sloppy brush stroke stops at the sofa", async ({ page, isMobile }) => {
  test.skip(!!isMobile, "brush precision test runs on desktop");
  const errors = collectErrors(page);
  await openRoom(page);
  await page.getByTestId("tool-brush").click();
  // Brush of ~72 image px diameter; stroke centred 30 px above the sofa's top edge (y = 640).
  const box = (await page.getByTestId("render-canvas").boundingBox())!;
  await page.getByLabel("Brush size").fill(String(Math.round((72 * box.width) / 1600)));
  const a = await toScreen(page, 700, 610);
  const b = await toScreen(page, 1200, 610);
  const sofaEdge = await pixel(page, 900, 643);
  const wallEdge = await pixel(page, 900, 630);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 20 });
  await page.mouse.up();
  await expect.poll(async () => dist(await pixel(page, 900, 643), sofaEdge)).toBeGreaterThan(10); // over-painted

  await page.getByTestId("refine").click();
  await expect(page.getByTestId("refine")).toBeEnabled({ timeout: 30_000 });
  await expect.poll(async () => dist(await pixel(page, 900, 643), sofaEdge)).toBeLessThan(6); // sofa clean again
  expect(dist(await pixel(page, 900, 630), wallEdge)).toBeGreaterThan(20); // wall still painted
  expect(errors).toEqual([]);
});

test("facade: tapping the wall paints the wall, not the whole house", async ({ page, isMobile }) => {
  const errors = collectErrors(page);
  await page.goto("/en/editor");
  await page.getByTestId("sample-facade").click();
  await waitForAi(page);
  // glass: centre of a pane of the lower-left window (not its white cross-bar).
  const pts = { wall: [600, 600], roof: [800, 250], door: [800, 850], glass: [345, 575], grass: [1300, 1100] } as const;
  type Key = keyof typeof pts;
  const before = {} as Record<Key, [number, number, number]>;
  for (const k of Object.keys(pts) as Key[]) before[k] = await pixel(page, pts[k][0], pts[k][1]);
  // Tap immediately: surface analysis may still be running; the selection is upgraded when it finishes.
  await tapImage(page, ...pts.wall, !!isMobile);
  await expect.poll(async () => dist(await pixel(page, ...pts.wall), before.wall), { timeout: 30_000 }).toBeGreaterThan(15);
  await expect.poll(() => coverageOf(page), { timeout: 60_000 }).toBeLessThan(35);
  for (const k of ["roof", "door", "glass", "grass"] as const) {
    expect(dist(await pixel(page, pts[k][0], pts[k][1]), before[k]), k).toBeLessThan(5);
  }
  expect(errors).toEqual([]);
});

test("paint all walls: one tap paints every wall and the ceiling separately", async ({ page }) => {
  const errors = collectErrors(page);
  await openRoom(page, "/ar/editor");
  const before = { back: await pixel(page, ...BACK_WALL), left: await pixel(page, ...LEFT_WALL), ceiling: await pixel(page, ...CEILING), sofa: await pixel(page, ...SOFA) };
  await page.getByTestId("paint-all-walls").click();
  await expect(page.getByTestId("surface-list").locator("li")).toHaveCount(2, { timeout: 60_000 });
  await expect.poll(async () => dist(await pixel(page, ...BACK_WALL), before.back), { timeout: 30_000 }).toBeGreaterThan(8);
  await expect.poll(async () => dist(await pixel(page, ...LEFT_WALL), before.left)).toBeGreaterThan(8);
  expect(dist(await pixel(page, ...SOFA), before.sofa)).toBeLessThan(5);
  // Surfaces get meaningful names.
  const names = await page.getByTestId("surface-list").locator("input").evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
  expect(names).toContain("الجدران");
  expect(names).toContain("السقف");
  expect(errors).toEqual([]);
});
