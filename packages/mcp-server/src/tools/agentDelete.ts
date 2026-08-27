import { z } from "zod";
import { apiRequest } from "../apiClient.js";
import { VeiledhoodMcpError } from "../errors.js";
import type { McpToolResponse } from "./types.js";

export const agentDeleteInputShape = { id: z.string().min(8) };
export const agentDeleteInputSchema = z.object(agentDeleteInputShape);
export type AgentDeleteInput = z.infer<typeof agentDeleteInputSchema>;

export async function handleAgentDelete(input: AgentDeleteInput): Promise<McpToolResponse> {
  try {
    await apiRequest<{ ok: true }>(
      `/agents/${encodeURIComponent(input.id)}`,
      { method: "DELETE" },
    );
    return { content: [{ type: "text", text: `Deleted agent ${input.id}.` }] };
  } catch (e) {
    if (e instanceof VeiledhoodMcpError) return e.toMcpContent();
    return new VeiledhoodMcpError(
      "VEILEDHOOD_UNKNOWN",
      `agent_delete failed: ${e instanceof Error ? e.message : String(e)}`,
    ).toMcpContent();
  }
}
