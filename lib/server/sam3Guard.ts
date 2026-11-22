/**
 * Cost protection for SAM 3 (each analysis on fal.ai is paid):
 *  - the same photo is analysed once: answers are cached (here, and on the device);
 *  - each visitor (IP) gets SAM3_PER_HOUR analyses per hour (default 20);
 *  - at most SAM3_DAILY_LIMIT analyses per day per server instance (default 300).
 * Beyond a limit the app quietly uses the built-in AI instead.
 * Counters live in memory (per server instance): a guard rail, not accounting —
 * the hard limit is the prepaid credit on the provider's account.
 */
const HOUR = 3600_000;

const perIp = new Map<string, number[]>();
let day = "";
let today = 0;

export function allowAnalysis(ip: string, now = Date.now(), perHour = Number(process.env.SAM3_PER_HOUR ?? 20), perDay = Number(process.env.SAM3_DAILY_LIMIT ?? 300)): boolean {
  const d = new Date(now).toISOString().slice(0, 10);
  if (d !== day) {
    day = d;
    today = 0;
    perIp.clear();
  }
  if (today >= perDay) return false;
  const recent = (perIp.get(ip) ?? []).filter((t) => now - t < HOUR);
  if (recent.length >= perHour) {
    perIp.set(ip, recent);
    return false;
  }
  recent.push(now);
  perIp.set(ip, recent);
  today++;
  return true;
}

/** Small in-memory LRU of finished answers by photo hash. */
const cache = new Map<string, Uint8Array>();
const MAX_CACHED = 64;

export function cached(hash: string): Uint8Array | undefined {
  const v = cache.get(hash);
  if (v) {
    cache.delete(hash);
    cache.set(hash, v);
  }
  return v;
}

export function remember(hash: string, answer: Uint8Array): void {
  cache.set(hash, answer);
  while (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value!);
}

/** Test helper. */
export function resetGuard(): void {
  perIp.clear();
  cache.clear();
  day = "";
  today = 0;
}
