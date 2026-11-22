import { expect, test, type Page } from "@playwright/test";
import { collectErrors, dist, goStep, lassoSelect, pixel } from "./helpers";

const WALL_POLY = [[480, 260], [1040, 260], [1040, 600], [480, 600]] as const;

async function openRoomWithWall(page: Page, path: string) {
  await page.goto(path);
  await page.getByTestId("sample-room").click();
  await expect(page.getByTestId("render-canvas")).toBeVisible();
  await expect.poll(async () => dist(await pixel(page, 700, 450), [0, 0, 0])).toBeGreaterThan(100);
  await lassoSelect(page, WALL_POLY);
  await expect(page.getByTestId("surface-list")).not.toContainText(" 0% ");
}

test("save & send: paint quantity in cans, WhatsApp message to the shop, remembered", async ({ page }) => {
  const errors = collectErrors(page);
  await openRoomWithWall(page, "/en/editor");
  await goStep(page, "share");
  await expect(page.getByTestId("color-summary")).toContainText("RAL 6021");

  const qty = page.getByTestId("quantity");
  await qty.getByTestId("qty-mode-wall").click();
  await qty.getByTestId("qty-a").fill("4");
  await qty.getByTestId("qty-height").fill("2,5"); // comma decimals work
  await qty.getByRole("button", { name: "More Doors" }).click();
  // 4 × 2.5 − one door (1.9 m²) = 8.1 m²; 2 coats, 10 m²/L, +10 % → 1.8 L → one 2.5 L can.
  await expect(qty.getByTestId("qty-result")).toContainText("1.8 litres for 8.1 m²");
  await expect(qty.getByTestId("qty-result")).toContainText("1 × 2.5 L");

  const text = page.getByTestId("send-text");
  await expect(text).toContainText("RAL 6021");
  await expect(text).toContainText("8.1 m²");
  await expect(text).toContainText("1 × 2.5 L");
  const href = await page.getByTestId("send-whatsapp").getAttribute("href");
  expect(href).toMatch(/^https:\/\/wa\.me\/\d*\?text=/);
  expect(decodeURIComponent(href!.split("text=")[1]!)).toContain("RAL 6021");

  // Three coats → more paint.
  await qty.getByRole("radio", { name: "3" }).click();
  await expect(qty.getByTestId("qty-result")).toContainText("2.7 litres");

  // Sizes are saved with the work.
  await page.waitForTimeout(1800);
  await page.reload();
  await page.getByTestId("resume-button").click();
  await goStep(page, "share");
  await expect(page.getByTestId("qty-result")).toContainText("2.7 litres for 8.1 m²");
  expect(errors).toEqual([]);
});

test("QR poster for the shop points to the editor and can be printed", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/ar");
  await page.getByTestId("qr-link").click();
  await expect(page).toHaveURL(/\/ar\/qr$/);
  const qr = page.getByTestId("qr-code");
  await expect(qr.locator("svg")).toBeVisible();
  expect(await qr.getAttribute("data-url")).toMatch(/^https?:\/\/[^/]+\/ar\/editor$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("جرّب ألواننا");
  await expect(page.getByTestId("print")).toBeVisible();
  expect(errors).toEqual([]);
});
