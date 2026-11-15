// Renders the two synthetic sample photos in public/samples/ (room.jpg, facade.jpg)
// with a headless browser canvas. Synthetic scenes keep the repo free of
// third-party photo licensing while still having shading, texture and
// occlusion so the recoloring can be evaluated. Run: npm run samples
import { chromium } from "playwright";
import { writeFile, mkdir } from "node:fs/promises";

const OUT = new URL("../public/samples/", import.meta.url);

function scene() {
  /* executed in the browser */
  const rand = (() => {
    let s = 1234567;
    return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  })();

  function addNoise(ctx, w, h, amount) {
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (rand() - 0.5) * amount;
      d[i] += n;
      d[i + 1] += n;
      d[i + 2] += n;
    }
    ctx.putImageData(img, 0, 0);
  }

  function poly(ctx, pts) {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
  }

  function room() {
    const W = 1600, H = 1200;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const ctx = c.getContext("2d");
    // Geometry (one-point perspective)
    const bw = [[420, 230], [1600, 230], [1600, 860], [420, 860]]; // back wall
    const lw = [[0, 0], [420, 230], [420, 860], [0, 1200]]; // left wall
    const ceil = [[0, 0], [1600, 0], [1600, 230], [420, 230]];
    const floor = [[0, 1200], [420, 860], [1600, 860], [1600, 1200]];

    // Ceiling
    poly(ctx, ceil);
    let g = ctx.createLinearGradient(0, 0, 0, 230);
    g.addColorStop(0, "#d9d6d0"); g.addColorStop(1, "#ecebe6");
    ctx.fillStyle = g; ctx.fill();

    // Back wall: warm off-white with light falloff from the window (left)
    poly(ctx, bw);
    g = ctx.createLinearGradient(420, 0, 1600, 0);
    g.addColorStop(0, "#f1ece2"); g.addColorStop(0.55, "#e4ddd0"); g.addColorStop(1, "#c9c1b3");
    ctx.fillStyle = g; ctx.fill();
    // vertical falloff
    ctx.save(); poly(ctx, bw); ctx.clip();
    g = ctx.createLinearGradient(0, 230, 0, 860);
    g.addColorStop(0, "rgba(0,0,0,0.08)"); g.addColorStop(0.3, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,0.12)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // soft sunlight patch
    const rg = ctx.createRadialGradient(700, 520, 30, 700, 520, 420);
    rg.addColorStop(0, "rgba(255,248,230,0.35)"); rg.addColorStop(1, "rgba(255,248,230,0)");
    ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
    // corner occlusion
    g = ctx.createLinearGradient(420, 0, 520, 0);
    g.addColorStop(0, "rgba(0,0,0,0.18)"); g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g; ctx.fillRect(420, 0, 120, H);
    ctx.restore();

    // Left wall (darker, side-lit) with window
    poly(ctx, lw);
    g = ctx.createLinearGradient(0, 0, 420, 0);
    g.addColorStop(0, "#cfc8bb"); g.addColorStop(1, "#b8b0a2");
    ctx.fillStyle = g; ctx.fill();
    // window
    const win = [[90, 230], [300, 330], [300, 700], [90, 760]];
    poly(ctx, win);
    g = ctx.createLinearGradient(90, 230, 300, 700);
    g.addColorStop(0, "#f7fbff"); g.addColorStop(1, "#cfe3f3");
    ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = 14; ctx.strokeStyle = "#f4f2ee"; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(195, 280); ctx.lineTo(195, 730); ctx.lineWidth = 8; ctx.stroke();

    // Floor: wooden planks
    ctx.save(); poly(ctx, floor); ctx.clip();
    ctx.fillStyle = "#9b6f48"; ctx.fillRect(0, 860, W, 340);
    for (let i = -30; i < 40; i++) {
      const x0 = 1010 + i * 60;
      ctx.beginPath(); ctx.moveTo(1010 + i * 22, 860); ctx.lineTo(x0 + i * 40, 1200);
      ctx.strokeStyle = "rgba(60,35,15,0.35)"; ctx.lineWidth = 2; ctx.stroke();
    }
    g = ctx.createLinearGradient(0, 860, 0, 1200);
    g.addColorStop(0, "rgba(0,0,0,0.25)"); g.addColorStop(1, "rgba(255,230,200,0.08)");
    ctx.fillStyle = g; ctx.fillRect(0, 860, W, 340);
    ctx.restore();
    // skirting board
    ctx.fillStyle = "#f3f1ec"; ctx.fillRect(420, 838, 1180, 22);

    // Picture frame on back wall
    ctx.fillStyle = "rgba(0,0,0,0.18)"; ctx.fillRect(1078, 338, 300, 210);
    ctx.fillStyle = "#3a332c"; ctx.fillRect(1070, 330, 300, 210);
    g = ctx.createLinearGradient(1085, 345, 1355, 525);
    g.addColorStop(0, "#c98f5c"); g.addColorStop(0.5, "#5f8c8a"); g.addColorStop(1, "#2f4f6b");
    ctx.fillStyle = g; ctx.fillRect(1085, 345, 270, 180);

    // Sofa with contact shadow
    const sg = ctx.createRadialGradient(950, 900, 50, 950, 900, 420);
    sg.addColorStop(0, "rgba(0,0,0,0.35)"); sg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = sg; ctx.fillRect(500, 760, 900, 300);
    ctx.fillStyle = "#3e4a59";
    ctx.beginPath(); ctx.roundRect(620, 640, 660, 150, 28); ctx.fill();
    ctx.fillStyle = "#475566";
    ctx.beginPath(); ctx.roundRect(600, 740, 700, 150, 30); ctx.fill();
    ctx.fillStyle = "#56667a";
    ctx.beginPath(); ctx.roundRect(650, 670, 180, 120, 22); ctx.fill();
    ctx.beginPath(); ctx.roundRect(1070, 670, 180, 120, 22); ctx.fill();
    ctx.fillStyle = "#2b333d"; ctx.fillRect(640, 885, 18, 40); ctx.fillRect(1242, 885, 18, 40);

    // Plant
    ctx.fillStyle = "#b5532e"; ctx.beginPath(); ctx.moveTo(1400, 760); ctx.lineTo(1500, 760); ctx.lineTo(1485, 900); ctx.lineTo(1415, 900); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#3f6b3a";
    for (let i = 0; i < 18; i++) {
      ctx.beginPath();
      const a = -Math.PI / 2 + (rand() - 0.5) * 2.2;
      ctx.ellipse(1450 + Math.cos(a) * 80, 700 + Math.sin(a) * 90, 18, 55, a + Math.PI / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    addNoise(ctx, W, H, 9);
    return c.toDataURL("image/jpeg", 0.9);
  }

  function facade() {
    const W = 1600, H = 1200;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const ctx = c.getContext("2d");
    let g = ctx.createLinearGradient(0, 0, 0, 500);
    g.addColorStop(0, "#7fb2e5"); g.addColorStop(1, "#d6e8f7");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // ground
    ctx.fillStyle = "#6c8f4e"; ctx.fillRect(0, 1000, W, 200);
    ctx.fillStyle = "#b9b3a8"; ctx.fillRect(700, 1000, 200, 200);
    // wall (stucco)
    const wall = [[200, 380], [1400, 380], [1400, 1010], [200, 1010]];
    poly(ctx, wall);
    g = ctx.createLinearGradient(200, 0, 1400, 0);
    g.addColorStop(0, "#efe2c8"); g.addColorStop(1, "#d9c9aa");
    ctx.fillStyle = g; ctx.fill();
    ctx.save(); poly(ctx, wall); ctx.clip();
    // eave shadow
    g = ctx.createLinearGradient(0, 380, 0, 520);
    g.addColorStop(0, "rgba(40,30,20,0.45)"); g.addColorStop(1, "rgba(40,30,20,0)");
    ctx.fillStyle = g; ctx.fillRect(0, 380, W, 140);
    // ground bounce
    g = ctx.createLinearGradient(0, 860, 0, 1010);
    g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(30,40,10,0.18)");
    ctx.fillStyle = g; ctx.fillRect(0, 860, W, 150);
    ctx.restore();
    // roof
    poly(ctx, [[140, 390], [800, 120], [1460, 390]]);
    g = ctx.createLinearGradient(0, 120, 0, 390);
    g.addColorStop(0, "#8e3b26"); g.addColorStop(1, "#b2533a");
    ctx.fillStyle = g; ctx.fill();
    for (let y = 150; y < 390; y += 22) {
      ctx.beginPath(); ctx.moveTo(140, y + 0); ctx.lineTo(1460, y);
      ctx.strokeStyle = "rgba(60,20,10,0.25)"; ctx.lineWidth = 2;
      ctx.save(); poly(ctx, [[140, 390], [800, 120], [1460, 390]]); ctx.clip(); ctx.stroke(); ctx.restore();
    }
    // windows
    const drawWin = (x, y, w, h) => {
      ctx.fillStyle = "rgba(0,0,0,0.2)"; ctx.fillRect(x + 6, y + 6, w, h);
      ctx.fillStyle = "#f6f4ef"; ctx.fillRect(x - 10, y - 10, w + 20, h + 20);
      const wg = ctx.createLinearGradient(x, y, x + w, y + h);
      wg.addColorStop(0, "#9cc3e0"); wg.addColorStop(1, "#43617a");
      ctx.fillStyle = wg; ctx.fillRect(x, y, w, h);
      ctx.fillStyle = "#f6f4ef"; ctx.fillRect(x + w / 2 - 4, y, 8, h); ctx.fillRect(x, y + h / 2 - 4, w, 8);
    };
    drawWin(300, 520, 180, 200); drawWin(1120, 520, 180, 200); drawWin(300, 780, 180, 160); drawWin(1120, 780, 180, 160);
    // door
    ctx.fillStyle = "#f6f4ef"; ctx.fillRect(690, 650, 220, 360);
    ctx.fillStyle = "#5a3a26"; ctx.fillRect(705, 665, 190, 345);
    ctx.fillStyle = "#c9a14a"; ctx.beginPath(); ctx.arc(870, 840, 8, 0, Math.PI * 2); ctx.fill();
    // bush
    ctx.fillStyle = "#3f6b3a";
    for (let i = 0; i < 26; i++) { ctx.beginPath(); ctx.arc(230 + rand() * 360, 990 + rand() * 30, 30 + rand() * 25, 0, Math.PI * 2); ctx.fill(); }
    addNoise(ctx, W, H, 10);
    return c.toDataURL("image/jpeg", 0.9);
  }

  return { room: room(), facade: facade() };
}

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
const out = await page.evaluate(scene);
await browser.close();
for (const [name, url] of Object.entries(out)) {
  const buf = Buffer.from(url.split(",")[1], "base64");
  await writeFile(new URL(`${name}.jpg`, OUT), buf);
  console.log(`wrote public/samples/${name}.jpg (${(buf.length / 1024).toFixed(0)} KB)`);
}
