import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { importAesKey, encrypt, decryptString } from "@veiledhood/agent-crypto/aesgcm";
import { handleDataStore } from "./dataStore.js";
import { handleDataFetch } from "./dataFetch.js";
import { handleDataList } from "./dataList.js";
import { handleDataSearch } from "./dataSearch.js";
import {
  setupTestEnv,
  cleanupTestEnv,
  stubFetch,
  makeResponse,
  type TestEnv,
  type FetchStub,
} from "../test/setup.js";

let env: TestEnv;
let fetchStub: FetchStub | undefined;

beforeEach(async () => {
  env = await setupTestEnv();
});
afterEach(async () => {
  fetchStub?.restore();
  fetchStub = undefined;
  await cleanupTestEnv(env);
});

test("data_store encrypts {label, data, savedAt} and POSTs with kind='data'", async () => {
  fetchStub = stubFetch(() =>
    makeResponse(201, {
      agentId: "abcd1234-aaaa-bbbb-cccc-1234567890ab",
      createdAt: "2025-01-01T00:00:00Z",
    }),
  );

  const res = await handleDataStore({
    label: "personal-notes",
    data: "the password is hunter2",
  });

  assert.equal(res.isError, undefined);
  assert.equal(fetchStub!.calls.length, 1);
  const call = fetchStub!.calls[0]!;
  assert.equal(call.init?.method, "POST");
  assert.ok(call.url.endsWith("/agents"), `url=${call.url}`);

  const body = JSON.parse(call.init?.body as string);
  assert.equal(body.kind, "data");
  assert.equal(body.version, 1);
  assert.ok(body.ciphertext, "ciphertext present");
  assert.ok(body.iv, "iv present");

  // Verify the ciphertext decrypts back to a {label, data, savedAt} envelope
  const aesKey = await importAesKey(env.rawKey);
  const aad = JSON.stringify({ kind: "data", version: 1 });
  const pt = await decryptString(aesKey, { iv: body.iv, ct: body.ciphertext, version: 1 }, aad);
  const decoded = JSON.parse(pt);
  assert.equal(decoded.label, "personal-notes");
  assert.equal(decoded.data, "the password is hunter2");
  assert.ok(decoded.savedAt, "savedAt timestamp present");
});

test("data_store uses data-kind AAD — agent-kind AAD must reject", async () => {
  fetchStub = stubFetch(() =>
    makeResponse(201, { agentId: "abcd1234-aaaa-bbbb-cccc-1234567890ab", createdAt: "x" }),
  );
  await handleDataStore({ label: "x", data: "y" });
  const body = JSON.parse(fetchStub!.calls[0]!.init?.body as string);

  const aesKey = await importAesKey(env.rawKey);
  // Decrypt with wrong kind="dca" AAD must throw
  const wrongAad = JSON.stringify({ kind: "dca", version: 1 });
  await assert.rejects(
    () => decryptString(aesKey, { iv: body.iv, ct: body.ciphertext, version: 1 }, wrongAad),
    "AAD mismatch must reject",
  );
});

test("data_fetch decrypts and returns label + data + savedAt", async () => {
  // Build a ciphertext server-side
  const aesKey = await importAesKey(env.rawKey);
  const aad = JSON.stringify({ kind: "data", version: 1 });
  const payload = {
    label: "tax-2024",
    data: '{"income":50000}',
    savedAt: "2025-04-15T00:00:00Z",
  };
  const ct = await encrypt(aesKey, JSON.stringify(payload), aad);

  fetchStub = stubFetch(() =>
    makeResponse(200, {
      agentId: "abcd1234-aaaa-bbbb-cccc-1234567890ab",
      kind: "data",
      ciphertext: ct.ct,
      iv: ct.iv,
      version: 1,
      status: "active",
      createdAt: "2025-04-15T00:00:00Z",
      updatedAt: "2025-04-15T00:00:00Z",
    }),
  );

  const res = await handleDataFetch({ id: "abcd1234-aaaa-bbbb-cccc-1234567890ab" });
  assert.equal(res.isError, undefined);
  const out = JSON.parse(res.content[0]!.text);
  assert.equal(out.label, "tax-2024");
  assert.equal(out.data, '{"income":50000}');
  assert.equal(out.savedAt, "2025-04-15T00:00:00Z");
});

