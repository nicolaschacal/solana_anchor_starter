/**
 * A fetch for the Solana connection that is kind to the public RPC: identical reads that are in flight or were
 * answered a moment ago share one request, at most a few requests run at once, and a rate-limited answer (429)
 * is retried with a pause instead of surfacing as a broken screen. Writes clear the short-lived read cache.
 */
const BALANCE_EVENT = "rebyters:balances-changed";
const SHORT_TTL = 6_000;
const LONG_TTL = 10 * 60_000;
const MAX_PARALLEL = 4;
const LONG = new Set(["getMinimumBalanceForRentExemption", "getGenesisHash", "getVersion"]);
const SHORT = new Set([
  "getAccountInfo", "getBalance", "getParsedAccountInfo", "getMultipleAccounts", "getParsedTokenAccountsByOwner",
  "getTokenAccountsByOwner", "getTokenAccountBalance", "getTokenSupply", "getProgramAccounts",
]);
const NEUTRAL = new Set(["simulateTransaction", "getLatestBlockhash", "getSignatureStatuses", "getBlockHeight", "getSlot", "isBlockhashValid", "getFeeForMessage"]);

type Answer = { status: number; body: string; headers: [string, string][] };
const cache = new Map<string, { at: number; ttl: number; answer: Promise<Answer> }>();

let running = 0;
const waiting: (() => void)[] = [];
const slot = () =>
  new Promise<void>((resolve) => {
    if (running < MAX_PARALLEL) {
      running++;
      resolve();
    } else waiting.push(() => { running++; resolve(); });
  });
const release = () => {
  running--;
  waiting.shift()?.();
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Requests that really left the browser in the last 10 s (the public devnet allows about 100 per 10 s), and rate-limit answers. */
const WINDOW = 10_000;
const stamps: number[] = [];
const limited: number[] = [];
export const RPC_LIMIT = 100;
export function rpcStats() {
  const cut = Date.now() - WINDOW;
  while (stamps.length && stamps[0] < cut) stamps.shift();
  while (limited.length && limited[0] < cut) limited.shift();
  return { used: stamps.length, limited: limited.length, limit: RPC_LIMIT };
}

async function send(input: RequestInfo | URL, init?: RequestInit): Promise<Answer> {
  for (let attempt = 0; ; attempt++) {
    await slot();
    try {
      stamps.push(Date.now());
      const res = await fetch(input, init);
      const retry = res.status === 429 || res.status === 503;
      if (res.status === 429) limited.push(Date.now());
      if (retry && attempt < 4) {
        const after = Number(res.headers.get("retry-after"));
        await sleep(after > 0 ? Math.min(after * 1000, 5000) : 500 * 2 ** attempt + Math.random() * 300);
        continue;
      }
      return { status: res.status, body: await res.text(), headers: [...res.headers.entries()] };
    } finally {
      release();
    }
  }
}

const respond = (answer: Answer, id: unknown) => {
  let body = answer.body;
  if (id !== undefined) {
    try {
      const json = JSON.parse(body);
      if (json && !Array.isArray(json)) body = JSON.stringify({ ...json, id });
    } catch { /* leave the body as it came */ }
  }
  return new Response(body, { status: answer.status, headers: answer.headers.filter(([k]) => !/^content-(length|encoding)$/i.test(k)) });
};

export const rpcFetch: typeof fetch = async (input, init) => {
  let request: { method?: string; params?: unknown; id?: unknown } | null = null;
  try {
    if (init?.method === "POST" && typeof init.body === "string") {
      const parsed = JSON.parse(init.body);
      if (parsed && !Array.isArray(parsed)) request = parsed;
    }
  } catch { /* not JSON-RPC */ }
  const method = request?.method ?? "";
  if (!request || NEUTRAL.has(method)) return respond(await send(input, init), request?.id);
  if (!SHORT.has(method) && !LONG.has(method)) {
    cache.clear(); // a write (or something unknown): reads after it must be fresh
    return respond(await send(input, init), request.id);
  }
  const key = method + JSON.stringify(request.params ?? null);
  const hit = cache.get(key);
  const now = Date.now();
  if (hit && now - hit.at < hit.ttl) return respond(await hit.answer, request.id);
  const answer = send(input, init);
  cache.set(key, { at: now, ttl: LONG.has(method) ? LONG_TTL : SHORT_TTL, answer });
  answer.then(
    (a) => {
      // Failures are not remembered.
      if (a.status !== 200 || /"error"\s*:/.test(a.body.slice(0, 200))) cache.delete(key);
    },
    () => cache.delete(key),
  );
  return respond(await answer, request.id);
};

if (typeof window !== "undefined") {
  window.addEventListener(BALANCE_EVENT, () => {
    for (const [key, entry] of cache) if (entry.ttl === SHORT_TTL) cache.delete(key);
  });
}
