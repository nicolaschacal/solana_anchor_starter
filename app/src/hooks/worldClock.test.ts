import { describe, it, expect, vi } from "vitest";
import { clockReference, periodAt } from "./useWorldClock";
import { SYSVAR_CLOCK_PUBKEY, type Connection } from "@solana/web3.js";
describe("world clock", () => {
  it("matches all on-chain UTC boundaries", () => {
    for (const [hour, expected] of [
      [0, "Night"],
      [5, "Night"],
      [6, "Morning"],
      [11, "Morning"],
      [12, "Day"],
      [17, "Day"],
      [18, "Evening"],
      [23, "Evening"],
      [24, "Night"],
    ] as const)
      expect(periodAt(Date.UTC(2026, 9, 4, hour))).toBe(expected);
  });
  it("deduplicates simultaneous and later requests and decodes the Clock unix timestamp", async () => {
    const data = Buffer.alloc(40);
    data.writeBigInt64LE(1791072000n, 32);
    const read = vi.fn().mockResolvedValue({ data });
    const connection = {
      rpcEndpoint: "clock-test",
      getAccountInfo: read,
    } as unknown as Connection;
    const [a, b] = await Promise.all([
      clockReference(connection),
      clockReference(connection),
    ]);
    expect(a).toBe(b);
    expect(a.unix).toBe(1791072000000);
    expect(a.synced).toBe(true);
    await clockReference(connection);
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith(SYSVAR_CLOCK_PUBKEY, "confirmed");
  });
  it("labels a failed sync as estimated and does not poll the endpoint", async () => {
    const read = vi.fn().mockRejectedValue(new Error("offline"));
    const connection = {
      rpcEndpoint: "clock-offline",
      getAccountInfo: read,
    } as unknown as Connection;
    expect((await clockReference(connection)).synced).toBe(false);
    await clockReference(connection);
    expect(read).toHaveBeenCalledTimes(1);
  });
});