test("data_fetch rejects non-data kinds with a clear error", async () => {
  fetchStub = stubFetch(() =>
    makeResponse(200, {
      agentId: "abcd1234-aaaa-bbbb-cccc-1234567890ab",
      kind: "dca",
      ciphertext: "x",
      iv: "y",
      version: 1,
      status: "active",
      createdAt: "x",
      updatedAt: "x",
    }),
  );

  const res = await handleDataFetch({ id: "abcd1234-aaaa-bbbb-cccc-1234567890ab" });
  assert.equal(res.isError, true);
  assert.ok(res.content[0]!.text.includes("agent_get"));
});

test("data_list calls /agents?kind=data and renders id + timestamps only (no labels)", async () => {
  fetchStub = stubFetch((url) => {
    assert.ok(url.includes("kind=data"), `url should filter by kind=data: ${url}`);
    return makeResponse(200, {
      agents: [
        {
          agentId: "id-1",
          kind: "data",
          status: "active",
          createdAt: "2025-01-01T00:00:00Z",
          updatedAt: "2025-01-01T00:00:00Z",
        },
        {
          agentId: "id-2",
          kind: "data",
          status: "active",
          createdAt: "2025-01-02T00:00:00Z",
          updatedAt: "2025-01-02T00:00:00Z",
        },
      ],
    });
  });

  const res = await handleDataList();
  assert.equal(res.isError, undefined);
  const text = res.content[0]!.text;
  assert.ok(text.includes("id-1"));
  assert.ok(text.includes("id-2"));
  assert.ok(text.includes("labels encrypted"));
});

test("data_list returns helpful empty-state message when no blobs exist", async () => {
  fetchStub = stubFetch(() => makeResponse(200, { agents: [] }));
  const res = await handleDataList();
  assert.equal(res.isError, undefined);
  assert.ok(res.content[0]!.text.includes("No encrypted data"));
});

test("data_store surfaces 413 (payload too large) as VeiledhoodMcpError", async () => {
  fetchStub = stubFetch(() =>
    makeResponse(413, { error: "ciphertext exceeds max size", maxBytes: 1_048_576 }),
  );
  const res = await handleDataStore({ label: "x", data: "y" });
  assert.equal(res.isError, true);
  assert.ok(res.content[0]!.text.includes("VEILEDHOOD_VALIDATION_ERROR"));
});

test("data_store bakes tags into the encrypted payload (server is blind)", async () => {
  fetchStub = stubFetch(() =>
    makeResponse(201, {
      agentId: "abcd1234-aaaa-bbbb-cccc-1234567890ab",
      createdAt: "2026-06-03T00:00:00Z",
    }),
  );
  await handleDataStore({
    label: "lab-notes-trial-04",
    data: "yield improved 12%",
    tags: ["lab-notes", "protein-folding", "2026-q2"],
  });

  const body = JSON.parse(fetchStub!.calls[0]!.init?.body as string);
  // Server body must NOT include tags as a plaintext field
  assert.equal(body.tags, undefined, "tags must not leak as plaintext field");

  // Decrypting reveals the tags inside the payload
  const aesKey = await importAesKey(env.rawKey);
  const aad = JSON.stringify({ kind: "data", version: 1 });
  const pt = await decryptString(aesKey, { iv: body.iv, ct: body.ciphertext, version: 1 }, aad);
  const decoded = JSON.parse(pt);
  assert.deepEqual(decoded.tags, ["lab-notes", "protein-folding", "2026-q2"]);
});

test("data_fetch surfaces tags from the decrypted payload", async () => {
  const aesKey = await importAesKey(env.rawKey);
  const aad = JSON.stringify({ kind: "data", version: 1 });
  const payload = {
    label: "lab-notes-trial-04",
    data: "yield improved 12%",
    tags: ["lab-notes", "protein-folding"],
    savedAt: "2026-06-03T00:00:00Z",
  };
  const ct = await encrypt(aesKey, JSON.stringify(payload), aad);

  fetchStub = stubFetch(() =>
    makeResponse(200, {
      agentId: "id-1",
      kind: "data",
      ciphertext: ct.ct,
      iv: ct.iv,
      version: 1,
      status: "active",
      createdAt: "2026-06-03T00:00:00Z",
      updatedAt: "2026-06-03T00:00:00Z",
    }),
  );

  const res = await handleDataFetch({ id: "id-1" });
  assert.equal(res.isError, undefined);
  const out = JSON.parse(res.content[0]!.text);
  assert.deepEqual(out.tags, ["lab-notes", "protein-folding"]);
});

