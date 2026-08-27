import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { webcrypto } from "node:crypto";
import { clearSessionCache } from "../session.js";
import { clearMasterKeyCache } from "../keys.js";

const VALID_JWT = "eyJhbGciOiJIUzI1NiJ9.payload.signature_must_be_at_least_twenty_chars";
const VALID_ADDR = "0x1234567890abcdef1234567890abcdef12345678";
const FUTURE_EXP = Math.floor(Date.now() / 1000) + 3600;
const API_BASE = "https://api.test.veiledhood.to";

export interface TestEnv {
  tmpDir: string;
  sessionFile: string;
  masterKeyFile: string;
  rawKey: Uint8Array;
  address: string;
  apiBase: string;
}

/** Encode a Uint8Array to base64 (Node-side). */
function toB64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

/**
 * Create a tmp dir, write a valid session.json + master.key, set env vars,
 * clear both caches. Returns paths + raw key. Caller is responsible for
 * cleanup via cleanupTestEnv().
 */
export async function setupTestEnv(opts?: {
  rawKey?: Uint8Array;
  masterKeyOverrides?: Record<string, unknown>;
  sessionOverrides?: Record<string, unknown>;
}): Promise<TestEnv> {
  const tmpDir = await mkdtemp(join(tmpdir(), "veiledhood-mcp-test-"));
  const sessionFile = join(tmpDir, "session.json");
  const masterKeyFile = join(tmpDir, "master.key");

  const rawKey = opts?.rawKey ?? webcrypto.getRandomValues(new Uint8Array(32));

  await writeFile(
    sessionFile,
    JSON.stringify({
      jwt: VALID_JWT,
      exp: FUTURE_EXP,
      address: VALID_ADDR,
      apiBase: API_BASE,
      ...(opts?.sessionOverrides ?? {}),
    }),
    "utf8",
  );

  await writeFile(
    masterKeyFile,
    JSON.stringify({
      masterKey: toB64(rawKey),
      version: 1,
      address: VALID_ADDR,
      createdAt: new Date().toISOString(),
      ...(opts?.masterKeyOverrides ?? {}),
    }),
    "utf8",
  );

  process.env.VEILEDHOOD_SESSION_FILE = sessionFile;
  process.env.VEILEDHOOD_MASTER_KEY_FILE = masterKeyFile;
  clearSessionCache();
  clearMasterKeyCache();

  return { tmpDir, sessionFile, masterKeyFile, rawKey, address: VALID_ADDR, apiBase: API_BASE };
}

export async function cleanupTestEnv(env: TestEnv): Promise<void> {
  delete process.env.VEILEDHOOD_SESSION_FILE;
  delete process.env.VEILEDHOOD_MASTER_KEY_FILE;
  clearSessionCache();
  clearMasterKeyCache();
  await rm(env.tmpDir, { recursive: true, force: true });
}

export interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

export interface FetchStub {
  calls: FetchCall[];
  restore(): void;
}

/**
 * Replace globalThis.fetch with a handler. `restore()` puts it back.
 * Tests should `try/finally` around this.
 */
export function stubFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response> | never,
): FetchStub {
  const calls: FetchCall[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as { url: string }).url;
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof globalThis.fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

export function makeResponse(
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

export const TEST_ADDR = VALID_ADDR;
export const TEST_API_BASE = API_BASE;
