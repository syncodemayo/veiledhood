import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSession, clearSessionCache } from "./session.js";
import { VeiledhoodMcpError } from "./errors.js";

let tmpDir: string;
let sessionFile: string;

const VALID_JWT = "eyJhbGciOiJIUzI1NiJ9.payload.signature_must_be_at_least_twenty_chars";
const VALID_ADDR = "0x1234567890abcdef1234567890abcdef12345678";
const FUTURE_EXP = Math.floor(Date.now() / 1000) + 3600;
const PAST_EXP = Math.floor(Date.now() / 1000) - 3600;

function validSessionJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    jwt: VALID_JWT,
    exp: FUTURE_EXP,
    address: VALID_ADDR,
    apiBase: "https://api.veiledhood.to",
    ...overrides,
  });
}

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "veiledhood-session-test-"));
  sessionFile = join(tmpDir, "session.json");
  process.env.VEILEDHOOD_SESSION_FILE = sessionFile;
  clearSessionCache();
});

afterEach(async () => {
  delete process.env.VEILEDHOOD_SESSION_FILE;
  clearSessionCache();
  await rm(tmpDir, { recursive: true, force: true });
});

test("loadSession parses a valid session file", async () => {
  await writeFile(sessionFile, validSessionJson(), "utf8");
  const sess = await loadSession();
  assert.equal(sess.jwt, VALID_JWT);
  assert.equal(sess.address, VALID_ADDR);
  assert.equal(sess.apiBase, "https://api.veiledhood.to");
  assert.equal(sess.exp, FUTURE_EXP);
});

test("loadSession throws VEILEDHOOD_SESSION_FILE_MISSING when file absent", async () => {
  // Don't create the file
  await assert.rejects(
    () => loadSession(),
    (e: unknown) => {
      assert.ok(e instanceof VeiledhoodMcpError);
      assert.equal((e as VeiledhoodMcpError).code, "VEILEDHOOD_SESSION_FILE_MISSING");
      return true;
    },
  );
});

test("loadSession throws VEILEDHOOD_SESSION_FILE_MALFORMED for invalid JSON", async () => {
  await writeFile(sessionFile, "{not valid json}", "utf8");
  await assert.rejects(
    () => loadSession(),
    (e: unknown) => {
      assert.ok(e instanceof VeiledhoodMcpError);
      assert.equal((e as VeiledhoodMcpError).code, "VEILEDHOOD_SESSION_FILE_MALFORMED");
      return true;
    },
  );
});

test("loadSession throws VEILEDHOOD_SESSION_FILE_MALFORMED when jwt missing", async () => {
  await writeFile(
    sessionFile,
    JSON.stringify({ exp: FUTURE_EXP, address: VALID_ADDR, apiBase: "https://api.veiledhood.to" }),
    "utf8",
  );
  await assert.rejects(
    () => loadSession(),
    (e: unknown) => {
      assert.ok(e instanceof VeiledhoodMcpError);
      assert.equal((e as VeiledhoodMcpError).code, "VEILEDHOOD_SESSION_FILE_MALFORMED");
      return true;
    },
  );
});

test("loadSession throws VEILEDHOOD_REAUTH_REQUIRED when exp is in the past", async () => {
  await writeFile(sessionFile, validSessionJson({ exp: PAST_EXP }), "utf8");
  await assert.rejects(
    () => loadSession(),
    (e: unknown) => {
      assert.ok(e instanceof VeiledhoodMcpError);
      assert.equal((e as VeiledhoodMcpError).code, "VEILEDHOOD_REAUTH_REQUIRED");
      return true;
    },
  );
});

test("clearSessionCache forces a re-read of the session file", async () => {
  await writeFile(sessionFile, validSessionJson({ address: VALID_ADDR }), "utf8");
  const first = await loadSession();
  assert.equal(first.address, VALID_ADDR);

  // Mutate file on disk to a different address
  const NEW_ADDR = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
  await writeFile(sessionFile, validSessionJson({ address: NEW_ADDR }), "utf8");

  // Without clearing, cached value should still be returned
  const second = await loadSession();
  assert.equal(second.address, VALID_ADDR, "cache should still hold original");

  // After clearing, the new file content should be picked up
  clearSessionCache();
  const third = await loadSession();
  assert.equal(third.address, NEW_ADDR, "after clearSessionCache, should re-read");
});

test("loadSession accepts optional envelopeUploaded / passphraseHint fields", async () => {
  await writeFile(
    sessionFile,
    validSessionJson({
      envelopeUploaded: true,
      passphraseHint: "my dog's name",
      masterKeyFile: "/some/path/master.key",
    }),
    "utf8",
  );
  const sess = await loadSession();
  assert.equal(sess.envelopeUploaded, true);
  assert.equal(sess.passphraseHint, "my dog's name");
  assert.equal(sess.masterKeyFile, "/some/path/master.key");
});
