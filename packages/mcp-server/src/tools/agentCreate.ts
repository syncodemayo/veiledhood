import { z } from "zod";
import { encrypt } from "@veiledhood/agent-crypto/aesgcm";
import { apiRequest } from "../apiClient.js";
import { loadMasterKey, buildAad } from "../keys.js";
import { VeiledhoodMcpError } from "../errors.js";
import { AgentKindEnum, type McpToolResponse } from "./types.js";

export const agentCreateInputShape = {
  kind: AgentKindEnum,
  params: z
    .record(z.unknown())
    .refine((v) => Object.keys(v).length > 0, { message: "params is empty" }),
};

export const agentCreateInputSchema = z.object(agentCreateInputShape);
export type AgentCreateInput = z.infer<typeof agentCreateInputSchema>;

const VERSION = 1;

export async function handleAgentCreate(input: AgentCreateInput): Promise<McpToolResponse> {
  try {
    const { aesKey } = await loadMasterKey();
    const aad = buildAad(input.kind, VERSION);

    let envelope;
    try {
      envelope = await encrypt(aesKey, JSON.stringify(input.params), aad);
    } catch (e) {
      return new VeiledhoodMcpError(
        "VEILEDHOOD_ENCRYPT_FAILED",
        `Failed to encrypt agent params: ${e instanceof Error ? e.message : String(e)}`,
      ).toMcpContent();
    }

    const res = await apiRequest<{ agentId: string; createdAt: string }>("/agents", {
      method: "POST",
      body: {
        kind: input.kind,
        ciphertext: envelope.ct,
        iv: envelope.iv,
        version: envelope.version,
      },
    });

    return {
      content: [
        {
          type: "text",
          text:
            `Created ${input.kind} agent ${res.data.agentId} (${res.data.createdAt}). ` +
            `Params encrypted locally; Veiledhood stores ciphertext only.`,
        },
      ],
    };
  } catch (e) {
    if (e instanceof VeiledhoodMcpError) return e.toMcpContent();
    return new VeiledhoodMcpError(
      "VEILEDHOOD_UNKNOWN",
      `agent_create failed: ${e instanceof Error ? e.message : String(e)}`,
    ).toMcpContent();
  }
}
