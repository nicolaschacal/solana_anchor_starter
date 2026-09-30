import { useEffect, useState } from "react";
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
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
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
  Network,
  Pencil,
  Save,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
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
import { fetchTree } from "../../lib/rebyters/registry";
import { fetchVerifiedTree } from "../../lib/rebyters/tree";
import { PROGRAM_ID, RPC_URL, registryPda } from "../../lib/rebyters/config";
import type { PublishJournal } from "../../lib/rebyters/publish";
import { EvolutionEditor } from "../../components/admin/EvolutionEditor";
import { EvolutionGraphEditor } from "../../components/admin/EvolutionGraphEditor";
import { ThemeToggle } from "../../components/admin/ThemeToggle";
import { DesignLab } from "../../components/admin/DesignLab";

const short = (s: string) =>
  s ? `${s.slice(0, 6)}...${s.slice(-5)}` : "Not connected";
type RegistryState = ReturnType<typeof useRegistry>;
export default function App() {
  const state = useRegistry();
  return (
    <div className="shell">
      <aside className="sidebar">
        <Link to="/admin" className="brand">
          <Blocks size={28} />
          <span>
            REBYTERS<small>EVOLUTION LAB</small>
          </span>
        </Link>
        <nav>
          <NavLink end to="/admin/families">
            <LayoutDashboard size={18} />
            Collections
          </NavLink>
          <NavLink title="Mammal graph" to="/admin/families/0">
            <Network size={18} />
            Evolution atlas
          </NavLink>
          <NavLink to="/admin/design-lab">
            <Palette size={18} />
            Design Lab
          </NavLink>
        </nav>
        <div className="sidebar-bottom">
          <span className="network-dot" />
          Solana devnet<small>Registry program</small>
          <a
            href={`https://explorer.solana.com/address/${PROGRAM_ID}?cluster=devnet`}
            target="_blank"
            rel="noreferrer"
          >
            {short(PROGRAM_ID.toBase58())}
            <ExternalLink size={12} />
          </a>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span>RESEARCH STATION 01 / MAMMAL DIVISION</span>
          <div className="top-actions">
            <ThemeToggle />
            <span className="tag">DEVNET</span>
            <WalletMultiButton />
          </div>
        </header>
        <main>
          <Routes>
            <Route index element={<Navigate to="families/0" replace />} />
            <Route path="families" element={<Home state={state} />} />
            <Route path="design-lab" element={<DesignLab />} />
            <Route path="families/:familyId" element={<Family state={state} />} />
            <Route
              path="families/:familyId/evolutions/:evolutionId"
              element={<Family state={state} />}
            />
            <Route path="*" element={<Navigate to="families/0" replace />} />
          </Routes>
        </main>
        <footer>
          REBYTERS <span>Development network · Schema 1</span>
        </footer>
      </div>
    </div>
  );
}
function Home({ state }: { state: RegistryState }) {
  const wallet = useWallet(),
    tx = usePublishTree(),
    [newAuthority, setNewAuthority] = useState("");
  const authorized = state.registry?.authority === wallet.publicKey?.toBase58();
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
          <strong>{short(wallet.publicKey?.toBase58() || "")}</strong>
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
          {wallet.connected && (
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
    wallet = useWallet(),
    tx = usePublishTree();
  const family = Number(familyId),
    sample = params.get("sample") === "1",
    authorized = state.registry?.authority === wallet.publicKey?.toBase58();
  const familyQuery = sample ? "?sample=1" : family === 0 ? "?sample=0" : "";
  const active = state.registry?.activeVersions[family] ?? 0,
    data = useEvolutionTree(family, active);
  const key = `rebyters:draft:${RPC_URL}:${PROGRAM_ID}:${wallet.publicKey?.toBase58() ?? "anonymous"}:${family}:mammal-chart-v2:${sample ? "sample" : "chain"}`;
  const [draft, setDraft] = useState<TreeJson | null>(null),
    [journal, setJournal] = useState<PublishJournal | null>(null),
    [preview, setPreview] = useState(false),
    [editing, setEditing] = useState<Evolution | null>(null),
    [assetFile, setAssetFile] = useState<File | null>(null),
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
  async function publishLocalReferences() {
    if (!tree) return;
    const updated = await tx.publishLocalEvolutionAssets(tree.evolutions);
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
            <button onClick={() => setPreview(true)}>
              <Code2 size={16} />
              Advanced / JSON
            </button>
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
          {!sample && authorized && tree && tree.evolutions.some((e) => (e.assets?.imageUri ?? "").startsWith("/")) && (
            <button disabled={tx.busy} onClick={() => void publishLocalReferences()}>
              <Upload size={16} />
              Push local assets to Irys
            </button>
          )}
          {editable && tree && (
            <button disabled={tx.busy} onClick={() => void add()}>
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
            onEditEvolution={(id) => { const e=tree.evolutions.find(x=>x.id===id); if(e) { setAssetFile(null); setEditing(structuredClone(e)); } }}
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
              <Link to={`/admin/design-lab?species=${editing.id}&name=${encodeURIComponent(editing.name)}&stage=${STAGES[editing.stage]}`}><Palette size={15}/> Open in Design Lab</Link>
              <span>3D asset: {editing.assets?.modelUri || editing.modelUri ? "linked" : "not linked yet"}</span>
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