test("data_fetch surfaces empty tags array for legacy records without tags field", async () => {
  const aesKey = await importAesKey(env.rawKey);
  const aad = JSON.stringify({ kind: "data", version: 1 });
  const legacyPayload = {
    label: "old-record",
    data: "stored before tags existed",
    savedAt: "2025-04-15T00:00:00Z",
  };
  const ct = await encrypt(aesKey, JSON.stringify(legacyPayload), aad);

  fetchStub = stubFetch(() =>
    makeResponse(200, {
      agentId: "id-legacy",
      kind: "data",
      ciphertext: ct.ct,
      iv: ct.iv,
      version: 1,
      status: "active",
      createdAt: "2025-04-15T00:00:00Z",
      updatedAt: "2025-04-15T00:00:00Z",
    }),
  );

  const res = await handleDataFetch({ id: "id-legacy" });
  assert.equal(res.isError, undefined);
  const out = JSON.parse(res.content[0]!.text);
  assert.deepEqual(out.tags, []);
});

test("data_search returns AND-matched records by default", async () => {
  const aesKey = await importAesKey(env.rawKey);
  const aad = JSON.stringify({ kind: "data", version: 1 });

  async function makeCt(label: string, tags: string[]) {
    return encrypt(
      aesKey,
      JSON.stringify({ label, data: "x", tags, savedAt: "2026-06-03T00:00:00Z" }),
      aad,
    );
  }

  const records: Record<string, { ct: string; iv: string }> = {
    "id-a": await makeCt("a", ["grant", "nih"]),
    "id-b": await makeCt("b", ["grant"]),
    "id-c": await makeCt("c", ["lab-notes"]),
  };

  fetchStub = stubFetch((url) => {
    if (url.includes("kind=data") && !url.match(/\/agents\/id-/)) {
      return makeResponse(200, {
        agents: Object.keys(records).map((id) => ({
          agentId: id,
          kind: "data",
          status: "active",
          createdAt: "2026-06-03T00:00:00Z",
          updatedAt: "2026-06-03T00:00:00Z",
        })),
      });
    }
    const match = url.match(/\/agents\/(id-[abc])/);
    if (match) {
      const id = match[1]!;
      const r = records[id]!;
      return makeResponse(200, {
        agentId: id,
        kind: "data",
        ciphertext: r.ct,
        iv: r.iv,
        version: 1,
        status: "active",
        createdAt: "2026-06-03T00:00:00Z",
        updatedAt: "2026-06-03T00:00:00Z",
      });
    }
    return makeResponse(404, { error: "not found" });
  });

  const res = await handleDataSearch({ tags: ["grant", "nih"] });
  assert.equal(res.isError, undefined);
  const text = res.content[0]!.text;
  assert.ok(text.includes("id-a"), "id-a (grant+nih) should match");
  assert.ok(!text.includes("id-b"), "id-b (grant only) must NOT match in AND mode");
  assert.ok(!text.includes("id-c"), "id-c (lab-notes) must NOT match");
});

test("data_search with matchAll=false returns OR-matched records", async () => {
  const aesKey = await importAesKey(env.rawKey);
  const aad = JSON.stringify({ kind: "data", version: 1 });

  async function makeCt(label: string, tags: string[]) {
    return encrypt(
      aesKey,
      JSON.stringify({ label, data: "x", tags, savedAt: "2026-06-03T00:00:00Z" }),
      aad,
    );
  }

  const records: Record<string, { ct: string; iv: string }> = {
    "id-a": await makeCt("a", ["grant"]),
    "id-b": await makeCt("b", ["dataset"]),
    "id-c": await makeCt("c", ["lab-notes"]),
  };

  fetchStub = stubFetch((url) => {
    if (url.includes("kind=data") && !url.match(/\/agents\/id-/)) {
      return makeResponse(200, {
        agents: Object.keys(records).map((id) => ({
          agentId: id,
          kind: "data",
          status: "active",
          createdAt: "2026-06-03T00:00:00Z",
          updatedAt: "2026-06-03T00:00:00Z",
        })),
      });
    }
    const match = url.match(/\/agents\/(id-[abc])/);
    if (match) {
      const id = match[1]!;
      const r = records[id]!;
      return makeResponse(200, {
        agentId: id,
        kind: "data",
        ciphertext: r.ct,
        iv: r.iv,
        version: 1,
        status: "active",
        createdAt: "2026-06-03T00:00:00Z",
        updatedAt: "2026-06-03T00:00:00Z",
      });
    }
    return makeResponse(404, { error: "not found" });
  });

  const res = await handleDataSearch({ tags: ["grant", "dataset"], matchAll: false });
  assert.equal(res.isError, undefined);
  const text = res.content[0]!.text;
  assert.ok(text.includes("id-a"));
  assert.ok(text.includes("id-b"));
  assert.ok(!text.includes("id-c"));
});

