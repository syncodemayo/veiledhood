import { z } from "zod";

export const AgentKindEnum = z.enum(["dca", "rebalance", "yield"]);
export type AgentKind = z.infer<typeof AgentKindEnum>;

/**
 * Statuses accepted by the API PATCH endpoint. The backend uses "deleted" as
 * a soft-delete sentinel set ONLY by DELETE — clients cannot PATCH to deleted.
 */
export const AgentUpdateStatusEnum = z.enum(["active", "paused"]);
export type AgentUpdateStatus = z.infer<typeof AgentUpdateStatusEnum>;

/** Per-strategy plaintext params. Encrypted before leaving the user's machine. */
export type AgentParams =
  | {
      kind: "dca";
      fromAsset: string;
      toAsset: string;
      amountPerRun: string;
      cadence: string;
      maxSlippageBps?: number;
      expiresAt?: string;
    }
  | {
      kind: "rebalance";
      targetWeights: Record<string, number>;
      tolerance: number;
      cadence: string;
    }
  | {
      kind: "yield";
      asset: string;
      protocol: string;
      minAprBps: number;
      maxAllocation: string;
    };

/**
 * MCP tool response. Includes an index signature so it satisfies the SDK's
 * `CallToolResult` type, which extends a generic `_meta`-style record.
 */
export interface McpToolResponse {
  [k: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}
