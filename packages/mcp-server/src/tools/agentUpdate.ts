import { z } from "zod";
import { encrypt } from "@veiledhood/agent-crypto/aesgcm";
import { apiRequest } from "../apiClient.js";
import { loadMasterKey, buildAad } from "../keys.js";
import { VeiledhoodMcpError } from "../errors.js";
import { AgentUpdateStatusEnum, type McpToolResponse } from "./types.js";

/**
 * NOTE on status enum: backend PATCH only accepts "active" | "paused" (see
 * `api/src/routes/agents.ts` patchBody). To delete, the caller uses
 * `agent_delete` which fires an HTTP DELETE.
 */
export const agentUpdateInputShape = {
  id: z.string().min(8),
  status: AgentUpdateStatusEnum.optional(),
  params: z.record(z.unknown()).optional(),
};

export const agentUpdateInputSchema = z.object(agentUpdateInputShape).refine(
  (b) => b.status !== undefined || b.params !== undefined,
  { message: "must include status or params" },
);
export type AgentUpdateInput = z.infer<typeof agentUpdateInputSchema>;

const VERSION = 1;

export async function handleAgentUpdate(input: AgentUpdateInput): Promise<McpToolResponse> {
  try {
    const body: Record<string, unknown> = {};
    if (input.status !== undefined) body.status = input.status;

    if (input.params !== undefined) {
      const { aesKey } = await loadMasterKey();
      // Need the agent's kind to build correct AAD — fetch first.
      const cur = await apiRequest<{ kind: string }>(
        `/agents/${encodeURIComponent(input.id)}`,
      );
      const aad = buildAad(cur.data.kind, VERSION);

      let envelope;
      try {
        envelope = await encrypt(aesKey, JSON.stringify(input.params), aad);
      } catch (e) {
        return new VeiledhoodMcpError(
          "VEILEDHOOD_ENCRYPT_FAILED",
          `Failed to encrypt updated params: ${e instanceof Error ? e.message : String(e)}`,
        ).toMcpContent();
      }
      body.ciphertext = envelope.ct;
      body.iv = envelope.iv;
    }

    const res = await apiRequest<{ ok: true; updatedAt: string }>(
      `/agents/${encodeURIComponent(input.id)}`,
      { method: "PATCH", body },
    );
    return {
      content: [
        { type: "text", text: `Updated agent ${input.id} at ${res.data.updatedAt}.` },
      ],
    };
  } catch (e) {
    if (e instanceof VeiledhoodMcpError) return e.toMcpContent();
    return new VeiledhoodMcpError(
      "VEILEDHOOD_UNKNOWN",
      `agent_update failed: ${e instanceof Error ? e.message : String(e)}`,
    ).toMcpContent();
  }
}
