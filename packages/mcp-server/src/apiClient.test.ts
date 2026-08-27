import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apiRequest } from "./apiClient.js";
import { clearSessionCache } from "./session.js";
import { VeiledhoodMcpError } from "./errors.js";

const VALID_JWT = "eyJhbGciOiJIUzI1NiJ9.payload.signature_must_be_at_least_twenty_chars";
const VALID_ADDR = "0x1234567890abcdef1234567890abcdef12345678";
const FUTURE_EXP = Math.floor(Date.now() / 1000) + 3600;
const API_BASE = "https://api.test.veiledhood.to";

let tmpDir: string;
let sessionFile: string;
let originalFetch: typeof globalThis.fetch;
let fetchCalls: Array<{ url: string; init: RequestInit | undefined }>;

function makeResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  const isJson = typeof body !== "string";
  const finalHeaders: Record<string, string> = {
    "content-type": isJson ? "application/json" : "text/plain",
    ...headers,
  };
  return new Response(isJson ? JSON.stringify(body) : body, {
    status,
    headers: finalHeaders,
  });
}

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "veiledhood-api-test-"));
  sessionFile = join(tmpDir, "session.json");
  process.env.VEILEDHOOD_SESSION_FILE = sessionFile;
  await writeFile(
    sessionFile,
    JSON.stringify({
      jwt: VALID_JWT,
      exp: FUTURE_EXP,
      address: VALID_ADDR,
      apiBase: API_BASE,
    }),
    "utf8",
  );
  clearSessionCache();

  originalFetch = globalThis.fetch;
  fetchCalls = [];
});

afterEach(async () => {
  delete process.env.VEILEDHOOD_SESSION_FILE;
  clearSessionCache();
  globalThis.fetch = originalFetch;
  await rm(tmpDir, { recursive: true, force: true });
});

function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response> | never) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    fetchCalls.push({ url, init });
    return handler(url, init);
  }) as typeof globalThis.fetch;
}

test("200 happy path returns {status, data}", async () => {
  stubFetch(() => makeResponse(200, { hello: "world" }));
  const res = await apiRequest<{ hello: string }>("/agents");
  assert.equal(res.status, 200);
  assert.deepEqual(res.data, { hello: "world" });
});

test("401 throws VEILEDHOOD_REAUTH_REQUIRED", async () => {
  stubFetch(() => makeResponse(401, { error: "invalid jwt" }));
  await assert.rejects(
    () => apiRequest("/agents"),
    (e: unknown) => {
      assert.ok(e instanceof VeiledhoodMcpError);
      assert.equal((e as VeiledhoodMcpError).code, "VEILEDHOOD_REAUTH_REQUIRED");
      return true;
    },
  );
});

test("404 throws VEILEDHOOD_API_NOT_FOUND", async () => {
  stubFetch(() => makeResponse(404, { error: "not found" }));
  await assert.rejects(
    () => apiRequest("/agents/missing"),
    (e: unknown) => {
      assert.ok(e instanceof VeiledhoodMcpError);
      assert.equal((e as VeiledhoodMcpError).code, "VEILEDHOOD_API_NOT_FOUND");
      return true;
    },
  );
});

test("429 with retry-after header includes retryAfter in meta", async () => {
  stubFetch(() => makeResponse(429, { error: "rate limited" }, { "retry-after": "12" }));
  await assert.rejects(
    () => apiRequest("/agents"),
    (e: unknown) => {
      assert.ok(e instanceof VeiledhoodMcpError);
      const err = e as VeiledhoodMcpError;
      assert.equal(err.code, "VEILEDHOOD_API_RATE_LIMIT");
      assert.equal(err.meta?.retryAfter, 12);
      return true;
    },
  );
});

test("500 retried 3 times then throws VEILEDHOOD_API_SERVER_ERROR", async () => {
  let count = 0;
  stubFetch(() => {
    count++;
    return makeResponse(500, { error: "boom" });
  });
  await assert.rejects(
    () => apiRequest("/agents"),
    (e: unknown) => {
      assert.ok(e instanceof VeiledhoodMcpError);
      assert.equal((e as VeiledhoodMcpError).code, "VEILEDHOOD_API_SERVER_ERROR");
      return true;
    },
  );
  assert.equal(count, 3, "should have attempted 3 times");
});

test("network error retried 3 times then throws VEILEDHOOD_API_UNREACHABLE", async () => {
  let count = 0;
  stubFetch(() => {
    count++;
    throw new TypeError("fetch failed: ECONNREFUSED");
  });
  await assert.rejects(
    () => apiRequest("/agents"),
    (e: unknown) => {
      assert.ok(e instanceof VeiledhoodMcpError);
      assert.equal((e as VeiledhoodMcpError).code, "VEILEDHOOD_API_UNREACHABLE");
      return true;
    },
  );
  assert.equal(count, 3, "should have attempted 3 times");
});

test("Bearer JWT is injected in Authorization header", async () => {
  stubFetch(() => makeResponse(200, { ok: true }));
  await apiRequest("/agents");
  assert.equal(fetchCalls.length, 1);
  const headers = fetchCalls[0]?.init?.headers as Record<string, string> | undefined;
  assert.ok(headers, "headers should be present");
  assert.equal(headers.Authorization, `Bearer ${VALID_JWT}`);
});

test("body is JSON-stringified when present", async () => {
  stubFetch(() => makeResponse(200, { ok: true }));
  await apiRequest("/agents", { method: "POST", body: { name: "test" } });
  assert.equal(fetchCalls.length, 1);
  const init = fetchCalls[0]?.init;
  assert.equal(init?.method, "POST");
  assert.equal(typeof init?.body, "string");
  assert.deepEqual(JSON.parse(init?.body as string), { name: "test" });
  const headers = init?.headers as Record<string, string>;
  assert.equal(headers["Content-Type"], "application/json");
});

test("query params are appended to URL", async () => {
  stubFetch(() => makeResponse(200, { ok: true }));
  await apiRequest("/agents", { query: { limit: 10, owner: "0xabc" } });
  assert.equal(fetchCalls.length, 1);
  const url = fetchCalls[0]?.url ?? "";
  assert.ok(url.includes("limit=10"), `url=${url}`);
  assert.ok(url.includes("owner=0xabc"), `url=${url}`);
});

test("400 throws VEILEDHOOD_VALIDATION_ERROR (not retried)", async () => {
  let count = 0;
  stubFetch(() => {
    count++;
    return makeResponse(400, { error: "bad input" });
  });
  await assert.rejects(
    () => apiRequest("/agents"),
    (e: unknown) => {
      assert.ok(e instanceof VeiledhoodMcpError);
      assert.equal((e as VeiledhoodMcpError).code, "VEILEDHOOD_VALIDATION_ERROR");
      return true;
    },
  );
  assert.equal(count, 1, "4xx should not be retried");
});

test("403 throws VEILEDHOOD_API_FORBIDDEN", async () => {
  stubFetch(() => makeResponse(403, { error: "forbidden" }));
  await assert.rejects(
    () => apiRequest("/agents"),
    (e: unknown) => {
      assert.ok(e instanceof VeiledhoodMcpError);
      assert.equal((e as VeiledhoodMcpError).code, "VEILEDHOOD_API_FORBIDDEN");
      return true;
    },
  );
});
