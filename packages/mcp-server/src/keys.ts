import { z } from "zod";
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { base64ToBytes } from "@veiledhood/agent-crypto";
import { importAesKey } from "@veiledhood/agent-crypto/aesgcm";
import { VeiledhoodMcpError } from "./errors.js";

/**
 * Master-key loader for the MCP server.
 *
 * v1 design (LOCKED): the master key is the AES-GCM key used directly to
 * encrypt strategy params. AAD = `JSON.stringify({ kind, version })` binds a
 * ciphertext to its strategy kind + schema version, so a ciphertext encrypted
 * for `kind=dca` cannot be silently passed off as a `kind=yield` doc later.
 *
 * `@veiledhood/agent-crypto` also exports `deriveAgentKey(masterKey, agentId, kind)`
 * for per-agent sub-keys, but v1 deliberately does NOT use it: the server
 * generates `agentId` only after the create POST returns, which creates a
 * chicken-and-egg with encryption that needs the id. Per-agent derivation is
 * a v2 hardening (re-encrypt with the derived key after create).
 */

const masterKeySchema = z.object({
  masterKey: z.string().min(40),                       // base64 of 32 bytes
  version: z.number().int().min(1),
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  createdAt: z.string().optional(),
});

function defaultPath(): string {
  return process.env.VEILEDHOOD_MASTER_KEY_FILE ?? join(homedir(), ".veiledhood", "master.key");
}

let cached: { rawKey: Uint8Array; aesKey: CryptoKey; address: string } | undefined;

const REAUTH_URL = "https://app.veiledhood.to/mcp";

export async function loadMasterKey(): Promise<{
  aesKey: CryptoKey;
  rawKey: Uint8Array;
  address: string;
}> {
  if (cached) return cached;
  const path = defaultPath();
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (e: any) {
    if (e?.code === "ENOENT") {
      throw new VeiledhoodMcpError(
        "VEILEDHOOD_MASTER_KEY_MISSING",
        `Master key file not found at ${path}. Download it from ${REAUTH_URL}.`,
        { path, reauthUrl: REAUTH_URL },
      );
    }
    throw new VeiledhoodMcpError(
      "VEILEDHOOD_MASTER_KEY_MISSING",
      `Cannot read master key file at ${path}: ${e?.message ?? String(e)}`,
      { path },
    );
  }

  // POSIX permission warning (mirrors session.ts)
  if (process.platform !== "win32") {
    try {
      const s = await stat(path);
      if ((s.mode & 0o004) !== 0) {
        process.stderr.write(
          `[veiledhood-mcp] WARNING: ${path} is world-readable. Run: chmod 600 ${path}\n`,
        );
      }
    } catch {
      // stat failure non-fatal
    }
  }

  let parsed;
  try {
    parsed = masterKeySchema.parse(JSON.parse(raw));
  } catch (e: any) {
    throw new VeiledhoodMcpError(
      "VEILEDHOOD_MASTER_KEY_MALFORMED",
      `Master key file at ${path} is malformed. Re-download from ${REAUTH_URL}.`,
      { path, parseError: e?.message },
    );
  }

  let rawKey: Uint8Array;
  try {
    rawKey = base64ToBytes(parsed.masterKey);
  } catch (e: any) {
    throw new VeiledhoodMcpError(
      "VEILEDHOOD_MASTER_KEY_MALFORMED",
      `Master key base64 is invalid at ${path}.`,
      { path },
    );
  }
  if (rawKey.length !== 32) {
    throw new VeiledhoodMcpError(
      "VEILEDHOOD_MASTER_KEY_MALFORMED",
      `Master key has wrong length ${rawKey.length}, expected 32 bytes.`,
      { path },
    );
  }
  const aesKey = await importAesKey(rawKey);
  cached = { rawKey, aesKey, address: parsed.address };
  return cached;
}

/** Reset the in-memory cache. Tests must call between cases. */
export function clearMasterKeyCache(): void {
  cached = undefined;
}

/**
 * AAD helper — deterministic JSON shape used on both encrypt and decrypt.
 * Key ordering is fixed by the literal ({ kind, version }) to keep the AAD
 * byte-identical across platforms.
 */
export function buildAad(kind: string, version: number): string {
  return JSON.stringify({ kind, version });
}
