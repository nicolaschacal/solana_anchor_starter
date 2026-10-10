import { useEffect, useState } from "react";
import { RPC_URL } from "../lib/rebyters/config";
import { rpcStats } from "../lib/rebyters/rpc-fetch";

/** Devnet only: how hard the game is leaning on the public RPC (requests in the last 10 s). */
export function RpcMeter() {
  const [stats, setStats] = useState(rpcStats());
  useEffect(() => {
    const timer = window.setInterval(() => setStats(rpcStats()), 500);
    return () => window.clearInterval(timer);
  }, []);
  if (!/devnet/.test(RPC_URL)) return null;
  const load = stats.used / stats.limit;
  const level = stats.limited > 0 || load >= 0.7 ? "hot" : load >= 0.4 ? "warm" : "ok";
  return (
    <div className="rpc-meter" data-level={level} role="status" aria-label={`RPC: ${stats.used} requests in the last 10 seconds`} title="Requests to the public devnet RPC in the last 10 s (limit ≈ 100)">
      <i aria-hidden="true" />
      <span>RPC {stats.used}/{stats.limit}</span>
      {stats.limited > 0 && <b>limited</b>}
    </div>
  );
}
