import { useEffect, useRef, useState } from "react";
import { Panel, Btn, Empty, ListRow } from "../components/primitives/primitives";
import { IcCopy, IcMcp, IcCheck, IcAlert, IcShield } from "../components/icons/Icons";
import { api, ApiError, BASE_URL } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import {
  generateMasterKey,
  wrapMasterKey,
  buildSessionJson,
  buildMasterKeyJson,
  downloadJsonFile,
  MIN_PASSPHRASE_LENGTH,
  type MasterKeyJson,
  type SessionJson,
} from "../lib/mcpSession";
import type { AuthValidateResponse, ExistingAgentEnvelope } from "../types/api";

const TOOLS = [
  "agent_create — create an encrypted agent strategy",
  "agent_list — list your agents (metadata only)",
  "agent_get — fetch and decrypt a single agent",
  "agent_update — pause/resume or update strategy params",
  "agent_delete — remove an agent",
  "agent_run — trigger a strategy run",
  "wallet_status — connection + auth status",
  "context_shielded — shielded balances + USD",
  "context_public — public balances + USD",
  "context_full — combined shielded + public context",
  "data_store — store an encrypted data record",
  "data_fetch — fetch and decrypt one record",
  "data_list — list stored records (metadata only)",
  "data_search — search decrypted records client-side",
];

type Phase = "idle" | "generating" | "wrapping" | "uploading" | "downloading" | "done" | "error";

const PHASE_LABEL: Record<Phase, string> = {
  idle: "Generate and download",
  generating: "Generating master key…",
  wrapping: "Wrapping with passphrase (PBKDF2, 600k iterations)…",
  uploading: "Uploading envelope to Veiledhood…",
  downloading: "Preparing session files…",
  done: "Done",
  error: "Retry",
};

function CommandBlock({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 8, background: "var(--p2)", border: "1px solid var(--line)", borderRadius: "var(--r2)", padding: "10px 12px" }}>
      <code style={{ fontFamily: "var(--mono)", fontSize: 11.5, color: "var(--tx2)", flex: 1, overflowX: "auto", whiteSpace: "pre" }}>{text}</code>
      <button
        onClick={() => {
          navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="btn btn-icon"
        style={{ flex: "0 0 auto" }}
        aria-label="Copy"
      >
        {copied ? <IcCheck size={14} /> : <IcCopy size={14} />}
      </button>
    </div>
  );
}

