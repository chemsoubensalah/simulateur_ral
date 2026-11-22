import { expect, test, type Page } from "@playwright/test";
import { collectErrors, dist, goStep, lassoSelect, pixel } from "./helpers";

// Back wall of public/samples/room.jpg, avoiding the sofa and the picture.
const WALL_POLY = [[480, 260], [1040, 260], [1040, 600], [480, 600]] as const;
const SOFA = [950, 800] as const;

async function openRoomWithWall(page: Page, path: string) {
  await page.goto(path);
  await page.getByTestId("sample-room").click();
  await expect(page.getByTestId("render-canvas")).toBeVisible();
  await expect.poll(async () => dist(await pixel(page, 700, 450), [0, 0, 0])).toBeGreaterThan(100);
  await lassoSelect(page, WALL_POLY);
  await expect(page.getByTestId("surface-list")).not.toContainText(" 0% ");
}

/** Checksum of the rendered wall area (changes when any pixel there changes). */
function wallChecksum(page: Page): Promise<number> {
  return page.getByTestId("render-canvas").evaluate((c: HTMLCanvasElement) => {
    const tmp = document.createElement("canvas");
    tmp.width = c.width;
    tmp.height = c.height;
    const ctx = tmp.getContext("2d")!;
    ctx.drawImage(c, 0, 0);
    const d = ctx.getImageData(500, 280, 520, 300).data;
    let s = 0;
    for (let i = 0; i < d.length; i += 4) s = (s * 31 + d[i]! * 3 + d[i + 1]! * 5 + d[i + 2]!) % 1_000_000_007;
    return s;
  });
}

test("hide stains and defects: on by default, can be switched off, remembered after reload", async ({ page }) => {
  const errors = collectErrors(page);
  await openRoomWithWall(page, "/en/editor");
  await goStep(page, "colors");
  const toggle = page.getByTestId("cleanup");
  await expect(toggle).toBeChecked();
  const clean = await wallChecksum(page);
  await toggle.uncheck();
  await expect.poll(() => wallChecksum(page)).not.toBe(clean);
  const raw = await wallChecksum(page);
  await toggle.check();
  await expect.poll(() => wallChecksum(page)).toBe(clean);

  // The choice is saved with the session.
  await toggle.uncheck();
  await expect.poll(() => wallChecksum(page)).toBe(raw);
  await page.waitForTimeout(1800); // autosave debounce
  await page.reload();
  await page.getByTestId("resume-button").click();
  await expect(page.getByTestId("cleanup")).not.toBeChecked();
  expect(errors).toEqual([]);
});

test("lighting: evening lamps warm the whole room, back to the photo exactly", async ({ page }) => {
  const errors = collectErrors(page);
  await openRoomWithWall(page, "/ar/editor");
  await goStep(page, "colors");
  await expect(page.getByTestId("light-photo")).toHaveAttribute("aria-checked", "true");
  const sofa = await pixel(page, ...SOFA);
  const wall = await pixel(page, 700, 450);

  await page.getByTestId("light-evening").click();
  await expect(page.getByTestId("light-evening")).toHaveAttribute("aria-checked", "true");
  await expect.poll(async () => dist(await pixel(page, ...SOFA), sofa)).toBeGreaterThan(5);
  const warmSofa = await pixel(page, ...SOFA);
  const warmWall = await pixel(page, 700, 450);
  // Warmer: more red relative to blue, on the photo and on the paint.
  expect(warmSofa[0] - warmSofa[2]).toBeGreaterThan(sofa[0] - sofa[2]);
  expect(warmWall[0] - warmWall[2]).toBeGreaterThan(wall[0] - wall[2]);

  // Before / after compares under the same light.
  await page.getByTestId("toggle-compare").click();
  await expect(page.getByTestId("compare-slider")).toBeVisible();
  await page.getByTestId("toggle-compare").click();

  await page.getByTestId("light-day").click();
  await page.getByTestId("light-photo").click();
  await expect.poll(async () => dist(await pixel(page, ...SOFA), sofa)).toBeLessThan(2);
  expect(dist(await pixel(page, 700, 450), wall)).toBeLessThan(2);
  expect(errors).toEqual([]);
});
