import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { collectErrors, dist, goStep, openAdvanced, pickPaint, pixel, selectTool, toScreen } from "./helpers";

const SAMPLE = path.join(process.cwd(), "public", "samples", "room.jpg");

/** Paint the back wall (image region x 480–1020, y 280–600) with horizontal strokes. */
async function paintBackWall(page: Page, touch: boolean) {
  const rows = [300, 360, 420, 480, 540, 590];
  if (touch) {
    const cdp = await page.context().newCDPSession(page);
    for (const y of rows) {
      const a = await toScreen(page, 480, y);
      const b = await toScreen(page, 1020, y);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: a.x, y: a.y }] });
      for (let i = 1; i <= 12; i++) {
        const x = a.x + ((b.x - a.x) * i) / 12;
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: a.y }] });
      }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    }
  } else {
    for (const y of rows) {
      const a = await toScreen(page, 480, y);
      const b = await toScreen(page, 1020, y);
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      await page.mouse.move(b.x, b.y, { steps: 12 });
      await page.mouse.up();
    }
  }
}


test("root redirects to Arabic with RTL layout", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/ar$/);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("أعد طلاء");
});

test("language switcher changes locale and direction", async ({ page }) => {
  await page.goto("/ar");
  await page.getByLabel("اللغة").selectOption("de");
  await expect(page).toHaveURL(/\/de$/);
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Streichen");
});

test("upload → paint wall → change color → compare → undo → download", async ({ page, isMobile }) => {
  // Long flow (brush strokes, two downloads); slower while the AI tests run in parallel.
  test.setTimeout(150_000);
  const errors = collectErrors(page);
  await page.goto("/en/editor");
  await page.getByTestId("file-input").setInputFiles(SAMPLE);
  await expect(page.getByTestId("render-canvas")).toBeVisible();
  // Easy mode: three steps, the walls step first; photo tips were shown before.
  await expect(page.getByTestId("step-walls")).toHaveAttribute("aria-current", "step");
  // Smart select (AI) is the default tool; this test covers the manual brush (under "More tools").
  await openAdvanced(page);
  await expect(page.getByTestId("tool-smart")).toHaveAttribute("aria-checked", "true");
  await selectTool(page, "brush");
  await expect(page.getByTestId("tool-brush")).toHaveAttribute("aria-checked", "true");
  // Wait until the first frame is rendered.
  await expect.poll(async () => dist(await pixel(page, 700, 450), [0, 0, 0])).toBeGreaterThan(100);

  const wallBefore = await pixel(page, 700, 450);
  const sofaBefore = await pixel(page, 950, 800);

  // Large brush for the test.
  if (!isMobile) await page.getByLabel("Brush size").fill("160");
  else await page.getByLabel("Brush size").fill("90");
  await paintBackWall(page, !!isMobile);

  // Default paint of the first surface is RAL 6021 Pale green.
  await expect.poll(async () => dist(await pixel(page, 700, 450), wallBefore)).toBeGreaterThan(20);
  const sage = await pixel(page, 700, 450);
  expect(sage[1]).toBeGreaterThan(sage[2]); // greenish
  // Unpainted sofa is untouched.
  expect(dist(await pixel(page, 950, 800), sofaBefore)).toBeLessThan(3);
  await expect(page.getByTestId("surface-list")).toContainText("% of image");

  // Change to a dark navy paint: wall gets dark but keeps lighting variation.
  await pickPaint(page, "RAL 5004"); // Black blue
  await expect.poll(async () => (await pixel(page, 700, 450)).reduce((a, b) => a + b, 0)).toBeLessThan(200);
  const lit = await pixel(page, 700, 450); // near the sunlit patch
  const dark = await pixel(page, 990, 590); // darker corner
  expect(lit.reduce((a, b) => a + b) / 3).toBeGreaterThan(dark.reduce((a, b) => a + b) / 3);

  // Finish: gloss / matte switch keeps working.
  await page.getByTestId("finish-gloss").click();
  await expect(page.getByTestId("finish-gloss")).toHaveAttribute("aria-checked", "true");

  // Before/after slider.
  await page.getByTestId("toggle-compare").click();
  const slider = page.getByTestId("compare-slider");
  await expect(slider).toBeAttached();
  await slider.fill("100");
  await page.getByTestId("toggle-compare").click();

  // Undo all strokes restores the original wall.
  const undo = page.getByTestId("undo");
  while (await undo.isEnabled()) await undo.click();
  await expect.poll(async () => dist(await pixel(page, 700, 450), wallBefore)).toBeLessThan(3);
  // Redo re-applies the first stroke (row y = 300) only.
  const row1Before = await pixel(page, 700, 300);
  await page.getByTestId("redo").click();
  await expect.poll(async () => dist(await pixel(page, 700, 300), row1Before)).toBeGreaterThan(20);

  // Export.
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("download").click()]);
  expect(download.suggestedFilename()).toMatch(/^alsy-paints-.*\.jpg$/);

  // Last step: summary of the chosen colours and a big save button.
  await goStep(page, "share");
  await expect(page.getByTestId("color-summary")).toContainText("RAL 5004");
  const [again] = await Promise.all([page.waitForEvent("download"), page.getByTestId("download-big").click()]);
  expect(again.suggestedFilename()).toMatch(/\.jpg$/);

  expect(errors).toEqual([]);
});

test("lasso adds a polygon to the selection; multiple surfaces", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/de/editor");
  await page.getByTestId("sample-room").click();
  await expect(page.getByTestId("render-canvas")).toBeVisible();
  await expect.poll(async () => dist(await pixel(page, 200, 900), [0, 0, 0])).toBeGreaterThan(50);
  const before = await pixel(page, 200, 900); // left wall, lower part

  await page.getByTestId("add-surface").click();
  await expect(page.getByTestId("surface-list").locator("li")).toHaveCount(2);
  await selectTool(page, "lasso");
  for (const [x, y] of [[40, 820], [380, 880], [380, 1000], [40, 1100]] as const) {
    const p = await toScreen(page, x, y);
    await page.mouse.click(p.x, p.y);
  }
  await page.getByRole("button", { name: "Fertig" }).click();
  await expect.poll(async () => dist(await pixel(page, 200, 900), before)).toBeGreaterThan(15);
  expect(errors).toEqual([]);
});
