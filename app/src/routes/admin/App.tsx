import { modelUriFor } from "../../lib/assets/catalog";
import { lazy, Suspense, useEffect, useState } from "react";
import {
  Link,
  NavLink,
  Navigate,
  Route,
  Routes,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useRebytersAuth } from "../../lib/rebyters/auth";
import {
  ArrowLeft,
  ArrowRight,
  Blocks,
  CheckCircle2,
  Code2,
  ExternalLink,
  GitBranch,
  LayoutDashboard,
  Palette,
  Trees,
  Network,
  Pencil,
  Save,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  LockKeyhole,
  WalletCards,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useRegistry } from "../../hooks/useRegistry";
import { useEvolutionTree } from "../../hooks/useEvolutionTree";
import { usePublishTree } from "../../hooks/usePublishTree";
import {
  FAMILIES,
  STAGES,
  type Evolution,
  type Registry,
  type TreeJson,
} from "../../lib/rebyters/types";
import {
  buildMammalWorkbookUpgrade,
  containsMammalWorkbook,
  hasStructuredMammalRules,
  upgradeMammalRulesInPlace,
  MAMMAL_SEED_EVOLUTION_COUNT,
  sampleMammal,
} from "../../lib/rebyters/sample";
import { contentHash } from "../../lib/rebyters/canonical";
import { buildMerkleTree } from "../../lib/rebyters/merkle";
import { warnings } from "../../lib/rebyters/validation";
import { fetchRuleSet, fetchTree } from "../../lib/rebyters/registry";
import { fetchVerifiedTree } from "../../lib/rebyters/tree";
import { PROGRAM_ID, RPC_URL, registryPda } from "../../lib/rebyters/config";
import type { PublishJournal } from "../../lib/rebyters/publish";
import { EvolutionEditor } from "../../components/admin/EvolutionEditor";
import { EvolutionGraphEditor } from "../../components/admin/EvolutionGraphEditor";
import { ThemeToggle } from "../../components/admin/ThemeToggle";
import { EvolutionModel } from "../../components/assets/AssetViewer";
const DesignLab = lazy(() => import("../../components/admin/DesignLab").then(module => ({default: module.DesignLab})));
const HabitatEditor = lazy(() => import("../../components/admin/HabitatEditor").then(module => ({default: module.HabitatEditor})));
import { CoreBenchmark } from "./CoreBenchmark";

const short = (s: string) =>
  s ? `${s.slice(0, 6)}...${s.slice(-5)}` : "Not connected";
