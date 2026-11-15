import type { Page } from "@playwright/test";

/** Size of public/samples/room.jpg and facade.jpg. */
export const IMG_W = 1600;
export const IMG_H = 1200;

export const dist = (a: number[], b: number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

/** Map image pixel coordinates to page coordinates of the render canvas. */
export async function toScreen(page: Page, x: number, y: number) {
  const box = await page.getByTestId("render-canvas").boundingBox();
  if (!box) throw new Error("canvas not visible");
  return { x: box.x + (x / IMG_W) * box.width, y: box.y + (y / IMG_H) * box.height };
}

/** Read a pixel of the rendered (recolored) image, in image coordinates. */
export async function pixel(page: Page, x: number, y: number): Promise<[number, number, number]> {
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


/** Tap a point given in image coordinates (touch on phones, click on desktop). */
export async function tapImage(page: Page, x: number, y: number, touch: boolean) {
  const p = await toScreen(page, x, y);
  if (touch) await page.touchscreen.tap(p.x, p.y);
  else await page.mouse.click(p.x, p.y);
}

/** Percentage shown for the given surface row (e.g. "25.5"). */
export async function coverageOf(page: Page, index = 0): Promise<number> {
  const text = await page.getByTestId("surface-list").locator("li").nth(index).innerText();
  const m = /([\d.]+)\s*%/.exec(text);
  return m ? Number(m[1]) : NaN;
}

export async function waitForAi(page: Page) {
  await page.getByTestId("ai-status").and(page.locator('[data-phase="ready"]')).waitFor({ timeout: 120_000 });
}

/** Choose a paint from the colour chart by its code (e.g. "RAL 5004" or "S 1050-Y90R"). */
export async function pickPaint(page: Page, code: string) {
  await page.getByTestId("tab-catalog").click();
  await page.getByTestId(code.startsWith("RAL") ? "scope-ral-classic" : "scope-ncs").click();
  await page.getByTestId("color-search").fill(code);
  await page.locator(`[data-testid="catalog-grid"] [data-code="${code}"]`).first().click();
}

/** Select a polygon (image coordinates) on the current surface with the lasso. */
export async function lassoSelect(page: Page, points: readonly (readonly [number, number])[]) {
  await page.getByTestId("tool-lasso").click();
  for (const [x, y] of points) {
    const p = await toScreen(page, x, y);
    await page.mouse.click(p.x, p.y);
  }
  const first = await toScreen(page, points[0]![0], points[0]![1]);
  await page.mouse.click(first.x, first.y); // tapping the first point closes the shape
}