export function Mcp() {
  const { token, address } = useAuth();
  const [passphrase, setPassphrase] = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState<ExistingAgentEnvelope | null>(null);
  const [existingChecked, setExistingChecked] = useState(false);
  const [overwriteAck, setOverwriteAck] = useState(false);
  const lastSessionRef = useRef<{ masterKeyJson: MasterKeyJson; sessionJson: SessionJson } | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setExistingChecked(false);
    api
      .get<ExistingAgentEnvelope>("/agents/keys/envelope")
      .then((env) => {
        if (!cancelled) {
          setExisting(env);
          setExistingChecked(true);
        }
      })
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 404) setExisting(null);
        setExistingChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const overwriteRequired = existing != null;
  const passMismatch = confirmPass.length > 0 && confirmPass !== passphrase;
  const canSubmit =
    Boolean(token && address) &&
    existingChecked &&
    passphrase.length >= MIN_PASSPHRASE_LENGTH &&
    passphrase === confirmPass &&
    (!overwriteRequired || overwriteAck) &&
    phase !== "generating" &&
    phase !== "wrapping" &&
    phase !== "uploading" &&
    phase !== "downloading";

  function reset() {
    setPassphrase("");
    setConfirmPass("");
    setPhase("idle");
    setError(null);
    setOverwriteAck(false);
    lastSessionRef.current = null;
  }

  async function handleGenerate() {
    if (!token || !address) return;
    setError(null);
    try {
      setPhase("generating");
      const masterKey = generateMasterKey();

      setPhase("wrapping");
      const envelope = await wrapMasterKey(masterKey, passphrase);

      setPhase("uploading");
      const validation = await api.get<AuthValidateResponse>("/auth/validate");
      if (!validation.valid) throw new Error("Session expired during setup — please authenticate again.");
      if (typeof validation.exp !== "number") throw new Error("Session has no expiry — please re-authenticate.");
      await api.post("/agents/keys/envelope", envelope);

      setPhase("downloading");
      const session = buildSessionJson({ jwt: token, exp: validation.exp, address, apiBase: BASE_URL });
      const masterKeyJson = buildMasterKeyJson(masterKey, address);
      downloadJsonFile("session.json", session);
      await new Promise((r) => setTimeout(r, 200));
      downloadJsonFile("master.key", masterKeyJson);
      masterKey.fill(0);

      lastSessionRef.current = { masterKeyJson, sessionJson: session };
      setExisting({ ...envelope, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Setup failed");
      setPhase("error");
    }
  }

  const cfg = JSON.stringify(
    { mcpServers: { veiledhood: { command: "npx", args: ["-y", "@veiledhood/mcp-server"] } } },
    null,
    2,
  );
  const isWindows = navigator.userAgent.includes("Windows");
  const installCmd = isWindows
    ? `mkdir %USERPROFILE%\\.veiledhood 2>nul & move /Y "%USERPROFILE%\\Downloads\\session.json" "%USERPROFILE%\\.veiledhood\\session.json" & move /Y "%USERPROFILE%\\Downloads\\master.key" "%USERPROFILE%\\.veiledhood\\master.key"`
    : `mkdir -p ~/.veiledhood && mv ~/Downloads/session.json ~/.veiledhood/session.json && mv ~/Downloads/master.key ~/.veiledhood/master.key && chmod 600 ~/.veiledhood/session.json ~/.veiledhood/master.key`;
  const registerCmd = "claude mcp add veiledhood --scope user -- npx -y @veiledhood/mcp-server";

  return (
    <div className="wrap">
      <Panel title="Connect your AI agent (MCP)" kicker="Master key setup">
        <p className="desc" style={{ marginBottom: 16 }}>
          Generates a 32-byte master key in your browser, wraps it with your passphrase, and downloads two files for the Veiledhood MCP
          server. Veiledhood stores only the encrypted envelope — never the plaintext key.
        </p>

        {phase !== "done" ? (
          <>
            {overwriteRequired && (
              <div className="pbar" style={{ marginBottom: 14, borderColor: "var(--warn)", background: "var(--warn-dim)" }}>
                <IcAlert size={15} style={{ color: "var(--warn)" }} />
                <div style={{ flex: 1 }}>
                  <div className="pt">You already have a master key on file{existing?.updatedAt ? ` (updated ${new Date(existing.updatedAt).toLocaleString()})` : ""}.</div>
                  <div className="px">Generating a new one permanently orphans every agent/data record encrypted with the old key.</div>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 12, cursor: "pointer" }}>
                    <input type="checkbox" checked={overwriteAck} onChange={() => setOverwriteAck((v) => !v)} />I understand this will orphan existing encrypted data
                  </label>
                </div>
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 10 }}>
              <input
                type="password"
                placeholder="Passphrase"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                className="ai-in"
                style={{ fontSize: 14, fontFamily: "var(--sans)", background: "var(--p2)", padding: "10px 12px", borderRadius: "var(--r2)" }}
              />
              <input
                type="password"
                placeholder="Confirm passphrase"
                value={confirmPass}
                onChange={(e) => setConfirmPass(e.target.value)}
                className="ai-in"
                style={{ fontSize: 14, fontFamily: "var(--sans)", background: "var(--p2)", padding: "10px 12px", borderRadius: "var(--r2)", borderColor: passMismatch ? "var(--neg)" : undefined }}
              />
              {passMismatch && <div className="lx" style={{ color: "var(--neg)" }}>Passphrases do not match</div>}
              <div className="lx">Minimum {MIN_PASSPHRASE_LENGTH} characters. If you lose this passphrase, you lose access to your encrypted agents — Veiledhood cannot recover it.</div>
            </div>

            {error && (
              <div className="pbar" style={{ marginBottom: 14, borderColor: "var(--neg)", background: "var(--neg-dim)" }}>
                <IcAlert size={15} style={{ color: "var(--neg)" }} />
                <span className="pt" style={{ color: "var(--neg)" }}>{error}</span>
              </div>
            )}

            <Btn kind="pri" block onClick={handleGenerate} disabled={!canSubmit}>
              {PHASE_LABEL[phase]}
            </Btn>
          </>
        ) : (
          <>
            <div className="pbar" style={{ marginBottom: 16, borderColor: "var(--pos)", background: "var(--pos-dim)" }}>
              <IcCheck size={15} style={{ color: "var(--pos)" }} />
              <span className="pt">session.json and master.key downloaded. Move them into place, then register the MCP server.</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <div className="lbl" style={{ marginBottom: 6 }}>1. Install files</div>
                <CommandBlock text={installCmd} />
              </div>
              <div>
                <div className="lbl" style={{ marginBottom: 6 }}>2. Register MCP server</div>
                <CommandBlock text={registerCmd} />
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <Btn kind="sec" onClick={() => lastSessionRef.current && downloadJsonFile("session.json", lastSessionRef.current.sessionJson)}>
                Re-download session.json
              </Btn>
              <Btn kind="sec" onClick={() => lastSessionRef.current && downloadJsonFile("master.key", lastSessionRef.current.masterKeyJson)}>
                Re-download master.key
              </Btn>
              <Btn kind="ghost" onClick={reset}>
                Reset
              </Btn>
            </div>
          </>
        )}
      </Panel>

      <Panel title="MCP config" kicker="Client setup">
        <CommandBlock text={cfg} />
      </Panel>
      <Panel title="Exposed tools" pad={false}>
        {TOOLS.map((t) => {
          const [name, desc] = t.split(" — ");
          return <ListRow key={name} icon={<IcMcp size={15} />} title={name} sub={desc} />;
        })}
      </Panel>
      <Panel title="Connected clients">
        <Empty icon={<IcShield size={22} />} title="Client session tracking isn't available yet" desc="The API has no session registry — connect/revoke for individual MCP clients isn't backed by anything real on this deployment." />
      </Panel>
    </div>
  );
}
