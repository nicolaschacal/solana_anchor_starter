import { describe, expect, it, vi } from "vitest";
import { rpcFetch, rpcStats } from "./rpc-fetch";

const call = (id: number, method: string, params: unknown[] = []) =>
  rpcFetch("http://rpc.test", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id, method, params }) });

describe("rpcFetch", () => {
  it("shares identical reads, keeps each caller's id, and retries rate limits", async () => {
    let hits = 0;
    vi.stubGlobal("fetch", async (_u: unknown, init: RequestInit) => {
      hits++;
      const { id } = JSON.parse(String(init.body));
      return hits === 1 ? new Response("{}", { status: 429 }) : new Response(JSON.stringify({ jsonrpc: "2.0", id, result: 7 }), { status: 200 });
    });
    const [a, b] = await Promise.all([call(1, "getBalance", ["x"]), call(2, "getBalance", ["x"])]);
    expect((await a.json()).id).toBe(1);
    expect((await b.json()).id).toBe(2);
    expect(hits).toBe(2); // one 429 + one retry, shared by both callers
    expect(rpcStats().limited).toBe(1);
    vi.unstubAllGlobals();
  });
});
