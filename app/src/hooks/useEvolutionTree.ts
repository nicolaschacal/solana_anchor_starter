import { useCallback, useEffect, useRef, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { fetchTree, fetchVersions } from "../lib/rebyters/registry";
import { fetchVerifiedTree } from "../lib/rebyters/tree";
import type { TreeJson, TreeMetadata } from "../lib/rebyters/types";
export function useEvolutionTree(
  family: number,
  version: number,
  includeVersions = true,
) {
  const { connection } = useConnection();
  const generation = useRef(0);
  const [tree, setTree] = useState<TreeJson | null>(null),
    [metadata, setMetadata] = useState<TreeMetadata | null>(null),
    [versions, setVersions] = useState<TreeMetadata[]>([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    setTree(null);
    setMetadata(null);
    setVersions([]);
    setError("");
    setLoading(true);
    try {
      if (version) {
        const meta = await fetchTree(connection, family, version);
        if (!meta) throw new Error("Active tree account is missing");
        const verified = await fetchVerifiedTree(meta);
        if (request !== generation.current) return;
        setMetadata(meta);
        setTree(verified);
      }
      if (includeVersions) {
        const stored = await fetchVersions(connection, family);
        if (request === generation.current) setVersions(stored);
      }
    } catch (e) {
      if (request === generation.current)
        setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, [connection, family, version, includeVersions]);
  useEffect(() => {
    void refresh();
    return () => {
      generation.current++;
    };
  }, [refresh]);
  return { tree, metadata, versions, error, loading, refresh };
}