type RegistryState = ReturnType<typeof useRegistry>;
export default function App() {
  const state = useRegistry();
  const auth = useRebytersAuth();
  const authority = state.registry?.authority ?? null;
  const connected = auth.publicKey?.toBase58() ?? null;
  const authorized = !!authority && connected === authority;

  if (state.loading && !state.registry) {
    return <div className="admin-gate">
      <div className="admin-gate-orb"><Blocks/></div>
      <small>REBYTERS ADMIN</small>
      <h1>Loading authority…</h1>
    </div>;
  }

  if (!authorized) {
    return <div className="admin-gate">
      <div className="admin-gate-glow"/>
      <section className="admin-gate-card">
        <div className="admin-gate-orb"><LockKeyhole/></div>
        <small>REBYTERS ADMIN</small>
        <h1>Authority required</h1>
        <p>{!auth.connected
          ? "Connect the registry authority wallet to open the evolution console."
          : "This wallet does not control the Rebyters registry."}</p>
        {authority&&<div className="admin-authority-hint">
          <span>Registry authority</span>
          <code>{short(authority)}</code>
        </div>}
        <WalletMultiButton>
          <><WalletCards size={17}/><span>{auth.connected?"Change wallet":"Connect admin wallet"}</span></>
        </WalletMultiButton>
      </section>
    </div>;
  }

  return (
    <div className="admin-game-shell admin-console">
      <header className="topbar admin-console-bar">
        <Link to="/admin/families/0" className="admin-console-brand">
          <Blocks size={23}/>
          <span><strong>REBYTERS</strong><small>ADMIN</small></span>
        </Link>

        <nav className="admin-console-nav" aria-label="Admin navigation">
          <NavLink to="/admin/families/0"><Network size={17}/>Atlas</NavLink>
          <NavLink end to="/admin/families"><LayoutDashboard size={17}/>Collections</NavLink>
          <NavLink to="/admin/design-lab"><Palette size={17}/>Design Lab</NavLink>
          <NavLink to="/admin/habitat-editor"><Trees size={17}/>Habitat Editor</NavLink>
        </nav>

        <div className="top-actions">
          <span className="admin-live"><i/> Devnet</span>
          <ThemeToggle />
          <WalletMultiButton />
        </div>
      </header>

      <main className="admin-console-main">
        <Routes>
          <Route index element={<Navigate to="families/0" replace />} />
          <Route path="families" element={<Home state={state} />} />
          <Route path="design-lab" element={<Suspense fallback={<div className="notice">Loading asset workshop…</div>}><DesignLab registry={state.registry!} /></Suspense>} />
          <Route path="habitat-editor" element={<Suspense fallback={<div className="notice">Loading habitat editor…</div>}><HabitatEditor registry={state.registry!} /></Suspense>} />
          <Route path="core-benchmark" element={<CoreBenchmark />} />
          <Route path="families/:familyId" element={<Family state={state} />} />
          <Route
            path="families/:familyId/evolutions/:evolutionId"
            element={<Family state={state} />}
          />
          <Route path="*" element={<Navigate to="families/0" replace />} />
        </Routes>
      </main>
    </div>
  );
}
function Home({ state }: { state: RegistryState }) {
  const auth = useRebytersAuth(),
    tx = usePublishTree(),
    [newAuthority, setNewAuthority] = useState("");
  const authorized = state.registry?.authority === auth.publicKey?.toBase58();
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">REGISTRY</span>
          <h1>Evolution content</h1>
        </div>
        <button
          className="icon"
          title="Refresh registry"
          aria-label="Refresh registry"
          onClick={() => void state.refresh()}
        >
          <RefreshCw size={18} />
        </button>
      </div>
      <div className="identity-strip">
        <div>
          <small>CONNECTED WALLET</small>
          <strong>{short(auth.publicKey?.toBase58() || "")}</strong>
        </div>
        <div>
          <small>REGISTRY AUTHORITY</small>
          <strong>
            {state.registry
              ? short(state.registry.authority)
              : state.loading
                ? "Loading..."
                : "Not initialized"}
          </strong>
        </div>
        <div>
          <small>ACCESS</small>
          <span className={`status ${authorized ? "verified" : ""}`}>
            <ShieldCheck size={15} />
            {authorized ? "Authority" : "Read only"}
          </span>
        </div>
      </div>
      {state.error && (
        <div className="notice error">Devnet connection: {state.error}</div>
      )}
      {!state.loading && !state.registry && !state.error && (
        <div className="notice">
          Registry not initialized.
          {auth.connected && (
            <button
              disabled={tx.busy}
              onClick={() =>
                void tx.run(async () => {
                  await tx.writer().initialize();
                  await state.refresh();
                })
              }
            >
              Initialize registry
            </button>
          )}
        </div>
      )}
      <div className="section-heading">
        <h2>
          Families <span className="count">8</span>
        </h2>
        <Link className="text-link" to="/admin/families/0?sample=1">
          Workbook preview · {MAMMAL_SEED_EVOLUTION_COUNT} forms
          <ArrowRight size={16} />
        </Link>
      </div>
      <div className="family-grid">
        {FAMILIES.map((name, id) => (
          <FamilyCard
            key={name}
            name={name}
            id={id}
            registry={state.registry}
          />
        ))}
      </div>
      {authorized && (
        <details className="authority-settings">
          <summary>Authority settings</summary>
          <label>
            New authority public key
            <input
              value={newAuthority}
              onChange={(e) => setNewAuthority(e.target.value)}
            />
          </label>
          <button
            disabled={tx.busy || !newAuthority}
            onClick={() => {
              if (
                window.confirm(
                  "Transfer registry administration? The current wallet will lose write access.",
                )
              )
                void tx.run(async () => {
                  await tx.writer().setAuthority(newAuthority);
                  await state.refresh();
                });
            }}
          >
            Transfer authority
          </button>
        </details>
      )}
      <Feedback tx={tx} />
      <div className="registry-address">
        <small>REGISTRY PDA</small>
        <code>{registryPda().toBase58()}</code>
      </div>
    </>
  );
}
function FamilyCard({
  name,
  id,
  registry,
}: {
  name: string;
  id: number;
  registry: Registry | null;
}) {
  const version = registry?.activeVersions[id] ?? 0;
  const data = useEvolutionTree(id, version, false);
  return (
    <Link className={`family-card family-${id}`} to={`/admin/families/${id}`}>
      <div className="family-card-top">
        <span className="family-number">{String(id).padStart(2, "0")}</span>
        <ArrowRight size={18} />
      </div>
      <h3>{name}</h3>
      <div className="family-card-bottom">
        <span className={version ? "status verified" : "muted"}>
          {version ? `Active v${version}` : "Not initialized"}
        </span>
        <span>
          {data.tree
            ? `${data.tree.evolutions.length} evolutions`
            : version
              ? "Loading..."
              : "--"}
        </span>
      </div>
    </Link>
  );
}
function Family({ state }: { state: RegistryState }) {
  const { familyId, evolutionId } = useParams(),
    [params] = useSearchParams(),
    navigate = useNavigate(),
    auth = useRebytersAuth(),
    tx = usePublishTree();
  const family = Number(familyId),
    sample = params.get("sample") === "1",
    authorized = state.registry?.authority === auth.publicKey?.toBase58();
  const familyQuery = sample ? "?sample=1" : family === 0 ? "?sample=0" : "";
  const active = state.registry?.activeVersions[family] ?? 0,
    data = useEvolutionTree(family, active);
  const key = `rebyters:draft:${RPC_URL}:${PROGRAM_ID}:${auth.publicKey?.toBase58() ?? "anonymous"}:${family}:mammal-chart-v2:${sample ? "sample" : "chain"}`;
  const [draft, setDraft] = useState<TreeJson | null>(null),
    [journal, setJournal] = useState<PublishJournal | null>(null),
    [preview, setPreview] = useState(false),
    [editing, setEditing] = useState<Evolution | null>(null),
    [assetFile, setAssetFile] = useState<File | null>(null),
    [modelFile, setModelFile] = useState<File | null>(null),
    [storageError, setStorageError] = useState("");
  useEffect(() => {
    setDraft(null);
    setJournal(null);
    setStorageError("");
    try {
      const saved = localStorage.getItem(key);
      if (saved) {
        const j = JSON.parse(saved) as PublishJournal;
        if (j.tree.family.id === family) {
          setDraft(j.tree);
          setJournal(j);
        }
      }
    } catch {
      setStorageError("Saved draft could not be recovered.");
    }
  }, [key, family]);
  function save(j: PublishJournal) {
    setJournal({ ...j });
    setDraft(structuredClone(j.tree));
    try {
      localStorage.setItem(key, JSON.stringify(j));
    } catch {
      setStorageError("Browser storage is unavailable. Keep this tab open.");
    }
  }
  const source = sample ? sampleMammal() : data.tree;
  const tree = draft ?? source;
  const selected = tree?.evolutions.find((e) => e.id === Number(evolutionId));
  const editable = sample || authorized;
  function edit(next: TreeJson) {
    const version =
      journal?.tree.version ??
      (sample ? 1 : (state.registry?.nextVersions[family] ?? 1));
    save({
      tree: { ...next, version },
      baseVersion: journal?.baseVersion ?? active,
      replaceCollection: journal?.replaceCollection,
    });
  }
  function discard() {
    if (!window.confirm("Discard local unpublished changes?")) return;
    localStorage.removeItem(key);
    setDraft(null);
    setJournal(null);
  }
  async function add() {
    if (!tree) return;
    await tx.run(async () => {
      const id = sample
        ? Math.max(...tree.evolutions.map((e) => e.id)) + 1
        : await tx.writer().reserve(1);
      const evolution: Evolution = {
        id,
        name: "New evolution",
        stage: 0,
        enabled: true,
        initialWeight: 10,
        modelUri: "",
        paths: [],
      };
      edit({ ...tree, evolutions: [...tree.evolutions, evolution] });
      navigate(`/admin/families/${family}/evolutions/${id}${familyQuery}`);
    });
  }
  async function prepare() {
    await tx.run(async () => {
      const nextVersion = state.registry!.nextVersions[family];
      if (family === 0 && data.tree && containsMammalWorkbook(data.tree) && !hasStructuredMammalRules(data.tree)) {
        // The on-chain program intentionally treats a full collection replacement
        // as a new identity set, so reserve fresh IDs once and remap every path.
        const start = await tx.writer().reserve(data.tree.evolutions.length);
        const tree = upgradeMammalRulesInPlace(data.tree, nextVersion, start);
        save({ tree, baseVersion: active, replaceCollection: true });
        return;
      }
      const seed = sampleMammal();
      const start = await tx.writer().reserve(seed.evolutions.length);
      const tree = buildMammalWorkbookUpgrade(start, nextVersion, data.tree ?? undefined);
      save({ tree, baseVersion: active, replaceCollection: true });
    });
  }
  async function prepareUnifiedAtlas() {
    if (!data.tree || family !== 0) return;
    await tx.run(async () => {
      const nextVersion = state.registry!.nextVersions[family];
      const authored = sampleMammal();
      const start = await tx.writer().reserve(authored.evolutions.length);
      const currentByKey = new Map(
        data.tree!.evolutions.map((e) => [
          e.key ?? e.name.toLowerCase().replace(/\s+/g, "_"),
          e,
        ]),
      );
      const idMap = new Map<number, number>();
      authored.evolutions.forEach((e, index) => idMap.set(e.id, start + index));
      const tree: TreeJson = {
        ...authored,
        version: nextVersion,
        proofMode: "unified-v1",
        development: true,
        evolutions: authored.evolutions.map((e, index) => {
          const key = e.key ?? e.name.toLowerCase().replace(/\s+/g, "_");
          const current = currentByKey.get(key);
          return {
            ...e,
            id: start + index,
            enabled: current?.enabled ?? e.enabled,
            initialWeight: current?.initialWeight ?? e.initialWeight,
            modelUri: current?.modelUri || e.modelUri,
            assets: { ...e.assets, ...current?.assets },
            paths: e.paths.map((path) => ({
              ...path,
              target: idMap.get(path.target) ?? path.target,
            })),
          };
        }),
      };
      save({
        tree,
        baseVersion: active,
        replaceCollection: true,
      });
    });
  }

  async function publishLocalReferences() {
    if (!tree) return;

    // The active on-chain atlas predates the local reference artwork fields.
    // Match the authored Mammal workbook by stable key/name, copy only its
    // local reference image into the active identities, then publish those
    // image+metadata pairs to Irys. Active evolution IDs remain unchanged.
    const authored = sampleMammal();
    const authoredByKey = new Map(
      authored.evolutions.map((e) => [
        e.key ?? e.name.toLowerCase().replace(/\s+/g, "_"),
        e,
      ]),
    );
    const candidates = tree.evolutions.map((e) => {
      const key = e.key ?? e.name.toLowerCase().replace(/\s+/g, "_");
      const reference = authoredByKey.get(key);
      const localImage = reference?.assets?.imageUri;
      if (!localImage?.startsWith("/")) return e;

      // Always republish authored local references, even when this evolution
      // already has an Irys metadata URI. Irys data is immutable, so changing
      // the JSON schema requires creating a fresh image+metadata publication
      // and replacing the atlas URIs in a new version.
      return {
        ...e,
        assets: {
          ...e.assets,
          imageUri: localImage,
          thumbnailUri: reference?.assets?.thumbnailUri ?? localImage,
        },
      };
    });

    const count = candidates.filter(
      (e) => (e.assets?.imageUri ?? "").startsWith("/"),
    ).length;
    if (!count) {
      throw new Error(
        "No unpublished Mammal reference artwork was found in the local workbook.",
      );
    }

    const updated = await tx.publishLocalEvolutionAssets(candidates);
    if (updated) edit({ ...tree, evolutions: updated });
  }

  async function publishEditingAsset() {
    if (!tree || !editing || !assetFile) return;
    const bytes = new Uint8Array(await assetFile.arrayBuffer());
    const type = assetFile.type || (assetFile.name.toLowerCase().endsWith(".svg") ? "image/svg+xml" : "application/octet-stream");
    const publication = await tx.publishEvolutionAsset(editing, bytes, type);
    if (!publication) return;
    const next = { ...editing, assets: publication.assets };
    setEditing(next);
    setAssetFile(null);
    edit({
      ...tree,
      evolutions: tree.evolutions.map((e) => (e.id === next.id ? next : e)),
    });
  }

  async function publishEditingModel() {
    if (!tree || !editing || !modelFile) return;
    if (!modelFile.name.toLowerCase().endsWith(".glb")) return;
    if (modelFile.size > 500 * 1024) return;

    const assets = await tx.publishEvolutionModel(
      editing,
      await modelFile.arrayBuffer(),
    );
    if (!assets) return;
    const next: Evolution = {
      ...editing,
      modelUri: assets.modelUri ?? editing.modelUri,
      assets,
    };
    setEditing(next);
    setModelFile(null);
    edit({
      ...tree,
      evolutions: tree.evolutions.map((e) => (e.id === next.id ? next : e)),
    });
  }


  async function publish() {
    if (!journal) return;
    const result = await tx.publish(structuredClone(journal), save);
    if (result) {
      localStorage.removeItem(key);
      setDraft(null);
      setJournal(null);
      await state.refresh();
    }
  }
  async function rollback(version: number) {
    await tx.run(async () => {
      const writer = tx.writer();
      const meta = await fetchTree(writer.connection, family, version);
      if (!meta) throw new Error("Version no longer exists");
      await fetchVerifiedTree(meta);
      await writer.activate(family, version);
      await state.refresh();
    });
  }
  if (!Number.isInteger(family) || family < 0 || family > 7)
    return <div className="notice error">Unknown family.</div>;
  let hash = "",
    root = "",
    validationError = "";
  if (tree) {
    try {
      hash = contentHash(tree);
      root = buildMerkleTree(tree).root;
    } catch (e) {
      validationError = e instanceof Error ? e.message : String(e);
    }
  }
  return (
    <>
      <Link className="back" to="/admin/families">
        <ArrowLeft size={15} />
        Families
      </Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">
            FAMILY {String(family).padStart(2, "0")}
          </span>
          <h1>
            {family === 0 ? "Mammal.exe" : FAMILIES[family]}
            <span className="title-suffix"> / Atlas</span>
          </h1>
        </div>
        <div className="heading-actions">
          {family === 0 &&
            !sample &&
            authorized &&
            tree &&
            !draft &&
            (!containsMammalWorkbook(tree) || !hasStructuredMammalRules(tree)) && (
              <button
                className="primary"
                disabled={tx.busy || data.loading}
                onClick={() => void prepare()}
              >
                <Upload size={16} />
                {containsMammalWorkbook(tree) ? "Unify evolution rules" : "Prepare workbook"}
              </button>
            )}
          {tree && (
            <button className="admin-secondary-action" onClick={() => setPreview(true)}>
              <Code2 size={16} />
              JSON
            </button>
          )}
          {family === 0 && !sample && (
            <Link className="graph-mode-switch admin-secondary-action" to="/admin/core-benchmark">
              <Blocks size={16} />
              Core benchmark
            </Link>
          )}
          {family === 0 && (
            <Link
              className="graph-mode-switch"
              to={`/admin/families/0${sample ? "?sample=0" : "?sample=1"}`}
            >
              <GitBranch size={16} />
              {sample
                ? `View active on-chain${active ? ` v${active}` : ""}`
                : `Open workbook preview · ${MAMMAL_SEED_EVOLUTION_COUNT} forms`}
            </Link>
          )}
          {!sample && authorized && tree && family === 0 && (
            <>
              {tree.proofMode !== "unified-v1" && !draft && (
                <button
                  className="primary"
                  disabled={tx.busy || data.loading}
                  onClick={() => void prepareUnifiedAtlas()}
                >
                  <GitBranch size={16} />
                  Prepare unified atlas
                </button>
              )}
              <button className="admin-secondary-action" disabled={tx.busy} onClick={() => void publishLocalReferences()}>
                <Upload size={16} />
                Reference assets
              </button>
              {tree.proofMode !== "unified-v1" && <button
                disabled={tx.busy || tree.schema !== 2 || !active}
                onClick={() =>
                  void tx.run(async () => {
                    const existing = await fetchRuleSet(tx.writer().connection, family, tree.version);
                    if (existing) throw new Error("Gameplay rules are already published for this atlas version");
                    await tx.writer().createRuleSet(tree);
                  })
                }
              >
                <ShieldCheck size={16} />
                Publish gameplay rules
              </button>}
            </>
          )}
          {editable && tree && (
            <button className="primary admin-new-rebyter" disabled={tx.busy} onClick={() => void add()}>
              <Plus size={16} />
              New Rebyter
            </button>
          )}
        </div>
      </div>
      <div className="family-status">
        <span className={`status ${!sample && data.tree ? "verified" : ""}`}>
          {!sample && data.tree ? (
            <CheckCircle2 size={16} />
          ) : (
            <GitBranch size={16} />
          )}{" "}
          {sample
            ? "SAMPLE / DEVELOPMENT CONTENT"
            : data.tree
              ? `Verified against Solana · Active v${active}`
              : active
                ? "Verifying on-chain content..."
                : "Not initialized"}
        </span>
        {draft && (
          <span className="tag draft-tag">LOCAL DRAFT · v{draft.version}</span>
        )}
      </div>
      {tree && <section className="admin-atlas-overview" aria-label="Atlas overview">
        <div><small>FORMS</small><strong>{tree.evolutions.length}</strong><span>Rebyters in this atlas</span></div>
        <div><small>ROUTES</small><strong>{tree.evolutions.reduce((count,e)=>count+e.paths.length,0)}</strong><span>Evolution connections</span></div>
        <div><small>ACTIVE</small><strong>{sample?"Local":`v${active}`}</strong><span>{sample?"Workbook preview":"Published on devnet"}</span></div>
        <div className={draft?"has-draft":""}><small>DRAFT</small><strong>{draft?`v${draft.version}`:"Clean"}</strong><span>{draft?"Unpublished changes":"No pending changes"}</span></div>
      </section>}
      {sample && (
        <div className="sample-banner">
          <div>
            <strong>Mammal development tree</strong>
            <span>
              {tree?.evolutions.length ?? MAMMAL_SEED_EVOLUTION_COUNT} forms ·
              Local workbook preview · Not published on-chain
            </span>
          </div>
        </div>
      )}
      {!sample && data.error && (
        <div className="notice error">{data.error}</div>
      )}
      {storageError && <div className="notice error">{storageError}</div>}
      {!sample && data.metadata && (
        <details className="publication-details">
          <summary>Publication / v{active} / Solana + Irys</summary>
          <div className="chain-details">
            <div>
              <small>ON-CHAIN MERKLE ROOT</small>
              <code>{data.metadata.merkleRoot}</code>
            </div>
            <div>
              <small>IMMUTABLE JSON</small>
              <a href={data.metadata.uri} target="_blank" rel="noreferrer">
                {data.metadata.uri}
                <ExternalLink size={12} />
              </a>
            </div>
          </div>
        </details>
      )}
      {!tree && (
        <div className="empty large">
          <GitBranch size={36} />
          <h2>
            {data.loading ? "Loading content..." : "No evolution content"}
          </h2>
          {authorized && family === 0 && (
            <button
              className="primary"
              disabled={tx.busy || (active > 0 && !data.tree)}
              onClick={() => void prepare()}
            >
              <Plus size={16} />
              Prepare workbook Mammal
            </button>
          )}
          {authorized && family !== 0 && (
            <button
              disabled={tx.busy}
              onClick={() =>
                void tx.run(async () => {
                  const id = await tx.writer().reserve(1);
                  save({
                    baseVersion: active,
                    tree: {
                      schema: 1,
                      family: { id: family, name: FAMILIES[family] },
                      version: state.registry!.nextVersions[family],
                      development: true,
                      evolutions: [
                        {
                          id,
                          name: "New evolution",
                          stage: 0,
                          enabled: true,
                          initialWeight: 10,
                          modelUri: "",
                          paths: [],
                        },
                      ],
                    },
                  });
                })
              }
            >
              Create first evolution
            </button>
          )}
          <Link to="/admin/families/0?sample=1">Open local sample</Link>
        </div>
      )}
      {tree && (
        <section className="admin-workflow" aria-label="Atlas workflow">
          <div className="admin-workflow-step is-active"><span>1</span><div><strong>Manage atlas</strong><small>Edit creatures, assets and evolution rules</small></div></div>
          <div className="admin-workflow-step"><span>2</span><div><strong>Review draft</strong><small>{draft ? "Unpublished changes ready to review" : "No unpublished changes"}</small></div></div>
          <div className="admin-workflow-step"><span>3</span><div><strong>Publish version</strong><small>Irys JSON → Merkle root → Registry PDA</small></div></div>
        </section>
      )}
      {tree && (
        <>
          <div className="section-heading">
            <h2>
              {selected ? selected.name : "Rebyters"}{" "}
              <span className="count">{tree.evolutions.length}</span>
            </h2>
            {selected && (
              <Link to={`/admin/families/${family}${familyQuery}`}>
                All evolutions
              </Link>
            )}
          </div>
          <EvolutionGraphEditor
            tree={tree}
            editable={editable && !tx.busy}
            onEditEvolution={(id) => { const e=tree.evolutions.find(x=>x.id===id); if(e) { setAssetFile(null); setModelFile(null); setEditing(structuredClone(e)); } }}
            selectedId={selected?.id}
            onClearSelection={() =>
              navigate(`/admin/families/${family}${familyQuery}`)
            }
            onSelectEvolution={(id) => {
              navigate(
                `/admin/families/${family}/evolutions/${id}${familyQuery}`,
              );
            }}
          />
          {warnings(tree).map((w) => (
            <p className="warning" key={w}>
              {w}
            </p>
          ))}
          {validationError && (
            <div className="notice error">{validationError}</div>
          )}
        </>
      )}
      {draft && (
        <div className="publish-bar">
          <div>
            <strong>Unpublished changes</strong>
            <small>
              {
                draft.evolutions.filter(
                  (e) => !source?.evolutions.some((s) => s.id === e.id),
                ).length
              }{" "}
              added ·{" "}
              {
                draft.evolutions.filter((e) =>
                  source?.evolutions.some(
                    (s) =>
                      s.id === e.id && JSON.stringify(s) !== JSON.stringify(e),
                  ),
                ).length
              }{" "}
              modified
            </small>
          </div>
          <button disabled={tx.busy} onClick={discard}>
            <RotateCcw size={15} />
            Discard
          </button>
          {!sample && authorized && (
            <button
              className="primary"
              disabled={tx.busy || !!validationError}
              onClick={() => void publish()}
            >
              <Upload size={16} />
              {tx.busy ? "Publishing..." : `Publish v${draft.version}`}
            </button>
          )}
          {sample && <span className="tag">LOCAL SAMPLE ONLY</span>}
        </div>
      )}
      {editing && tree && (
        <div className="modal-backdrop" onClick={() => setEditing(null)}>
          <section className="specimen-edit-modal" role="dialog" aria-modal="true" aria-label={`Edit ${editing.name}`} onClick={(e) => e.stopPropagation()}>
            <div className="specimen-edit-modal-head">
              <div>
                <span className="eyebrow">REBYTER EDITOR / {STAGES[editing.stage]}</span>
                <h2><Pencil size={18}/> {editing.name}</h2>
                <small>#{editing.id} · Changes are saved to the atlas draft</small>
              </div>
              <button className="icon" title="Close editor" aria-label="Close editor" onClick={() => setEditing(null)}><X size={20}/></button>
            </div>
            <div className="specimen-editor-shortcuts">
              <Link to={`/admin/design-lab?family=${family}&species=${editing.id}&name=${encodeURIComponent(editing.name)}&stage=${STAGES[editing.stage]}`}><Palette size={15}/> Open in Design Lab</Link>
              {modelUriFor(editing)&&<div className="atlas-model-preview"><EvolutionModel evolution={editing}/></div>}
              <span>3D asset: {editing.assets?.modelUri || editing.modelUri ? "linked" : modelUriFor(editing) ? "bundled preview · awaiting Irys publication" : "not linked yet"}</span>
              <span>{editing.paths.length} outgoing evolution{editing.paths.length === 1 ? "" : "s"}</span>
            </div>
            <div className="specimen-asset-publisher">
              <div>
                <strong>Reference artwork → Irys</strong>
                <small>Choose an image once. Admin uploads the image and its metadata JSON, then stores both immutable URIs in this Rebyter.</small>
              </div>
              <input
                type="file"
                accept="image/*,.svg"
                disabled={!editable || tx.busy}
                onChange={(event) => setAssetFile(event.target.files?.[0] ?? null)}
              />
              <button
                type="button"
                disabled={!editable || tx.busy || !assetFile}
                onClick={() => void publishEditingAsset()}
              >
                <Upload size={15}/>
                {tx.busy ? "Publishing..." : "Push image + metadata to Irys"}
              </button>
              {(editing.assets?.imageUri || editing.assets?.metadataUri) && (
                <div className="specimen-asset-links">
                  {editing.assets?.imageUri && <a href={editing.assets.imageUri} target="_blank" rel="noreferrer">Image URI <ExternalLink size={11}/></a>}
                  {editing.assets?.metadataUri && <a href={editing.assets.metadataUri} target="_blank" rel="noreferrer">Metadata URI <ExternalLink size={11}/></a>}
                </div>
              )}
            </div>
            <div className="specimen-asset-publisher specimen-model-publisher">
              <div>
                <strong>Optimized 3D model → Irys</strong>
                <small>Choose the optimized GLB (≤500 KB). Admin uploads it to Irys, creates fresh metadata with animation_url, and stages the new model URI in the next atlas version.</small>
              </div>
              <input
                type="file"
                accept=".glb,model/gltf-binary"
                disabled={!editable || tx.busy}
                onChange={(event) => setModelFile(event.target.files?.[0] ?? null)}
              />
              <button
                type="button"
                disabled={!editable || tx.busy || !modelFile || modelFile.size > 500 * 1024 || !modelFile.name.toLowerCase().endsWith(".glb")}
                onClick={() => void publishEditingModel()}
              >
                <Upload size={15}/>
                {tx.busy ? "Publishing..." : "Push 3D + metadata to Irys"}
              </button>
              {modelFile && (
                <small className={modelFile.size > 500 * 1024 ? "notice error" : "muted"}>
                  {modelFile.name} · {Math.ceil(modelFile.size / 1024)} KB
                  {modelFile.size > 500 * 1024 ? " · too large" : " · ready"}
                </small>
              )}
              {editing.assets?.modelUri && (
                <div className="specimen-asset-links">
                  <a href={editing.assets.modelUri} target="_blank" rel="noreferrer">3D model URI <ExternalLink size={11}/></a>
                </div>
              )}
            </div>
            <EvolutionEditor tree={tree} evolution={editing} readOnly={!editable || tx.busy} onChange={setEditing}/>
            <div className="specimen-edit-actions">
              <button onClick={() => setEditing(null)}>Cancel</button>
              <button className="primary" disabled={!editable || tx.busy} onClick={() => {
                edit({...tree,evolutions:tree.evolutions.map(old=>old.id===editing.id?editing:old)});
                setEditing(null);
              }}><Save size={15}/> Save changes</button>
            </div>
          </section>
        </div>
      )}
      <Feedback tx={tx} />
      {!sample && data.versions.length > 0 && (
        <section className="versions">
          <h2>Stored versions</h2>
          {data.versions.map((v) => (
            <div className="version-row" key={v.version}>
              <strong>v{v.version}</strong>
              <span className="muted">
                {v.version === active ? "Active" : "Available"}
              </span>
              <a href={v.uri} target="_blank" rel="noreferrer">
                JSON
                <ExternalLink size={12} />
              </a>
              {authorized && v.version !== active && (
                <>
                  <button
                    disabled={tx.busy || !!draft}
                    onClick={() => {
                      if (
                        window.confirm(
                          `Activate ${FAMILIES[family]} v${v.version}?`,
                        )
                      )
                        void rollback(v.version);
                    }}
                  >
                    <RotateCcw size={14} />
                    Activate v{v.version}
                  </button>
                  <button
                    className="icon danger"
                    disabled={tx.busy}
                    title={`Close v${v.version} and recover rent`}
                    aria-label={`Close v${v.version}`}
                    onClick={() => {
                      if (
                        window.confirm(
                          `Closing v${v.version} removes rollback ability for v${v.version}. Recover its rent?`,
                        )
                      )
                        void tx.run(async () => {
                          await tx.writer().close(family, v.version);
                          await data.refresh();
                        });
                    }}
                  >
                    <Trash2 size={15} />
                  </button>
                </>
              )}
            </div>
          ))}
        </section>
      )}
      {preview && tree && (
        <div className="modal-backdrop" onClick={() => setPreview(false)}>
          <section
            className="json-modal"
            role="dialog"
            aria-modal="true"
            aria-label="JSON preview"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="section-heading">
              <h2>JSON preview</h2>
              <button
                className="icon"
                title="Close JSON"
                aria-label="Close JSON"
                onClick={() => setPreview(false)}
              >
                <X size={20} />
              </button>
            </div>
            <dl>
              <dt>Content hash</dt>
              <dd>{hash}</dd>
              <dt>Merkle root</dt>
              <dd>{root || "Invalid draft"}</dd>
              <dt>Irys URI</dt>
              <dd>
                {journal?.publication?.uri ??
                  (!sample ? data.metadata?.uri : undefined) ??
                  "Not uploaded"}
              </dd>
            </dl>
            <pre>{JSON.stringify(tree, null, 2)}</pre>
          </section>
        </div>
      )}
    </>
  );
}
function Feedback({ tx }: { tx: ReturnType<typeof usePublishTree> }) {
  return (
    <>
      {tx.status && (
        <div className="notice transaction" role="status">
          {tx.status}
        </div>
      )}
      {tx.error && (
        <div className="notice error" role="alert">
          {tx.error}
        </div>
      )}
    </>
  );
}
