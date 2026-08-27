import { apiRequest } from "../apiClient.js";
import { VeiledhoodMcpError } from "../errors.js";
import type { McpToolResponse } from "./types.js";

/**
 * `data_list` — list the user's stored encrypted-data blobs. Labels are
 * encrypted inside each blob's ciphertext, so the list shows only id and
 * timestamps. Call `data_fetch` on an id to recover the label + payload.
 */
interface DataListItem {
  agentId: string;
  kind: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export async function handleDataList(): Promise<McpToolResponse> {
  try {
    const res = await apiRequest<{ agents: DataListItem[] }>("/agents", {
      query: { kind: "data" },
    });
    if (res.data.agents.length === 0) {
      return { content: [{ type: "text", text: "No encrypted data stored yet." }] };
    }
    const lines = res.data.agents.map(
      (a) => `- ${a.agentId} created=${a.createdAt} updated=${a.updatedAt}`,
    );
    return {
      content: [
        {
          type: "text",
          text:
            `${res.data.agents.length} encrypted blob(s) ` +
            `(labels encrypted — call data_fetch to decrypt):\n${lines.join("\n")}`,
        },
      ],
    };
  } catch (e) {
    if (e instanceof VeiledhoodMcpError) return e.toMcpContent();
    return new VeiledhoodMcpError(
      "VEILEDHOOD_UNKNOWN",
      `data_list failed: ${e instanceof Error ? e.message : String(e)}`,
    ).toMcpContent();
  }
}
