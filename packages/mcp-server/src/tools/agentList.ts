import { apiRequest } from "../apiClient.js";
import { VeiledhoodMcpError } from "../errors.js";
import type { McpToolResponse } from "./types.js";

interface AgentListItem {
  agentId: string;
  kind: string;
  status: string;
  lastRunAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function handleAgentList(): Promise<McpToolResponse> {
  try {
    const res = await apiRequest<{ agents: AgentListItem[] }>("/agents");
    if (res.data.agents.length === 0) {
      return { content: [{ type: "text", text: "No agents yet." }] };
    }
    const lines = res.data.agents.map(
      (a) =>
        `- ${a.kind.padEnd(10)} ${a.agentId} ${a.status}` +
        (a.lastRunAt ? ` last_run=${a.lastRunAt}` : ""),
    );
    return {
      content: [
        {
          type: "text",
          text: `${res.data.agents.length} agent(s):\n${lines.join("\n")}`,
        },
      ],
    };
  } catch (e) {
    if (e instanceof VeiledhoodMcpError) return e.toMcpContent();
    return new VeiledhoodMcpError(
      "VEILEDHOOD_UNKNOWN",
      `agent_list failed: ${e instanceof Error ? e.message : String(e)}`,
    ).toMcpContent();
  }
}
