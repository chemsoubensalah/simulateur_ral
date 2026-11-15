import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

const SAMPLE = path.join(process.cwd(), "public", "samples", "room.jpg");
const IMG_W = 1600;
const IMG_H = 1200;

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

/** Map image pixel coordinates to page coordinates of the render canvas. */
async function toScreen(page: Page, x: number, y: number) {
  const box = await page.getByTestId("render-canvas").boundingBox();
  if (!box) throw new Error("canvas not visible");
  return { x: box.x + (x / IMG_W) * box.width, y: box.y + (y / IMG_H) * box.height };
}

/** Read a pixel of the rendered (recolored) image, in image coordinates. */
async function pixel(page: Page, x: number, y: number): Promise<[number, number, number]> {
  return page.getByTestId("render-canvas").evaluate(
    (c: HTMLCanvasElement, [px, py]) => {
      const tmp = document.createElement("canvas");
      tmp.width = c.width;
      tmp.height = c.height;
      const ctx = tmp.getContext("2d")!;
      ctx.drawImage(c, 0, 0);
      const d = ctx.getImageData(px, py, 1, 1).data;
      return [d[0], d[1], d[2]] as [number, number, number];
    },
    [x, y] as const,
  );
}

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

const dist = (a: number[], b: number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

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
  const errors = collectErrors(page);
  await page.goto("/en/editor");
  await page.getByTestId("file-input").setInputFiles(SAMPLE);
  await expect(page.getByTestId("render-canvas")).toBeVisible();
  await expect(page.getByTestId("tool-brush")).toHaveAttribute("aria-checked", "true");
  // Wait until the first frame is rendered.
  await expect.poll(async () => dist(await pixel(page, 700, 450), [0, 0, 0])).toBeGreaterThan(100);

  const wallBefore = await pixel(page, 700, 450);
  const sofaBefore = await pixel(page, 950, 800);

  // Large brush for the test.
  if (!isMobile) await page.getByLabel("Brush size").fill("160");
  else await page.getByLabel("Brush size").fill("90");
  await paintBackWall(page, !!isMobile);

  // Default color of the first surface is a sage green (#8E9F88).
  await expect.poll(async () => dist(await pixel(page, 700, 450), wallBefore)).toBeGreaterThan(20);
  const sage = await pixel(page, 700, 450);
  expect(sage[1]).toBeGreaterThan(sage[2]); // greenish
  // Unpainted sofa is untouched.
  expect(dist(await pixel(page, 950, 800), sofaBefore)).toBeLessThan(3);
  await expect(page.getByTestId("surface-list")).toContainText("% of image");

  // Change to a dark navy paint: wall gets dark but keeps lighting variation.
  await page.locator('[data-hex="#1E2733"]').click();
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
  expect(download.suggestedFilename()).toMatch(/^colorvision-.*\.jpg$/);

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
  await page.getByTestId("tool-lasso").click();
  for (const [x, y] of [[40, 820], [380, 880], [380, 1000], [40, 1100]] as const) {
    const p = await toScreen(page, x, y);
    await page.mouse.click(p.x, p.y);
  }
  await page.getByRole("button", { name: "Fertig" }).click();
  await expect.poll(async () => dist(await pixel(page, 200, 900), before)).toBeGreaterThan(15);
  expect(errors).toEqual([]);
});
