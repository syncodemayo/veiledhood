import { z } from "zod";
import { decryptString } from "@veiledhood/agent-crypto/aesgcm";
import { apiRequest } from "../apiClient.js";
import { loadMasterKey, buildAad } from "../keys.js";
import { VeiledhoodMcpError } from "../errors.js";
import type { McpToolResponse } from "./types.js";

/**
 * `data_fetch` — retrieve and decrypt a stored encrypted-data blob by id.
 * Returns the original label, payload, and savedAt timestamp.
 */
export const dataFetchInputShape = { id: z.string().min(8) };
export const dataFetchInputSchema = z.object(dataFetchInputShape);
export type DataFetchInput = z.infer<typeof dataFetchInputSchema>;

interface DataDoc {
  agentId: string;
  kind: string;
  ciphertext: string;
  iv: string;
  version: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface DataPayload {
  label: string;
  data: string;
  tags?: string[];
  savedAt: string;
}

export async function handleDataFetch(input: DataFetchInput): Promise<McpToolResponse> {
  try {
    const { aesKey } = await loadMasterKey();
    const res = await apiRequest<DataDoc>(`/agents/${encodeURIComponent(input.id)}`);
    const doc = res.data;

    if (doc.kind !== "data") {
      return new VeiledhoodMcpError(
        "VEILEDHOOD_VALIDATION_ERROR",
        `Item ${input.id} is kind="${doc.kind}", not data. Use agent_get instead.`,
      ).toMcpContent();
    }

    const aad = buildAad(doc.kind, doc.version);

    let payload: DataPayload;
    try {
      const plaintext = await decryptString(
        aesKey,
        { iv: doc.iv, ct: doc.ciphertext, version: doc.version },
        aad,
      );
      payload = JSON.parse(plaintext) as DataPayload;
    } catch (e) {
      return new VeiledhoodMcpError(
        "VEILEDHOOD_DECRYPT_FAILED",
        `Could not decrypt data ${input.id}. Master key may not match.`,
      ).toMcpContent();
    }

    const out = {
      id: doc.agentId,
      label: payload.label,
      data: payload.data,
      tags: payload.tags ?? [],
      savedAt: payload.savedAt,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
    return { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] };
  } catch (e) {
    if (e instanceof VeiledhoodMcpError) return e.toMcpContent();
    return new VeiledhoodMcpError(
      "VEILEDHOOD_UNKNOWN",
      `data_fetch failed: ${e instanceof Error ? e.message : String(e)}`,
    ).toMcpContent();
  }
}
