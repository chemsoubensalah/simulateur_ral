// Builds lib/color/data/ral-classic.json — the RAL Classic collection.
//
// Sources (downloaded at build time of the data file, not at app build time):
//  - Hex values: Wikipedia "List of RAL colours" (CC BY-SA 4.0), which tracks RAL's
//    published sRGB references. These are screen approximations; RAL's binding
//    values are only available in RAL DIGITAL.
//  - English/German names: RAL Classic table by lunohodov (gist 1995178).
//  - Arabic names: translated for ColorVision (below).
//
// Usage: node scripts/build-ral-data.mjs
import { writeFile, mkdir } from "node:fs/promises";

const WIKI = "https://en.wikipedia.org/w/api.php?action=parse&page=List_of_RAL_colours&prop=wikitext&format=json&formatversion=2";
const GIST = "https://gist.githubusercontent.com/lunohodov/1995178/raw";

const AR = {
  1000: "بيج مخضرّ", 1001: "بيج", 1002: "أصفر رملي", 1003: "أصفر الإشارات", 1004: "أصفر ذهبي", 1005: "أصفر عسلي",
  1006: "أصفر الذرة", 1007: "أصفر نرجسي", 1011: "بيج بني", 1012: "أصفر ليموني", 1013: "أبيض محاري", 1014: "عاجي",
  1015: "عاجي فاتح", 1016: "أصفر كبريتي", 1017: "أصفر زعفراني", 1018: "أصفر زنكي", 1019: "بيج رمادي", 1020: "أصفر زيتوني",
  1021: "أصفر السلجم", 1023: "أصفر المرور", 1024: "أصفر مغري", 1026: "أصفر فسفوري", 1027: "أصفر الكاري", 1028: "أصفر شمامي",
  1032: "أصفر الرتم", 1033: "أصفر الداليا", 1034: "أصفر باستيل", 1035: "بيج لؤلؤي", 1036: "ذهبي لؤلؤي", 1037: "أصفر شمسي",
  2000: "برتقالي مصفرّ", 2001: "برتقالي محمرّ", 2002: "زنجفري", 2003: "برتقالي باستيل", 2004: "برتقالي نقي",
  2005: "برتقالي فسفوري", 2007: "برتقالي فسفوري ساطع", 2008: "برتقالي محمرّ ساطع", 2009: "برتقالي المرور",
  2010: "برتقالي الإشارات", 2011: "برتقالي غامق", 2012: "برتقالي سلموني", 2013: "برتقالي لؤلؤي", 2017: "برتقالي RAL",
  3000: "أحمر لهبي", 3001: "أحمر الإشارات", 3002: "أحمر قرمزي", 3003: "أحمر ياقوتي", 3004: "أحمر أرجواني", 3005: "أحمر نبيذي",
  3007: "أحمر مسودّ", 3009: "أحمر أكسيدي", 3011: "أحمر بني", 3012: "أحمر بيج", 3013: "أحمر طماطمي", 3014: "وردي عتيق",
  3015: "وردي فاتح", 3016: "أحمر مرجاني", 3017: "وردي", 3018: "أحمر فراولي", 3020: "أحمر المرور", 3022: "وردي سلموني",
  3024: "أحمر فسفوري", 3026: "أحمر فسفوري ساطع", 3027: "أحمر العليق", 3028: "أحمر نقي", 3031: "أحمر شرقي",
  3032: "أحمر ياقوتي لؤلؤي", 3033: "وردي لؤلؤي",
  4001: "ليلكي محمرّ", 4002: "بنفسجي محمرّ", 4003: "بنفسجي خلنجي", 4004: "بنفسجي نبيذي", 4005: "ليلكي مزرقّ",
  4006: "أرجواني المرور", 4007: "بنفسجي أرجواني", 4008: "بنفسجي الإشارات", 4009: "بنفسجي باستيل", 4010: "ماجنتا الاتصالات",
  4011: "بنفسجي لؤلؤي", 4012: "توتي لؤلؤي",
  5000: "أزرق بنفسجي", 5001: "أزرق مخضرّ", 5002: "أزرق لازوردي", 5003: "أزرق زفيري", 5004: "أزرق مسودّ", 5005: "أزرق الإشارات",
  5007: "أزرق لامع", 5008: "أزرق رمادي", 5009: "أزرق سماوي", 5010: "أزرق جنطياني", 5011: "أزرق فولاذي", 5012: "أزرق فاتح",
  5013: "أزرق كوبالتي", 5014: "أزرق حمامي", 5015: "أزرق السماء", 5017: "أزرق المرور", 5018: "أزرق فيروزي", 5019: "أزرق كابري",
  5020: "أزرق محيطي", 5021: "أزرق مائي", 5022: "أزرق ليلي", 5023: "أزرق بعيد", 5024: "أزرق باستيل", 5025: "أزرق جنطياني لؤلؤي",
  5026: "أزرق ليلي لؤلؤي",
  6000: "أخضر الزنجار", 6001: "أخضر زمردي", 6002: "أخضر ورقي", 6003: "أخضر زيتوني", 6004: "أخضر مزرقّ", 6005: "أخضر طحلبي",
  6006: "زيتوني رمادي", 6007: "أخضر زجاجي", 6008: "أخضر بني", 6009: "أخضر التنوب", 6010: "أخضر عشبي", 6011: "أخضر الريسيدا",
  6012: "أخضر مسودّ", 6013: "أخضر القصب", 6014: "زيتوني مصفرّ", 6015: "زيتوني أسود", 6016: "أخضر فيروزي", 6017: "أخضر ربيعي",
  6018: "أخضر مصفرّ", 6019: "أخضر باستيل", 6020: "أخضر كرومي", 6021: "أخضر شاحب", 6022: "زيتوني باهت", 6024: "أخضر المرور",
  6025: "أخضر سرخسي", 6026: "أخضر أوبالي", 6027: "أخضر فاتح", 6028: "أخضر صنوبري", 6029: "أخضر نعناعي", 6031: "أخضر برونزي",
  6032: "أخضر الإشارات", 6033: "فيروزي نعناعي", 6034: "فيروزي باستيل", 6035: "أخضر لؤلؤي", 6036: "أخضر أوبالي لؤلؤي",
  6037: "أخضر نقي", 6038: "أخضر فسفوري", 6039: "أخضر ليفي",
  7000: "رمادي سنجابي", 7001: "رمادي فضي", 7002: "رمادي زيتوني", 7003: "رمادي طحلبي", 7004: "رمادي الإشارات", 7005: "رمادي فأري",
  7006: "رمادي بيج", 7008: "رمادي كاكي", 7009: "رمادي مخضرّ", 7010: "رمادي المشمّع", 7011: "رمادي حديدي", 7012: "رمادي بازلتي",
  7013: "رمادي بني", 7015: "رمادي أردوازي", 7016: "رمادي أنثراسيت", 7021: "رمادي مسودّ", 7022: "رمادي أمبري", 7023: "رمادي خرساني",
  7024: "رمادي غرافيتي", 7026: "رمادي غرانيتي", 7030: "رمادي حجري", 7031: "رمادي مزرقّ", 7032: "رمادي حصوي", 7033: "رمادي إسمنتي",
  7034: "رمادي مصفرّ", 7035: "رمادي فاتح", 7036: "رمادي بلاتيني", 7037: "رمادي غباري", 7038: "رمادي عقيقي", 7039: "رمادي كوارتزي",
  7040: "رمادي النوافذ", 7042: "رمادي المرور A", 7043: "رمادي المرور B", 7044: "رمادي حريري", 7045: "رمادي الاتصالات 1",
  7046: "رمادي الاتصالات 2", 7047: "رمادي الاتصالات 4", 7048: "رمادي فأري لؤلؤي",
  8000: "بني مخضرّ", 8001: "بني مغري", 8002: "بني الإشارات", 8003: "بني طيني", 8004: "بني نحاسي", 8007: "بني غزالي",
  8008: "بني زيتوني", 8011: "بني جوزي", 8012: "بني محمرّ", 8014: "بني سيبيا", 8015: "بني كستنائي", 8016: "بني ماهوجني",
  8017: "بني شوكولاتي", 8019: "بني رمادي", 8022: "بني مسودّ", 8023: "بني برتقالي", 8024: "بني بيج", 8025: "بني شاحب",
  8028: "بني ترابي", 8029: "نحاسي لؤلؤي",
  9001: "كريمي", 9002: "أبيض رمادي", 9003: "أبيض الإشارات", 9004: "أسود الإشارات", 9005: "أسود فاحم", 9006: "ألمنيوم أبيض",
  9007: "ألمنيوم رمادي", 9010: "أبيض نقي", 9011: "أسود غرافيتي", 9012: "أبيض الغرف النظيفة", 9016: "أبيض المرور",
  9017: "أسود المرور", 9018: "أبيض بردي", 9022: "رمادي فاتح لؤلؤي", 9023: "رمادي غامق لؤلؤي",
};

