import { z } from "zod";
import { encrypt } from "@veiledhood/agent-crypto/aesgcm";
import { apiRequest } from "../apiClient.js";
import { loadMasterKey, buildAad } from "../keys.js";
import { VeiledhoodMcpError } from "../errors.js";
import type { McpToolResponse } from "./types.js";

/**
 * `data_store` — encrypt and store an arbitrary opaque blob in Veiledhood's
 * encrypted-data vault. The label, payload, and savedAt timestamp are all
 * encrypted together; the server only sees ciphertext + a `kind="data"`
 * discriminator.
 *
 * Use this for documents, files, config, anything you want stored under
 * AES-256-GCM with your master key. The 1 MB server cap is enforced on
 * ciphertext size — base64 inflation means useful plaintext is ~750 KB.
 */
export const dataStoreInputShape = {
  label: z.string().min(1).max(256),
  data: z.string().min(1),
  tags: z.array(z.string().min(1).max(64)).max(32).optional(),
};

export const dataStoreInputSchema = z.object(dataStoreInputShape);
export type DataStoreInput = z.infer<typeof dataStoreInputSchema>;

const VERSION = 1;
const KIND = "data" as const;

export async function handleDataStore(input: DataStoreInput): Promise<McpToolResponse> {
  try {
    const { aesKey } = await loadMasterKey();
    const aad = buildAad(KIND, VERSION);
    const plaintext = JSON.stringify({
      label: input.label,
      data: input.data,
      tags: input.tags ?? [],
      savedAt: new Date().toISOString(),
    });

    let envelope;
    try {
      envelope = await encrypt(aesKey, plaintext, aad);
    } catch (e) {
      return new VeiledhoodMcpError(
        "VEILEDHOOD_ENCRYPT_FAILED",
        `Failed to encrypt data blob: ${e instanceof Error ? e.message : String(e)}`,
      ).toMcpContent();
    }

    const res = await apiRequest<{ agentId: string; createdAt: string }>("/agents", {
      method: "POST",
      body: {
        kind: KIND,
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
            `Stored encrypted data ${res.data.agentId} (${res.data.createdAt}). ` +
            `Payload encrypted locally; Veiledhood stores ciphertext only.`,
        },
      ],
    };
  } catch (e) {
    if (e instanceof VeiledhoodMcpError) return e.toMcpContent();
    return new VeiledhoodMcpError(
      "VEILEDHOOD_UNKNOWN",
      `data_store failed: ${e instanceof Error ? e.message : String(e)}`,
    ).toMcpContent();
  }
}
