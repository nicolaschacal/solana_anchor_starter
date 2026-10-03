import { isMammalPilot, MAMMAL_PILOT } from "../../lib/assets/catalog";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  ArrowLeft,
  Box,
  Download,
  MoonStar,
  Play,
  Save,
  Upload,
  WandSparkles,
} from "lucide-react";
import { useEvolutionTree } from "../../hooks/useEvolutionTree";
import { STAGES, type Registry } from "../../lib/rebyters/types";
import type { PublishJournal } from "../../lib/rebyters/publish";
import { IRYS_GATEWAY, RPC_URL, PROGRAM_ID } from "../../lib/rebyters/config";
import {
  ACTIONS,
  ROLES,
  disposeModel,
  emptyRig,
  exportGlb,
  makeClips,
  parseModel,
  suggestRig,
  type AssetModel,
  type RigMap,
} from "../../lib/assets/rig";
import {
  atlasDraftKey,
  loadProject,
  mergeAssetDraft,
  saveProject,
} from "../../lib/assets/drafts";
import {
  publishAssetBundle,
  type AssetReceipts,
} from "../../lib/assets/publish";
import { AssetViewer, type ViewerHandle } from "../assets/AssetViewer";
import "../assets/assets.css";

type Project = {
  schema: 1;
  species: number;
  source: ArrayBuffer;
  filename: string;
  rig: RigMap;
  intensity: number;
  speed: number;
  textureSize: number;
  prepared?: ArrayBuffer;
  thumbnail?: Blob;
  receipts: AssetReceipts;
};
const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;
function download(data: Blob, name: string) {
  const url = URL.createObjectURL(data),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function DesignLab({ registry }: { registry: Registry }) {
  const wallet = useWallet(),
    [params] = useSearchParams();
  const requestedFamily = Number(params.get("family") ?? 0),
    family =
      Number.isInteger(requestedFamily) &&
      requestedFamily >= 0 &&
      requestedFamily < 8
        ? requestedFamily
        : 0;
  const data = useEvolutionTree(
    family,
    registry.activeVersions[family] ?? 0,
    false,
  );
  const draftKey = atlasDraftKey(wallet.publicKey!.toBase58(), family);
  const readDraft = (): PublishJournal | null => {
    const raw = localStorage.getItem(draftKey);
    return raw ? JSON.parse(raw) : null;
  };
  const [draft, setDraft] = useState<PublishJournal | null>(null),
    [storageError, setStorageError] = useState("");
  useEffect(() => {
    try {
      setDraft(readDraft());
    } catch {
      setStorageError(
        "Atlas draft could not be read. Resolve browser storage before publishing.",
      );
    }
  }, [draftKey]);
  const tree = draft?.tree ?? data.tree;
  const [species, setSpecies] = useState(Number(params.get("species")) || 0);
  const evolution = tree?.evolutions.find((e) => e.id === species);
  const [model, setModel] = useState<AssetModel | null>(null),
    [preparedModel, setPreparedModel] = useState<AssetModel | null>(null);
  const [project, setProject] = useState<Project | null>(null),
    [rig, setRig] = useState<RigMap>(emptyRig),
    [intensity, setIntensity] = useState(1),
    [speed, setSpeed] = useState(1),
    [textureSize, setTextureSize] = useState(512);
  const [action, setAction] = useState("idle"),
    [skeleton, setSkeleton] = useState(false),
    [selectedBone, setSelectedBone] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [optimized, setOptimized] = useState(true);
  const [thumbnailUrl, setThumbnailUrl] = useState("");
  useEffect(() => {
    if (!project?.thumbnail) {
      setThumbnailUrl("");
      return;
    }
    const url = URL.createObjectURL(project.thumbnail);
    setThumbnailUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [project?.thumbnail]);
  const [busy, setBusy] = useState(false),
    [status, setStatus] = useState(""),
    [error, setError] = useState("");
  const viewer = useRef<ViewerHandle>(null),
    lock = useRef(false),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(
    () => () => {
      if (model) disposeModel(model);
    },
    [model],
  );
  useEffect(
    () => () => {
      if (preparedModel) disposeModel(preparedModel);
    },
    [preparedModel],
  );
  const projectKey = `${RPC_URL}:${PROGRAM_ID}:${wallet.publicKey}:${family}:${species}`;
  useEffect(() => {
    if (!species && tree?.evolutions.length) setSpecies(tree.evolutions[0].id);
  }, [tree, species]);
  useEffect(() => {
    setProject(null);
    setModel(null);
    setPreparedModel(null);
    setRig(emptyRig());
    setConfirmed(false);
    setStatus("");
    setError("");
  }, [species]);
  const generated = useMemo(() => {
    if (!model) return [];
    try {
      return makeClips(model, rig, intensity, speed);
    } catch {
      return [];
    }
  }, [model, rig, intensity, speed]);
  const clips = useMemo(
    () =>
      model
        ? [
            ...model.clips.filter(
              (c) => !ACTIONS.includes(c.name as (typeof ACTIONS)[number]),
            ),
            ...generated.filter(
              (c) => !model.clips.some((original) => original.name === c.name),
            ),
          ]
        : [],
    [model, generated],
  );
  const authored =
    !!model && ACTIONS.every((a) => model.clips.some((c) => c.name === a));
  const selected = ROLES.map((r) => rig[r].bone).filter(Boolean),
    duplicate = new Set(selected).size !== selected.length;
  const invalidate = () => {
    setPreparedModel(null);
    setConfirmed(false);
    setProject((p) =>
      p ? { ...p, prepared: undefined, thumbnail: undefined, receipts: {} } : p,
    );
  };
  async function run(task: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await task();
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function currentProject(): Project {
    if (!project) throw new Error("Import a GLB first.");
    return { ...project, rig, intensity, speed, textureSize };
  }
  async function importFile(file: File, thumbnail?: Blob) {
    await run(async () => {
      if (!evolution)
        throw new Error("Choose a species from the active atlas first.");
      if (
        !file.name.toLowerCase().endsWith(".glb") ||
        file.size > 50 * 1024 * 1024
      )
        throw new Error("Choose a GLB smaller than 50 MB.");
      setStatus("Reading model…");
      const source = await file.arrayBuffer(),
        next = await parseModel(source);
      if (!mounted.current) {
        disposeModel(next);
        return;
      }
      const mapping = suggestRig(next.bones);
      setModel(next);
      const ready = ACTIONS.every((a) => next.clips.some((c) => c.name === a));
      setPreparedModel(ready ? await parseModel(source.slice(0)) : null);
      setRig(mapping);
      setConfirmed(false);
      setAction("idle");
      const p: Project = {
        schema: 1,
        species,
        source,
        filename: file.name,
        prepared: ready ? source : undefined,
        thumbnail: ready ? thumbnail : undefined,
        rig: mapping,
        intensity: 1,
        speed: 1,
        textureSize: 512,
        receipts: {},
      };
      setIntensity(1);
      setSpeed(1);
      setTextureSize(512);
      setProject(p);
      await saveProject(projectKey, p);
      setStatus(
        ready
          ? "Animated GLB ready. Review the clips, then upload to Irys and attach to the atlas."
          : "Imported and saved locally. Confirm the bone mapping before preparing.",
      );
    });
  }
  async function restore() {
    await run(async () => {
      const p = await loadProject<Project>(projectKey);
      if (!p || p.schema !== 1 || p.species !== species)
        throw new Error("No saved project for this species in this browser.");
      const next = await parseModel(p.source);
      let ready: AssetModel | null = null;
      try {
        if (p.prepared) ready = await parseModel(p.prepared);
      } catch (e) {
        disposeModel(next);
        throw e;
      }
      if (!mounted.current) {
        disposeModel(next);
        if (ready) disposeModel(ready);
        return;
      }
      setProject(p);
      setModel(next);
      setPreparedModel(ready);
      setRig(p.rig);
      setIntensity(p.intensity);
      setSpeed(p.speed);
      setTextureSize(p.textureSize);
      setConfirmed(false);
      setStatus("Project restored. Review the model before uploading.");
    });
  }
  async function prepare() {
    await run(async () => {
      if (!model || !project) return;
      if (!authored && (!selected.length || duplicate))
        throw new Error(
          "Map at least one joint; each role must use a different bone.",
        );
      setStatus("Exporting clips and compressing…");
      const exported = await exportGlb(model, clips);
      const { optimizeGlb } = await import("../../lib/assets/optimize");
      const prepared = await optimizeGlb(exported, textureSize);
      const checked = await parseModel(prepared);
      if (!mounted.current) {
        disposeModel(checked);
        return;
      }
      if (!ACTIONS.every((a) => checked.clips.some((c) => c.name === a))) {
        disposeModel(checked);
        throw new Error("Export verification failed: missing action clips.");
      }
      const next = {
        ...currentProject(),
        prepared,
        thumbnail: undefined,
        receipts: {},
      };
      await saveProject(projectKey, next);
      setProject(next);
      setPreparedModel(checked);
      setOptimized(true);
      setConfirmed(false);
      setStatus(
        "Optimized GLB reloaded successfully. Review every action, then approve it.",
      );
    });
  }
  async function captureThumbnail() {
    await run(async () => {
      if (!project?.prepared || !optimized || action === "rest")
        throw new Error("Show the optimized model first.");
      const thumbnail = await viewer.current!.thumbnail();
      const next = {
        ...currentProject(),
        thumbnail,
        receipts: { modelUri: project.receipts.modelUri },
      };
      await saveProject(projectKey, next);
      setProject(next);
      setStatus("Thumbnail captured and saved.");
    });
  }
  async function publish() {
    await run(async () => {
      if (
        !project?.prepared ||
        !evolution ||
        !tree ||
        !confirmed ||
        !preparedModel
      )
        throw new Error("Prepare and approve the optimized asset first.");
      if (storageError) throw new Error(storageError);
      const prior = readDraft();
      mergeAssetDraft(
        tree,
        prior,
        species,
        {},
        registry.activeVersions[family],
        registry.nextVersions[family],
      );
      let next = currentProject();
      const thumbnail = next.thumbnail ?? (await viewer.current!.thumbnail());
      next = { ...next, thumbnail };
      await saveProject(projectKey, next);
      setProject(next);
      const { browserUploader } =
        await import("../../lib/rebyters/irys-browser");
      const uploader = await browserUploader(wallet);
      const assets = await publishAssetBundle(
        evolution,
        next.prepared!,
        thumbnail,
        uploader,
        IRYS_GATEWAY,
        next.receipts,
        async (receipts) => {
          next = { ...next, receipts };
          setProject(next);
          await saveProject(projectKey, next);
        },
        setStatus,
      );
      const latest = readDraft();
      const journal = mergeAssetDraft(
        tree,
        latest,
        species,
        assets,
        registry.activeVersions[family],
        registry.nextVersions[family],
      );
      localStorage.setItem(draftKey, JSON.stringify(journal));
      setDraft(journal);
      setStatus(
        `${evolution.name} linked to the atlas draft. Open Atlas and publish to activate it in the game.`,
      );
    });
  }
  return (
    <section className="asset-lab">
      <header className="asset-lab-heading">
        <div>
          <Link className="back" to={`/admin/families/${family}`}>
            <ArrowLeft size={14} /> Atlas
          </Link>
          <span className="eyebrow">REBYTERS / ASSET WORKSHOP</span>
          <h1>Design Lab</h1>
          <p>From a rigged creature to a game-ready companion.</p>
        </div>
        <span className="asset-chip">DEVNET · DRAFT FIRST</span>
      </header>
      <div className="asset-workflow">
        <span className={model ? "done" : ""}>01 Import</span>
        <span className={selected.length || authored ? "done" : ""}>
          02 Rig & motion
        </span>
        <span className={preparedModel ? "done" : ""}>03 Prepare</span>
        <span className={project?.receipts.metadataUri ? "done" : ""}>
          04 Attach to atlas
        </span>
      </div>
      {(error || storageError || data.error) && (
        <div className="notice error" role="alert">
          {error || storageError || data.error}
        </div>
      )}
      {status && (
        <div className="asset-status" role="status">
          {status}
        </div>
      )}
      <div className="asset-toolbar">
        <label>
          Atlas species
          <select
            aria-label="Atlas species"
            disabled={busy}
            value={species}
            onChange={(e) => {
              if (
                project &&
                !window.confirm(
                  "Switch species? Save your project first to retain edits.",
                )
              )
                return;
              setSpecies(Number(e.target.value));
            }}
          >
            <option value={0}>Choose a Rebyter</option>
            {tree?.evolutions.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} · {STAGES[e.stage]} · #{e.id}
              </option>
            ))}
          </select>
        </label>
        <label
          className={`asset-import ${busy || !evolution ? "disabled" : ""}`}
        >
          <Upload size={16} /> Import GLB
          <input
            type="file"
            accept=".glb"
            disabled={busy || !evolution}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void importFile(f);
            }}
          />
        </label>
        {evolution && isMammalPilot(evolution) && (
          <button
            disabled={busy}
            onClick={() =>
              void (async () => {
                try {
                  const [glb, image] = await Promise.all([
                    fetch(MAMMAL_PILOT.modelUri),
                    fetch(MAMMAL_PILOT.thumbnailUri),
                  ]);
                  if (!glb.ok || !image.ok)
                    throw new Error(
                      "Prepared mammal assets could not be loaded.",
                    );
                  await importFile(
                    new File([await glb.blob()], "mammal-animated.glb"),
                    await image.blob(),
                  );
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                }
              })()
            }
          >
            Load animated mammal · 172 KB
          </button>
        )}
        <button disabled={busy || !evolution} onClick={() => void restore()}>
          Restore project
        </button>
        <button
          disabled={busy || !project}
          onClick={() =>
            void run(async () => {
              await saveProject(projectKey, currentProject());
              setStatus(
                "Project saved in this browser, including source GLB and rig settings.",
              );
            })
          }
        >
          <Save size={15} />
          Save project
        </button>
      </div>
      {!tree && !data.loading && (
        <p>No active atlas found. Initialize the collection in Atlas first.</p>
      )}
      <div className="asset-workbench">
        <div className="asset-stage-card">
          <div className="asset-stage-title">
            <span>{evolution?.name ?? "Your next companion"}</span>
            <small>
              {preparedModel && optimized
                ? "OPTIMIZED GLB"
                : "SOURCE + MOTION PREVIEW"}
            </small>
          </div>
          {model ? (
            <AssetViewer
              ref={viewer}
              model={preparedModel && optimized ? preparedModel : model}
              clips={preparedModel && optimized ? preparedModel.clips : clips}
              action={action}
              skeleton={skeleton}
              selectedBone={selectedBone}
              sleeping={action === "rest"}
            />
          ) : (
            <div className="asset-empty">
              <Box size={64} />
              <h2>Bring your Rebyter to life</h2>
              <p>
                Choose its atlas entry and import the rigged GLB from Meshy.
              </p>
              <small>Embedded textures · up to 50 MB</small>
            </div>
          )}
          <div className="asset-motion-bar">
            {[...ACTIONS, "rest"].map((a) => (
              <button
                disabled={!model || busy}
                aria-pressed={action === a}
                className={action === a ? "active" : ""}
                key={a}
                onClick={() => {
                  setAction(a);
                  setConfirmed(false);
                }}
              >
                {a === "rest" ? <MoonStar size={14} /> : <Play size={12} />} {a}
              </button>
            ))}
          </div>
          <div className="asset-view-options">
            <label>
              <input
                type="checkbox"
                checked={skeleton}
                onChange={(e) => setSkeleton(e.target.checked)}
              />{" "}
              Show skeleton
            </label>
            {preparedModel && (
              <label>
                <input
                  type="checkbox"
                  checked={optimized}
                  onChange={(e) => {
                    setOptimized(e.target.checked);
                    setConfirmed(false);
                  }}
                />{" "}
                Optimized preview
              </label>
            )}
            <small>Drag to orbit · scroll to zoom</small>
          </div>
        </div>
        <div className="asset-inspector">
          <fieldset disabled={busy}>
            <h2>Rig & motion</h2>
            <p>
              Match joints, choose their local rotation axis and test each
              action. These are adjustable starter motions, not automatic
              full-body choreography.
            </p>
            <div className="asset-stats">
              <span>
                <strong>{model?.triangles ?? "—"}</strong>triangles
              </span>
              <span>
                <strong>{model?.bones.length ?? "—"}</strong>bones
              </span>
              <span>
                <strong>{model?.materials ?? "—"}</strong>materials
              </span>
            </div>
            {model && !model.bones.length && (
              <div className="notice">
                No skeleton found. Import a skinned, rigged model to generate
                joint animations.
              </div>
            )}
            {authored && (
              <p className="asset-status">
                All six game animations are already embedded. No bone mapping is
                needed. Preview each action, then upload below.
              </p>
            )}
            {!authored && (
              <>
                <div className="asset-rig-map">
                  {ROLES.map((role) => (
                    <div className="asset-joint" key={role}>
                      <label>
                        {role}
                        <select
                          aria-label={`${role} bone`}
                          value={rig[role].bone}
                          onFocus={() => setSelectedBone(rig[role].bone)}
                          onChange={(e) => {
                            invalidate();
                            setRig((r) => ({
                              ...r,
                              [role]: { ...r[role], bone: e.target.value },
                            }));
                            setSelectedBone(e.target.value);
                          }}
                        >
                          <option value="">Not mapped</option>
                          {model?.bones.map((b) => (
                            <option key={b.name} value={b.name}>
                              {b.name.replace(/^rebyter_\d+_/, "")}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Axis
                        <select
                          aria-label={`${role} axis`}
                          value={rig[role].axis}
                          onChange={(e) => {
                            invalidate();
                            setRig((r) => ({
                              ...r,
                              [role]: {
                                ...r[role],
                                axis: e.target.value as "x" | "y" | "z",
                              },
                            }));
                          }}
                        >
                          {["x", "y", "z"].map((a) => (
                            <option key={a}>{a}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Direction
                        <select
                          aria-label={`${role} direction`}
                          value={rig[role].amount}
                          onChange={(e) => {
                            invalidate();
                            setRig((r) => ({
                              ...r,
                              [role]: {
                                ...r[role],
                                amount: Number(e.target.value),
                              },
                            }));
                          }}
                        >
                          <option value={1}>+</option>
                          <option value={-1}>−</option>
                        </select>
                      </label>
                    </div>
                  ))}
                </div>
                {duplicate && (
                  <p role="alert">Each role needs a different bone.</p>
                )}
                <label className="asset-range">
                  Intensity <strong>{intensity.toFixed(1)}×</strong>
                  <input
                    type="range"
                    min={0.1}
                    max={2}
                    step={0.1}
                    value={intensity}
                    onChange={(e) => {
                      invalidate();
                      setIntensity(Number(e.target.value));
                    }}
                  />
                </label>
                <label className="asset-range">
                  Speed <strong>{speed.toFixed(1)}×</strong>
                  <input
                    type="range"
                    min={0.5}
                    max={2}
                    step={0.1}
                    value={speed}
                    onChange={(e) => {
                      invalidate();
                      setSpeed(Number(e.target.value));
                    }}
                  />
                </label>
              </>
            )}
            <p className="asset-sleep-note">
              <MoonStar size={16} /> Rest turns the viewer dark. No sleep pose
              or sleep clip is required.
            </p>
          </fieldset>
        </div>
      </div>
      <section className="asset-export">
        <div>
          <span className="eyebrow">DELIVERY</span>
          <h2>Prepare for Irys</h2>
          <p>
            Meshopt compression, resized textures and embedded action clips.
            Original geometry and skin weights are retained.
          </p>
          <label>
            Maximum texture size{" "}
            <select
              disabled={busy}
              value={textureSize}
              onChange={(e) => {
                invalidate();
                setTextureSize(Number(e.target.value));
              }}
            >
              {[256, 512, 1024].map((n) => (
                <option key={n} value={n}>
                  {n} px
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="asset-export-actions">
          <div className="asset-size">
            <span>
              Source{" "}
              <strong>{project ? kb(project.source.byteLength) : "—"}</strong>
            </span>
            <span>
              Prepared{" "}
              <strong>
                {project?.prepared ? kb(project.prepared.byteLength) : "—"}
              </strong>
            </span>
          </div>
          {project?.prepared && (
            <small>
              {project.prepared.byteLength > 300 * 1024
                ? "Above the 300 KB target. Try smaller textures or simplify the source in Meshy."
                : "Within the 300 KB target."}
            </small>
          )}
          <button
            className="primary"
            disabled={
              busy || !model || (!authored && (!selected.length || duplicate))
            }
            onClick={() => void prepare()}
          >
            <WandSparkles size={16} />
            {busy ? "Working…" : "Prepare optimized GLB"}
          </button>
          <button
            disabled={busy || !project?.prepared}
            onClick={() =>
              download(
                new Blob([project!.prepared!], { type: "model/gltf-binary" }),
                `${evolution?.key ?? species}.glb`,
              )
            }
          >
            <Download size={16} />
            Download GLB
          </button>
        </div>
      </section>
      {preparedModel && (
        <section className="asset-publish">
          <label>
            <input
              type="checkbox"
              checked={confirmed}
              disabled={busy || !optimized || action === "rest"}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            I reviewed the optimized model and its actions. The current camera
            framing is ready for the thumbnail.
          </label>
          <button
            className="primary"
            disabled={
              busy ||
              !confirmed ||
              !optimized ||
              action === "rest" ||
              !!storageError
            }
            onClick={() => void publish()}
          >
            <Upload size={16} />
            Upload & attach to atlas draft
          </button>
          <button
            disabled={busy || !optimized || action === "rest"}
            onClick={() => void captureThumbnail()}
          >
            Capture thumbnail
          </button>
          {thumbnailUrl && (
            <div className="asset-thumbnail">
              <img src={thumbnailUrl} alt={`${evolution?.name} thumbnail`} />
              <button
                onClick={() =>
                  download(
                    project!.thumbnail!,
                    `${evolution?.key ?? species}.png`,
                  )
                }
              >
                Download thumbnail
              </button>
            </div>
          )}
          <small>
            Uploads model, thumbnail and metadata to Irys devnet. Wallet
            signatures may be requested. Activate the changes using Publish in
            Atlas.
          </small>
          {project?.receipts.metadataUri && (
            <Link to={`/admin/families/${family}`}>Open atlas draft →</Link>
          )}
        </section>
      )}
    </section>
  );
}
