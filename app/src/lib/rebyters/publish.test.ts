import { describe, it, expect, vi, beforeEach } from "vitest";
import { sampleMammal } from "./sample";
import { contentHash } from "./canonical";
import { buildMerkleTree } from "./merkle";
import { publishTree, type PublishJournal } from "./publish";
import type { RegistryWriter } from "./registry";
import type { Registry, TreeMetadata } from "./types";
const state = vi.hoisted(() => ({
  root: null as Registry | null,
  meta: null as TreeMetadata | null,
  downloadFails: false,
}));
vi.mock("./registry", () => ({
  fetchRegistry: vi.fn(async () => state.root),
  fetchTree: vi.fn(async () => state.meta),
}));
vi.mock("./tree", () => ({
  fetchVerifiedTree: vi.fn(async () => {
    if (state.downloadFails) throw new Error("CONTENT VERIFICATION FAILED");
    return sampleMammal();
  }),
}));
beforeEach(() => {
  state.root = {
    authority: "admin",
    nextEvolutionId: 1000,
    activeVersions: Array(16).fill(0),
    nextVersions: Array(16).fill(1),
  };
  state.meta = null;
  state.downloadFails = false;
});
function setup() {
  const journal: PublishJournal = { tree: sampleMammal(), baseVersion: 0 };
  const publication = {
    uri: "https://gateway.irys.xyz/receipt",
    contentHash: contentHash(journal.tree),
    merkleRoot: buildMerkleTree(journal.tree).root,
  };
  const create = vi.fn(async () => {
    state.meta = {
      ...publication,
      address: "pda",
      familyId: 0,
      version: 1,
      createdAt: 0,
    };
  });
  const activate = vi.fn(async () => {
    state.root!.activeVersions[0] = 1;
  });
  const writer = {
    connection: {},
    wallet: { publicKey: { toBase58: () => "admin" } },
    create,
    activate,
  } as unknown as RegistryWriter;
  const upload = vi.fn(async () => ({ id: "receipt" }));
  return { journal, publication, writer, create, activate, upload };
}
describe("publish recovery", () => {
  it("rejects replacement collections that reuse prior identities before upload", async () => {
    const x = setup();
    state.root!.activeVersions[0] = 1;
    state.root!.nextVersions[0] = 2;
    state.meta = {
      ...x.publication,
      address: "previous",
      familyId: 0,
      version: 1,
      createdAt: 0,
    };
    x.journal.baseVersion = 1;
    x.journal.tree.version = 2;
    x.journal.replaceCollection = true;
    await expect(
      publishTree(
        x.writer,
        x.journal,
        async () => ({ upload: x.upload }),
        () => {},
        () => {},
        "https://gateway.irys.xyz",
      ),
    ).rejects.toThrow("fresh reserved IDs");
    expect(x.upload).not.toHaveBeenCalled();
  });
  it("uploads, saves receipt, creates and activates", async () => {
    const x = setup(),
      save = vi.fn();
    await publishTree(
      x.writer,
      x.journal,
      async () => ({ upload: x.upload }),
      save,
      () => {},
      "https://gateway.irys.xyz",
    );
    expect(x.create).toHaveBeenCalledOnce();
    expect(x.activate).toHaveBeenCalledOnce();
    expect(x.journal.publication).toEqual(x.publication);
    expect(save).toHaveBeenCalled();
  });
  it("retains upload and retries without uploading again after create fails", async () => {
    const x = setup();
    x.create.mockRejectedValueOnce(new Error("Wallet rejected"));
    await expect(
      publishTree(
        x.writer,
        x.journal,
        async () => ({ upload: x.upload }),
        () => {},
        () => {},
        "https://gateway.irys.xyz",
      ),
    ).rejects.toThrow("Wallet rejected");
    expect(state.root!.activeVersions[0]).toBe(0);
    expect(x.journal.publication).toEqual(x.publication);
    await publishTree(
      x.writer,
      x.journal,
      async () => ({ upload: x.upload }),
      () => {},
      () => {},
      "https://gateway.irys.xyz",
    );
    expect(x.upload).toHaveBeenCalledOnce();
  });
  it("refetches and does not reactivate after an ambiguous confirmation", async () => {
    const x = setup();
    x.activate.mockImplementationOnce(async () => {
      state.root!.activeVersions[0] = 1;
      throw new Error("Confirmation timed out");
    });
    await expect(
      publishTree(
        x.writer,
        x.journal,
        async () => ({ upload: x.upload }),
        () => {},
        () => {},
        "https://gateway.irys.xyz",
      ),
    ).rejects.toThrow();
    await publishTree(
      x.writer,
      x.journal,
      async () => ({ upload: x.upload }),
      () => {},
      () => {},
      "https://gateway.irys.xyz",
    );
    expect(x.activate).toHaveBeenCalledOnce();
    expect(x.upload).toHaveBeenCalledOnce();
  });
  it("does not activate a failed content download", async () => {
    const x = setup();
    state.downloadFails = true;
    await expect(
      publishTree(
        x.writer,
        x.journal,
        async () => ({ upload: x.upload }),
        () => {},
        () => {},
        "https://gateway.irys.xyz",
      ),
    ).rejects.toThrow("CONTENT VERIFICATION FAILED");
    expect(x.create).not.toHaveBeenCalled();
    expect(x.activate).not.toHaveBeenCalled();
  });
  it("blocks stale drafts without uploading", async () => {
    const x = setup();
    state.root!.activeVersions[0] = 2;
    await expect(
      publishTree(
        x.writer,
        x.journal,
        async () => ({ upload: x.upload }),
        () => {},
        () => {},
        "https://gateway.irys.xyz",
      ),
    ).rejects.toThrow("Active version changed");
    expect(x.upload).not.toHaveBeenCalled();
  });
});