test("data_search is case-insensitive on tag matching", async () => {
  const aesKey = await importAesKey(env.rawKey);
  const aad = JSON.stringify({ kind: "data", version: 1 });
  const ct = await encrypt(
    aesKey,
    JSON.stringify({
      label: "case-test",
      data: "x",
      tags: ["Protein-Folding"],
      savedAt: "2026-06-03T00:00:00Z",
    }),
    aad,
  );

  fetchStub = stubFetch((url) => {
    if (url.includes("kind=data") && !url.match(/\/agents\/id-/)) {
      return makeResponse(200, {
        agents: [
          {
            agentId: "id-mixed",
            kind: "data",
            status: "active",
            createdAt: "2026-06-03T00:00:00Z",
            updatedAt: "2026-06-03T00:00:00Z",
          },
        ],
      });
    }
    return makeResponse(200, {
      agentId: "id-mixed",
      kind: "data",
      ciphertext: ct.ct,
      iv: ct.iv,
      version: 1,
      status: "active",
      createdAt: "2026-06-03T00:00:00Z",
      updatedAt: "2026-06-03T00:00:00Z",
    });
  });

  const res = await handleDataSearch({ tags: ["protein-folding"] });
  assert.equal(res.isError, undefined);
  assert.ok(res.content[0]!.text.includes("id-mixed"));
});

test("data_search skips records that fail to decrypt without aborting", async () => {
  const aesKey = await importAesKey(env.rawKey);
  const aad = JSON.stringify({ kind: "data", version: 1 });
  const goodCt = await encrypt(
    aesKey,
    JSON.stringify({
      label: "ok",
      data: "x",
      tags: ["grant"],
      savedAt: "2026-06-03T00:00:00Z",
    }),
    aad,
  );

  fetchStub = stubFetch((url) => {
    if (url.includes("kind=data") && !url.match(/\/agents\/id-/)) {
      return makeResponse(200, {
        agents: [
          {
            agentId: "id-good",
            kind: "data",
            status: "active",
            createdAt: "x",
            updatedAt: "x",
          },
          {
            agentId: "id-bad",
            kind: "data",
            status: "active",
            createdAt: "x",
            updatedAt: "x",
          },
        ],
      });
    }
    if (url.includes("/agents/id-good")) {
      return makeResponse(200, {
        agentId: "id-good",
        kind: "data",
        ciphertext: goodCt.ct,
        iv: goodCt.iv,
        version: 1,
        status: "active",
        createdAt: "x",
        updatedAt: "x",
      });
    }
    if (url.includes("/agents/id-bad")) {
      return makeResponse(200, {
        agentId: "id-bad",
        kind: "data",
        ciphertext: "AAAA",
        iv: "AAAA",
        version: 1,
        status: "active",
        createdAt: "x",
        updatedAt: "x",
      });
    }
    return makeResponse(404, { error: "not found" });
  });

  const res = await handleDataSearch({ tags: ["grant"] });
  assert.equal(res.isError, undefined);
  const text = res.content[0]!.text;
  assert.ok(text.includes("id-good"));
  assert.ok(text.includes("1 record(s) skipped"));
});

test("data_search returns empty-state message when no kind=data records exist", async () => {
  fetchStub = stubFetch(() => makeResponse(200, { agents: [] }));
  const res = await handleDataSearch({ tags: ["grant"] });
  assert.equal(res.isError, undefined);
  assert.ok(res.content[0]!.text.includes("No encrypted data"));
});

test("data_search with empty tags returns every record with label surfaced", async () => {
  const aesKey = await importAesKey(env.rawKey);
  const aad = JSON.stringify({ kind: "data", version: 1 });
  const ct = await encrypt(
    aesKey,
    JSON.stringify({
      label: "untagged-record",
      data: "x",
      tags: [],
      savedAt: "2026-06-03T00:00:00Z",
    }),
    aad,
  );

  fetchStub = stubFetch((url) => {
    if (url.includes("kind=data") && !url.match(/\/agents\/id-/)) {
      return makeResponse(200, {
        agents: [
          {
            agentId: "id-untagged",
            kind: "data",
            status: "active",
            createdAt: "x",
            updatedAt: "x",
          },
        ],
      });
    }
    return makeResponse(200, {
      agentId: "id-untagged",
      kind: "data",
      ciphertext: ct.ct,
      iv: ct.iv,
      version: 1,
      status: "active",
      createdAt: "x",
      updatedAt: "x",
    });
  });

  const res = await handleDataSearch({ tags: [] });
  assert.equal(res.isError, undefined);
  const text = res.content[0]!.text;
  assert.ok(text.includes("id-untagged"));
  assert.ok(text.includes("untagged-record"));
});
