import { z } from "zod";
import { decryptString } from "@veiledhood/agent-crypto/aesgcm";
import { apiRequest } from "../apiClient.js";
import { loadMasterKey, buildAad } from "../keys.js";
import { VeiledhoodMcpError } from "../errors.js";
import type { McpToolResponse } from "./types.js";

/**
 * `data_search` — find encrypted-data blobs whose tags match a query.
 *
 * Tags are encrypted alongside the payload (NOT exposed to the server), so
 * filtering happens client-side: list all kind=data records, decrypt each,
 * keep those whose tags array contains every requested tag. O(n) on the
 * user's blob count. Fine for the realistic researcher scale (<100 records);
 * if a user passes 10k records expect this to be slow — they should narrow
 * with `kindHint` or page in their own loop.
 *
 * Matching is exact-string, case-insensitive. Pass an empty `tags` array to
 * return everything (equivalent to `data_list` but with labels surfaced).
 */
export const dataSearchInputShape = {
  tags: z.array(z.string().min(1).max(64)).min(0).max(8),
  matchAll: z.boolean().optional(),
};

export const dataSearchInputSchema = z.object(dataSearchInputShape);
export type DataSearchInput = z.infer<typeof dataSearchInputSchema>;

interface DataListItem {
  agentId: string;
  kind: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

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

interface SearchHit {
  id: string;
  label: string;
  tags: string[];
  savedAt: string;
  createdAt: string;
  updatedAt: string;
}

const KIND = "data";

export async function handleDataSearch(input: DataSearchInput): Promise<McpToolResponse> {
  try {
    const { aesKey } = await loadMasterKey();
    const wantedTags = input.tags.map((t) => t.toLowerCase());
    const matchAll = input.matchAll ?? true;

    const listRes = await apiRequest<{ agents: DataListItem[] }>("/agents", {
      query: { kind: KIND },
    });

    if (listRes.data.agents.length === 0) {
      return { content: [{ type: "text", text: "No encrypted data stored yet." }] };
    }

    const hits: SearchHit[] = [];
    const decryptFailures: string[] = [];

    for (const item of listRes.data.agents) {
      let docRes;
      try {
        docRes = await apiRequest<DataDoc>(`/agents/${encodeURIComponent(item.agentId)}`);
      } catch {
        decryptFailures.push(item.agentId);
        continue;
      }
      const doc = docRes.data;
      if (doc.kind !== KIND) continue;

      const aad = buildAad(doc.kind, doc.version);
      let payload: DataPayload;
      try {
        const plaintext = await decryptString(
          aesKey,
          { iv: doc.iv, ct: doc.ciphertext, version: doc.version },
          aad,
        );
        payload = JSON.parse(plaintext) as DataPayload;
      } catch {
        decryptFailures.push(item.agentId);
        continue;
      }

      const haveTags = (payload.tags ?? []).map((t) => t.toLowerCase());

      if (wantedTags.length === 0) {
        hits.push(toHit(doc, payload, haveTags));
        continue;
      }

      const matches = matchAll
        ? wantedTags.every((t) => haveTags.includes(t))
        : wantedTags.some((t) => haveTags.includes(t));

      if (matches) hits.push(toHit(doc, payload, haveTags));
    }

    if (hits.length === 0) {
      const query =
        wantedTags.length === 0
          ? "(no tags filter)"
          : `tags=[${wantedTags.join(", ")}] mode=${matchAll ? "all" : "any"}`;
      return {
        content: [{ type: "text", text: `No matching encrypted data found for ${query}.` }],
      };
    }

    const lines = hits.map(
      (h) => `- ${h.id} "${h.label}" tags=[${h.tags.join(", ")}] saved=${h.savedAt}`,
    );
    const warn =
      decryptFailures.length > 0
        ? `\n(${decryptFailures.length} record(s) skipped — fetch or decrypt failed)`
        : "";
    return {
      content: [
        {
          type: "text",
          text: `Found ${hits.length} match(es):\n${lines.join("\n")}${warn}`,
        },
      ],
    };
  } catch (e) {
    if (e instanceof VeiledhoodMcpError) return e.toMcpContent();
    return new VeiledhoodMcpError(
      "VEILEDHOOD_UNKNOWN",
      `data_search failed: ${e instanceof Error ? e.message : String(e)}`,
    ).toMcpContent();
  }
}

function toHit(doc: DataDoc, payload: DataPayload, lowerTags: string[]): SearchHit {
  return {
    id: doc.agentId,
    label: payload.label,
    tags: lowerTags,
    savedAt: payload.savedAt,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}
