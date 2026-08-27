import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Panel, Btn, Empty } from "../components/primitives/primitives";
import { Mark, IcAgent } from "../components/icons/Icons";
import { api, ApiError } from "../lib/api";
import type { AiChatResponse, AiConfigResponse } from "../types/api";

const USDC_DECIMALS = 6;
function formatRawUsdc(raw: string | bigint, maxFractionDigits = 4): string {
  let b: bigint;
  try {
    b = typeof raw === "bigint" ? raw : BigInt(raw);
  } catch {
    return "—";
  }
  const scale = 10n ** BigInt(USDC_DECIMALS);
  const whole = b / scale;
  const frac = (b % scale).toString().padStart(USDC_DECIMALS, "0").replace(/0+$/, "");
  if (frac.length === 0) return whole.toString();
  return `${whole.toString()}.${frac.slice(0, maxFractionDigits)}`;
}

interface ChatTurn {
  id: string;
  role: "user" | "assistant" | "error";
  text: string;
  model?: string;
  elapsedMs?: number;
  chargeUsdc?: string;
}

export function Agent() {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [val, setVal] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [usage, setUsage] = useState<{ minRemaining: number; dayRemaining: number } | null>(null);
  const [shieldedUsdcRaw, setShieldedUsdcRaw] = useState<string | null>(null);

  const config = useQuery({
    queryKey: ["ai-config"],
    queryFn: async () => {
      const r = await api.get<AiConfigResponse>("/ai/config");
      setSelectedModel((prev) => prev ?? r.models[0] ?? null);
      setUsage(r.usage);
      setShieldedUsdcRaw(r.shieldedUsdcRaw);
      return r;
    },
  });

  async function send() {
    if (!val.trim() || !selectedModel) return;
    const prompt = val;
    setVal("");
    setTurns((t) => [...t, { id: crypto.randomUUID(), role: "user", text: prompt }]);
    setBusy(true);
    try {
      const res = await api.post<AiChatResponse>("/ai/chat", { prompt, model: selectedModel, maxTokens: 512 });
      setTurns((t) => [
        ...t,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: res.message,
          model: res.modelUsed,
          elapsedMs: res.elapsedMs,
          chargeUsdc: res.chargeRawUsdc ? formatRawUsdc(res.chargeRawUsdc) : undefined,
        },
      ]);
      if (res.balanceAfterRawUsdc != null) setShieldedUsdcRaw(res.balanceAfterRawUsdc);
      config.refetch();
    } catch (e) {
      let text = "Something went wrong.";
      if (e instanceof ApiError) {
        const body = e.body as { retryAfterSec?: number; minRemaining?: number; dayRemaining?: number } | undefined;
        if (e.status === 429) {
          text = `Rate limit hit — try again in ${body?.retryAfterSec ?? 60}s`;
          if (body?.minRemaining != null && body?.dayRemaining != null) setUsage({ minRemaining: body.minRemaining, dayRemaining: body.dayRemaining });
        } else {
          text = e.message;
        }
      }
      setTurns((t) => [...t, { id: crypto.randomUUID(), role: "error", text }]);
    } finally {
      setBusy(false);
    }
  }

  if (config.data && !config.data.enabled) {
    return (
      <div className="wrap-n">
        <Panel title="Agent">
          <Empty icon={<IcAgent size={22} />} title="AI inference isn't configured" desc="SOLROUTER_API_KEY isn't set on this deployment's API server, so /ai/chat has no upstream to call." />
        </Panel>
      </div>
    );
  }

  return (
    <div className="wrap-n">
      <Panel
        title="Agent"
        kicker="Private inference"
        action={
          config.data && config.data.models.length > 0 ? (
            <select
              value={selectedModel ?? ""}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="tabs"
              style={{ background: "var(--p2)", border: "1px solid var(--line)", borderRadius: "var(--r2)", padding: "6px 10px", color: "var(--tx)", fontFamily: "var(--mono)", fontSize: 12 }}
            >
              {config.data.models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          ) : undefined
        }
      >
        <div className="chat-body">
          {turns.length === 0 && (
            <div className="desc" style={{ textAlign: "center", marginTop: 40 }}>
              Ask about your positions, or anything else. Encrypted end-to-end, routed through Tor. Cleared on reload.
            </div>
          )}
          {turns.map((m) => (
            <div key={m.id} className="chat-row" style={m.role === "user" ? { flexDirection: "row-reverse" } : undefined}>
              {m.role !== "user" && (
                <span className="chat-avatar">
                  <Mark size={14} compact />
                </span>
              )}
              <div>
                <div className={`chat-msg ${m.role === "error" ? "agent" : m.role}`} style={m.role === "error" ? { borderColor: "var(--neg)", color: "var(--neg)" } : undefined}>
                  {m.text}
                </div>
                {m.role === "assistant" && (m.model || m.elapsedMs != null || m.chargeUsdc) && (
                  <div className="lx" style={{ marginTop: 4 }}>
                    {m.model} · {m.elapsedMs != null ? `${(m.elapsedMs / 1000).toFixed(1)}s` : null} {m.chargeUsdc ? `· −${m.chargeUsdc} USDC` : null}
                  </div>
                )}
              </div>
            </div>
          ))}
          {busy && (
            <div className="chat-row">
              <span className="chat-avatar">
                <Mark size={14} compact />
              </span>
              <div className="chat-msg agent desc">Sealing prompt · paying · inferring…</div>
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
          <input
            className="ai-in"
            style={{ fontSize: 14, fontFamily: "var(--sans)", background: "var(--p2)", padding: "10px 14px", borderRadius: "var(--r2)", flex: 1 }}
            placeholder="Message the agent…"
            value={val}
            onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send()}
          />
          <Btn kind="pri" onClick={send} disabled={busy || !val.trim() || !selectedModel}>
            Send
          </Btn>
        </div>
      </Panel>
      <div className="g3" style={{ marginTop: 16 }}>
        <Panel>
          <div className="lbl">Shielded USDC</div>
          <div className="sv num" style={{ fontSize: 22, marginTop: 8 }}>
            {shieldedUsdcRaw ? formatRawUsdc(shieldedUsdcRaw, 2) : "—"}
          </div>
        </Panel>
        <Panel>
          <div className="lbl">Quota / day</div>
          <div className="sv num" style={{ fontSize: 22, marginTop: 8 }}>
            {usage ? `${usage.dayRemaining} left` : "—"}
          </div>
        </Panel>
        <Panel>
          <div className="lbl">Quota / min</div>
          <div className="sv num" style={{ fontSize: 22, marginTop: 8 }}>
            {usage ? `${usage.minRemaining} left` : "—"}
          </div>
        </Panel>
      </div>
    </div>
  );
}
