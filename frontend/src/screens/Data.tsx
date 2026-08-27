import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Panel, Empty, ListRow, Btn, Pill } from "../components/primitives/primitives";
import { IcData, IcPlus, IcSearch } from "../components/icons/Icons";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import type { AgentRecord } from "../types/api";

interface DecryptedRecord {
  agentId: string;
  label: string;
  tags: string[];
  body: string;
  createdAt?: string;
}

export function DataScreen() {
  const { dataCrypto, unlock, connecting } = useAuth();
  const qc = useQueryClient();
  const [records, setRecords] = useState<DecryptedRecord[]>([]);
  const [decrypting, setDecrypting] = useState(false);
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [tags, setTags] = useState("");
  const [body, setBody] = useState("");

  const list = useQuery({
    queryKey: ["agents-data"],
    queryFn: () => api.get<AgentRecord[]>("/agents?kind=data"),
    enabled: Boolean(dataCrypto),
  });

  useEffect(() => {
    if (!list.data || !dataCrypto) return;
    setDecrypting(true);
    Promise.all(
      list.data.map(async (r) => {
        try {
          const plain = await dataCrypto.decrypt<{ label: string; tags: string[]; body: string }>(r.ciphertext, r.iv);
          return { agentId: r.agentId, label: plain.label, tags: plain.tags, body: plain.body, createdAt: r.createdAt };
        } catch {
          return { agentId: r.agentId, label: "(undecryptable)", tags: [], body: "" };
        }
      }),
    )
      .then(setRecords)
      .finally(() => setDecrypting(false));
  }, [list.data, dataCrypto]);

  const createMut = useMutation({
    mutationFn: async () => {
      if (!dataCrypto) throw new Error("Locked");
      const enc = await dataCrypto.encrypt({ label, tags: tags.split(",").map((t) => t.trim()).filter(Boolean), body });
      return api.post("/agents", { kind: "data", ciphertext: enc.ciphertext, iv: enc.iv });
    },
    onSuccess: () => {
      setAdding(false);
      setLabel("");
      setTags("");
      setBody("");
      qc.invalidateQueries({ queryKey: ["agents-data"] });
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.del(`/agents/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agents-data"] }),
  });

  if (!dataCrypto) {
    return (
      <div className="wrap-n">
        <Panel title="Encrypted data">
          <Empty
            icon={<IcData size={22} />}
            title="Sign to unlock"
            desc="Your encryption key is derived from a wallet signature and isn't persisted. Sign once per session to decrypt your records."
            action={
              <Btn kind="pri" onClick={() => unlock()} disabled={connecting}>
                {connecting ? "Signing…" : "Sign to unlock"}
              </Btn>
            }
          />
        </Panel>
      </div>
    );
  }

  const filtered = records.filter((r) => !q || r.label.toLowerCase().includes(q.toLowerCase()) || r.tags.some((t) => t.toLowerCase().includes(q.toLowerCase())));

  return (
    <div className="wrap">
      <Panel
        title="Encrypted records"
        kicker="Ciphertext at rest"
        action={
          <Btn kind="pri" size="sm" icon={<IcPlus size={14} />} onClick={() => setAdding((v) => !v)}>
            New
          </Btn>
        }
      >
        <div className="ai" style={{ marginBottom: 14 }}>
          <div className="ai-row">
            <IcSearch size={15} style={{ color: "var(--tx4)" }} />
            <input className="ai-in" style={{ fontSize: 14, fontFamily: "var(--sans)" }} placeholder="Search label or tags" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        {adding && (
          <div style={{ border: "1px solid var(--line)", borderRadius: "var(--r3)", padding: 14, marginBottom: 14, display: "flex", flexDirection: "column", gap: 10 }}>
            <input className="ai-in" style={{ fontSize: 14, fontFamily: "var(--sans)", background: "var(--p2)", padding: "8px 10px", borderRadius: "var(--r2)" }} placeholder="Label" value={label} onChange={(e) => setLabel(e.target.value)} />
            <input className="ai-in" style={{ fontSize: 13, fontFamily: "var(--mono)", background: "var(--p2)", padding: "8px 10px", borderRadius: "var(--r2)" }} placeholder="tags, comma, separated" value={tags} onChange={(e) => setTags(e.target.value)} />
            <textarea style={{ fontFamily: "var(--sans)", fontSize: 13, background: "var(--p2)", border: 0, borderRadius: "var(--r2)", padding: 10, color: "var(--tx)", minHeight: 70, outline: "none" }} placeholder="Content" value={body} onChange={(e) => setBody(e.target.value)} />
            <Btn kind="pri" onClick={() => createMut.mutate()} disabled={!label || createMut.isPending}>
              {createMut.isPending ? "Encrypting…" : "Encrypt and store"}
            </Btn>
          </div>
        )}
        {(list.isLoading || decrypting) && <div className="desc">Decrypting…</div>}
        {!list.isLoading && !decrypting && filtered.length === 0 && records.length === 0 && (
          <Empty icon={<IcData size={22} />} title="Nothing stored yet" desc="Encrypted records you save will show up here." />
        )}
        {!list.isLoading && !decrypting && filtered.length === 0 && records.length > 0 && (
          <Empty icon={<IcSearch size={22} />} title="No matches" desc="Nothing matches that search." />
        )}
        {filtered.map((r) => (
          <ListRow
            key={r.agentId}
            icon={<IcData size={15} />}
            title={r.label}
            sub={r.tags.map((t) => `#${t}`).join(" ")}
            end={
              <Btn kind="ghost" size="sm" onClick={() => deleteMut.mutate(r.agentId)}>
                <Pill tone="neg">Delete</Pill>
              </Btn>
            }
          />
        ))}
      </Panel>
    </div>
  );
}
