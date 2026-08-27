import { z } from "zod";
import { decryptString } from "@veiledhood/agent-crypto/aesgcm";
import { apiRequest } from "../apiClient.js";
import { loadMasterKey, buildAad } from "../keys.js";
import { VeiledhoodMcpError } from "../errors.js";
import type { McpToolResponse } from "./types.js";

export const agentGetInputShape = { id: z.string().min(8) };
export const agentGetInputSchema = z.object(agentGetInputShape);
export type AgentGetInput = z.infer<typeof agentGetInputSchema>;

interface AgentDoc {
  agentId: string;
  kind: string;
  ciphertext: string;
  iv: string;
  version: number;
  status: string;
  lastRunAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function handleAgentGet(input: AgentGetInput): Promise<McpToolResponse> {
  try {
    const { aesKey } = await loadMasterKey();
    const res = await apiRequest<AgentDoc>(`/agents/${encodeURIComponent(input.id)}`);
    const doc = res.data;
    const aad = buildAad(doc.kind, doc.version);

    let params: unknown;
    try {
      const plaintext = await decryptString(
        aesKey,
        { iv: doc.iv, ct: doc.ciphertext, version: doc.version },
        aad,
      );
      params = JSON.parse(plaintext);
    } catch (e) {
      return new VeiledhoodMcpError(
        "VEILEDHOOD_DECRYPT_FAILED",
        `Could not decrypt agent ${input.id}. Master key may not match this agent.`,
      ).toMcpContent();
    }

    const out = {
      agentId: doc.agentId,
      kind: doc.kind,
      status: doc.status,
      lastRunAt: doc.lastRunAt ?? null,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      params,
    };
    return { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] };
  } catch (e) {
    if (e instanceof VeiledhoodMcpError) return e.toMcpContent();
    return new VeiledhoodMcpError(
      "VEILEDHOOD_UNKNOWN",
      `agent_get failed: ${e instanceof Error ? e.message : String(e)}`,
    ).toMcpContent();
  }
}