// Codes missing from the names table but present in RAL Classic.
const EXTRA_NAMES = { 6031: { en: "Bronze green", de: "Bronzegrün" } };

/** Finishes that are not ordinary wall paint (excluded from suggestions). */
function special(code, en) {
  if (/^Pearl /i.test(en) || code === 1035 || code === 1036 || code === 2013 || code === 8029) return "pearl";
  if (/^Luminous /i.test(en)) return "luminous";
  if (code === 9006 || code === 9007) return "metallic";
  return undefined;
}

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === "," && !q) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

const [wikiRes, gistRes] = await Promise.all([fetch(WIKI), fetch(GIST)]);
if (!wikiRes.ok || !gistRes.ok) throw new Error("download failed");
const wikitext = (await wikiRes.json()).parse.wikitext;
const gist = (await gistRes.text()).trim().split(/\r?\n/);
const header = parseCsvLine(gist[0]);
const col = (name) => header.indexOf(name);
const names = new Map();
for (const line of gist.slice(1)) {
  const c = parseCsvLine(line);
  const code = Number(c[col("RAL")].replace(/\D/g, ""));
  names.set(code, { en: c[col("English")], de: c[col("German")], hex: c[col("HEX")] });
}

const hexRe = /vanchor\|RAL (\d{4})\}\}\s*\|\|\s*\{\{#invoke:biglist\|coltit\|([0-9A-Fa-f]{6})/g;
const colors = [];
for (const [, codeStr, hex] of wikitext.matchAll(hexRe)) {
  const code = Number(codeStr);
  const n = names.get(code) ?? EXTRA_NAMES[code];
  if (!n) throw new Error(`No names for RAL ${code}`);
  if (!AR[code]) throw new Error(`No Arabic name for RAL ${code}`);
  const entry = { code: `RAL ${code}`, hex: `#${hex.toUpperCase()}`, names: { en: n.en, de: n.de, ar: AR[code] } };
  const sp = special(code, n.en);
  if (sp) entry.special = sp;
  colors.push(entry);
}
colors.sort((a, b) => a.code.localeCompare(b.code));
const missing = [...names.keys()].filter((c) => !colors.some((x) => x.code === `RAL ${c}`));
if (missing.length) console.warn("In names table but not on Wikipedia:", missing);

await mkdir(new URL("../lib/color/data/", import.meta.url), { recursive: true });
const data = {
  id: "ral-classic",
  source: "Hex: Wikipedia 'List of RAL colours' (CC BY-SA 4.0); names: RAL. Screen approximations, not binding RAL values.",
  colors,
};
await writeFile(new URL("../lib/color/data/ral-classic.json", import.meta.url), JSON.stringify(data, null, 1) + "\n");
console.log(`wrote ${colors.length} RAL Classic colours`);
