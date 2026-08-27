import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { handleAgentCreate, agentCreateInputShape } from "./tools/agentCreate.js";
import { handleAgentList } from "./tools/agentList.js";
import { handleAgentGet, agentGetInputShape } from "./tools/agentGet.js";
import { handleAgentUpdate, agentUpdateInputShape } from "./tools/agentUpdate.js";
import { handleAgentDelete, agentDeleteInputShape } from "./tools/agentDelete.js";
import { handleAgentRun, agentRunInputShape } from "./tools/agentRun.js";
import { handleWalletStatus } from "./tools/walletStatus.js";
import { handleContextShielded, contextShieldedInputShape } from "./tools/contextShielded.js";
import { handleContextPublic, contextPublicInputShape } from "./tools/contextPublic.js";
import { handleContextFull, contextFullInputShape } from "./tools/contextFull.js";
import { handleDataStore, dataStoreInputShape } from "./tools/dataStore.js";
import { handleDataFetch, dataFetchInputShape } from "./tools/dataFetch.js";
import { handleDataList } from "./tools/dataList.js";
import { handleDataSearch, dataSearchInputShape } from "./tools/dataSearch.js";
import { handlePayX402, payX402InputShape } from "./tools/payX402.js";
import { handleX402PayerInfo } from "./tools/x402PayerInfo.js";

const VERSION = "0.5.0";

/**
 * Build the Veiledhood MCP server with all tools registered.
 *
 * CRITICAL: `inputSchema` is a ZodRawShape (plain object of zod fields), NOT
 * a `z.object({...})`. The SDK iterates the shape internally — passing a
 * ZodObject breaks tool discovery. See schema-shape.test.ts.
 */
export function buildServer(): McpServer {
  const server = new McpServer({ name: "veiledhood", version: VERSION });

  server.registerTool(
    "agent_create",
    {
      description:
        "Create a new encrypted agent strategy on Veiledhood. Params are encrypted locally with the user's master key before sending. Veiledhood stores ciphertext only.",
      inputSchema: agentCreateInputShape,
    },
    async (input) => handleAgentCreate(input as Parameters<typeof handleAgentCreate>[0]),
  );

  server.registerTool(
    "agent_list",
    {
      description:
        "List the user's agents (kind, id, status, timestamps). Does NOT return strategy parameters — call agent_get for that.",
      inputSchema: {},
    },
    async () => handleAgentList(),
  );

  server.registerTool(
    "agent_get",
    {
      description:
        "Fetch and decrypt a single agent, returning its plaintext strategy params.",
      inputSchema: agentGetInputShape,
    },
    async (input) => handleAgentGet(input as Parameters<typeof handleAgentGet>[0]),
  );

  server.registerTool(
    "agent_update",
    {
      description:
        "Update an agent's status (pause/resume) or its encrypted strategy params.",
      inputSchema: agentUpdateInputShape,
    },
    async (input) => handleAgentUpdate(input as Parameters<typeof handleAgentUpdate>[0]),
  );

  server.registerTool(
    "agent_delete",
    {
      description:
        "Soft-delete an agent. Idempotent — re-deleting returns not-found.",
      inputSchema: agentDeleteInputShape,
    },
    async (input) => handleAgentDelete(input as Parameters<typeof handleAgentDelete>[0]),
  );

  server.registerTool(
    "agent_run",
    {
      description:
        "Execute an agent now — bumps lastRunAt and returns the decrypted strategy params so the calling agent runtime can act on them.",
      inputSchema: agentRunInputShape,
    },
    async (input) => handleAgentRun(input as Parameters<typeof handleAgentRun>[0]),
  );

  server.registerTool(
    "wallet_status",
    {
      description:
        "Confirm Veiledhood session is active. Returns the authenticated wallet address and session expiry.",
      inputSchema: {},
    },
    async () => handleWalletStatus(),
  );

  server.registerTool(
    "context_shielded",
    {
      description:
        "Get the user's shielded Veiledhood balances (USDC, ETH, etc. held inside the vault) for a chain, with USD enrichment.",
      inputSchema: contextShieldedInputShape,
    },
    async (input) => handleContextShielded(input as Parameters<typeof handleContextShielded>[0]),
  );

  server.registerTool(
    "context_public",
    {
      description:
        "Get the user's public on-chain balances (native ETH + top ERC-20s) for a chain. Routed through Veiledhood's pooled-RPC proxy so the wallet address is k-anonymous to the RPC provider.",
      inputSchema: contextPublicInputShape,
    },
    async (input) => handleContextPublic(input as Parameters<typeof handleContextPublic>[0]),
  );

  server.registerTool(
    "context_full",
    {
      description:
        "Combined wallet view: shielded Veiledhood balances + public on-chain balances + USD totals. Use this when the user asks 'what's in my wallet' or wants the full portfolio picture.",
      inputSchema: contextFullInputShape,
    },
    async (input) => handleContextFull(input as Parameters<typeof handleContextFull>[0]),
  );

  server.registerTool(
    "data_store",
    {
      description:
        "Store an arbitrary encrypted blob (file, document, JSON, anything) in Veiledhood's encrypted-data vault. Label + payload + timestamp are encrypted together with the user's master key. Server stores ciphertext only. Max 1 MB per blob.",
      inputSchema: dataStoreInputShape,
    },
    async (input) => handleDataStore(input as Parameters<typeof handleDataStore>[0]),
  );

  server.registerTool(
    "data_fetch",
    {
      description:
        "Retrieve and decrypt a stored encrypted-data blob by id. Returns the original label, payload, and savedAt timestamp.",
      inputSchema: dataFetchInputShape,
    },
    async (input) => handleDataFetch(input as Parameters<typeof handleDataFetch>[0]),
  );

  server.registerTool(
    "data_list",
    {
      description:
        "List the user's stored encrypted-data blobs (ids + timestamps). Labels stay encrypted — call data_fetch to decrypt a specific blob.",
      inputSchema: {},
    },
    async () => handleDataList(),
  );

  server.registerTool(
    "data_search",
    {
      description:
        "Find encrypted-data blobs by tag. Tags are encrypted alongside the payload, so this fetches and decrypts every kind=data record locally then filters — O(n) on the user's blob count. Pass `matchAll: false` for OR-match instead of the default AND.",
      inputSchema: dataSearchInputShape,
    },
    async (input) => handleDataSearch(input as Parameters<typeof handleDataSearch>[0]),
  );

  server.registerTool(
    "x402_payer_info",
    {
      description:
        "Get the per-user x402 payer wallet — a Base EOA derived from the user's master.key. Returns the address + chain + RPC. Fund this address with USDC on Base before calling pay_x402. Deterministic: same master.key → same address.",
      inputSchema: {},
    },
    async () => handleX402PayerInfo(),
  );

  server.registerTool(
    "pay_x402",
    {
      description:
        "Call an HTTP endpoint that returns 402 Payment Required (x402 protocol), sign the EIP-3009 USDC authorization from the user's derived payer EOA, and return the unlocked response. USDC settles on Base via the configured facilitator (PayAI). When the server is ShroudFi-aware (e.g. Veiledhood's own /ai/chat), each payment lands at a fresh stealth address. Use x402_payer_info first to learn the funding address.",
      inputSchema: payX402InputShape,
    },
    async (input) => handlePayX402(input as Parameters<typeof handlePayX402>[0]),
  );

  return server;
}

/**
 * Boot the stdio server. Called from `bin/veiledhood-mcp.js` so the process
 * keeps running on the stdio transport. Tests import `buildServer()` only
 * and never call this.
 */
export async function startServer(): Promise<void> {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdio transport keeps the process alive
}
