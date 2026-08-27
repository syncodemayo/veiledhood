import { FetchRequest, JsonRpcProvider } from "ethers";

/** Per-request socket timeout for slow or distant RPCs (ethers default is large; explicit avoids edge cases). */
const RPC_TIMEOUT_MS = 120_000;

/**
 * JsonRpcProvider with a bounded HTTP timeout. When `staticChainId` is set (e.g. from `CHAIN_ID`),
 * skips repeated `eth_chainId` network detection — fewer RPC round-trips and fewer timeouts under load.
 */
export function createJsonRpcProvider(
  rpcUrl: string,
  staticChainId?: number
): JsonRpcProvider {
  const req = new FetchRequest(rpcUrl);
  req.timeout = RPC_TIMEOUT_MS;
  if (staticChainId != null) {
    return new JsonRpcProvider(req, staticChainId, { staticNetwork: true });
  }
  return new JsonRpcProvider(req);
}
