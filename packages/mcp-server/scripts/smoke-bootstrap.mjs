// Local smoke bootstrap: mints a SIWE JWT against the local API,
// generates a fresh master key, writes ~/.veiledhood/session.json and master.key.
// Usage: node packages/mcp-server/scripts/smoke-bootstrap.mjs [apiBase]
import { ethers } from "../../../api/node_modules/ethers/lib.esm/index.js";
import { randomBytes } from "node:crypto";
import { writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const apiBase = process.argv[2] ?? "http://127.0.0.1:3100";

const msgRes = await fetch(`${apiBase}/auth/message`);
if (!msgRes.ok) throw new Error(`GET /auth/message failed: ${msgRes.status}`);
const { message } = await msgRes.json();

const wallet = ethers.Wallet.createRandom();
const signature = await wallet.signMessage(message);

const verifyRes = await fetch(`${apiBase}/auth/verify`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ message, signature }),
});
if (!verifyRes.ok) {
  const text = await verifyRes.text();
  throw new Error(`POST /auth/verify failed: ${verifyRes.status} ${text}`);
}
const { token, address, exp } = await verifyRes.json();

const veiledhoodDir = join(homedir(), ".veiledhood");
mkdirSync(veiledhoodDir, { recursive: true });

const sessionPath = join(veiledhoodDir, "session.json");
const session = { jwt: token, exp, address, apiBase };
writeFileSync(sessionPath, JSON.stringify(session, null, 2));

const masterKeyBytes = randomBytes(32);
const masterKeyPath = join(veiledhoodDir, "master.key");
const masterKey = {
  masterKey: masterKeyBytes.toString("base64"),
  version: 1,
  address,
  createdAt: new Date().toISOString(),
};
writeFileSync(masterKeyPath, JSON.stringify(masterKey, null, 2));

try {
  chmodSync(sessionPath, 0o600);
  chmodSync(masterKeyPath, 0o600);
} catch {
  // POSIX-only; Windows ignores
}

console.log("=== Veiledhood smoke bootstrap complete ===");
console.log("address    :", address);
console.log("apiBase    :", apiBase);
console.log("session    :", sessionPath);
console.log("master.key :", masterKeyPath);
console.log("jwt expiry :", new Date(exp * 1000).toISOString());
console.log("\nPrivate key for this throwaway wallet (DO NOT REUSE):");
console.log(wallet.privateKey);
