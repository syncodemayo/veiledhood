import { z } from "zod";
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { VeiledhoodMcpError } from "./errors.js";

const sessionSchema = z.object({
  jwt: z.string().min(20),
  exp: z.number().int().positive(),         // UNIX seconds
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  apiBase: z.string().url(),
  envelopeUploaded: z.boolean().optional(),
  masterKeyFile: z.string().optional(),      // path to wrapped key file the user downloaded
  passphraseHint: z.string().optional(),     // user-set hint shown by Claude when prompting
});

export type VeiledhoodSession = z.infer<typeof sessionSchema>;

function defaultSessionPath(): string {
  return process.env.VEILEDHOOD_SESSION_FILE ?? join(homedir(), ".veiledhood", "session.json");
}

const REAUTH_URL = "https://app.veiledhood.to/mcp";

let cached: VeiledhoodSession | undefined;

export async function loadSession(): Promise<VeiledhoodSession> {
  if (cached && cached.exp * 1000 > Date.now() + 30_000) return cached;
  const path = defaultSessionPath();
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (e: any) {
    if (e?.code === "ENOENT") {
      throw new VeiledhoodMcpError(
        "VEILEDHOOD_SESSION_FILE_MISSING",
        `No Veiledhood session found at ${path}. Log in at ${REAUTH_URL} to generate one.`,
        { path, reauthUrl: REAUTH_URL },
      );
    }
    throw new VeiledhoodMcpError(
      "VEILEDHOOD_SESSION_FILE_MISSING",
      `Cannot read session file at ${path}: ${e?.message ?? String(e)}`,
      { path },
    );
  }

  // Permission check (POSIX only — Windows ACLs need separate handling)
  if (process.platform !== "win32") {
    try {
      const s = await stat(path);
      const worldReadable = (s.mode & 0o004) !== 0;
      if (worldReadable) {
        // Warn but don't fail in v1 (per plan — hard-fail in v2)
        process.stderr.write(
          `[veiledhood-mcp] WARNING: ${path} is world-readable. Run: chmod 600 ${path}\n`,
        );
      }
    } catch {
      // stat failure is non-fatal; we already have the contents
    }
  }

  let parsed: VeiledhoodSession;
  try {
    const json = JSON.parse(raw);
    parsed = sessionSchema.parse(json);
  } catch (e: any) {
    throw new VeiledhoodMcpError(
      "VEILEDHOOD_SESSION_FILE_MALFORMED",
      `Session file at ${path} is malformed. Re-login at ${REAUTH_URL}.`,
      { path, parseError: e?.message },
    );
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (parsed.exp <= nowSec) {
    throw new VeiledhoodMcpError(
      "VEILEDHOOD_REAUTH_REQUIRED",
      `Veiledhood session expired. Re-login at ${REAUTH_URL}.`,
      { reauthUrl: REAUTH_URL },
    );
  }

  cached = parsed;
  return parsed;
}

/** Reset the in-memory cache. Used by tests + the rare "I just re-logged-in" code path. */
export function clearSessionCache(): void {
  cached = undefined;
}
