// Smokes the Day 7 envelope path: generate master key in-process, wrap with
// a passphrase using the SAME WebCrypto algorithm the dApp uses, POST to
// /agents/keys/envelope, then GET back and confirm shape.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const sessionPath = join(homedir(), ".veiledhood", "session.json");
const session = JSON.parse(readFileSync(sessionPath, "utf8"));

const PBKDF2_ITERS = 600_000;

function bytesToBase64(b) {
  return Buffer.from(b).toString("base64");
}

async function wrap(masterKey, passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );
  const wrappingKey = await crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERS },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );
  const ctBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, tagLength: 128 },
    wrappingKey,
    masterKey,
  );
  return {
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ctBuf)),
    iterations: PBKDF2_ITERS,
    version: 1,
  };
}

const masterKey = crypto.getRandomValues(new Uint8Array(32));
console.log("[wrap] starting (PBKDF2 600k iters, ~1-2s)…");
const t0 = Date.now();
const envelope = await wrap(masterKey, "smoke-test-passphrase-2026");
console.log(`[wrap] done in ${Date.now() - t0}ms`);
console.log("[envelope]", {
  salt: envelope.salt.slice(0, 12) + "…",
  iv: envelope.iv.slice(0, 12) + "…",
  ciphertext: envelope.ciphertext.slice(0, 16) + "…",
  iterations: envelope.iterations,
  version: envelope.version,
});

const postRes = await fetch(`${session.apiBase}/agents/keys/envelope`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${session.jwt}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(envelope),
});
console.log("[POST /agents/keys/envelope]", postRes.status);
if (!postRes.ok) {
  console.error(await postRes.text());
  process.exit(1);
}
const postBody = await postRes.json();
console.log("[POST body]", postBody);

const getRes = await fetch(`${session.apiBase}/agents/keys/envelope`, {
  headers: { Authorization: `Bearer ${session.jwt}` },
});
console.log("[GET /agents/keys/envelope]", getRes.status);
if (!getRes.ok) {
  console.error(await getRes.text());
  process.exit(1);
}
const fetched = await getRes.json();
const matches =
  fetched.salt === envelope.salt &&
  fetched.iv === envelope.iv &&
  fetched.ciphertext === envelope.ciphertext &&
  fetched.iterations === envelope.iterations &&
  fetched.version === envelope.version;
console.log("[round-trip]", matches ? "OK ✓" : "MISMATCH ✗");
if (!matches) {
  console.error("expected:", envelope);
  console.error("got     :", fetched);
  process.exit(1);
}

console.log("\n=== ENVELOPE WIRE SHAPE END-TO-END OK ===");
