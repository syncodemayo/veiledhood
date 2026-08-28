import {
  createPublicClient,
  defineChain,
  http,
  type PublicClient,
  type Transport,
  type Chain,
  getAddress,
  isAddressEqual,
} from "viem";
import type { Env } from "../config/env.js";
import type { TokenListEntry } from "../util/tokenLists.js";
import { getTokenList } from "../util/tokenLists.js";

/**
 * pooledRpcProxy — Phase 3 wallet-context privacy layer.
 *
 * Why this exists: every public-chain balance check leaks the holder's address
 * to the RPC provider. With N users routed through a single Veiledhood-owned key,
 * the provider sees a cohort of Veiledhood activity — not which user asked what.
 *
 * Privacy invariants enforced here:
 *   1. ERC-20 balance reads go via Multicall3 with `from = 0x0...0`. The user's
 *      address never appears as the `from` field on the outgoing `eth_call`.
 *   2. Cross-user batching — all queries in a 100ms window are coalesced into
 *      one multicall mixing real + decoy reads. Provider can't separate users
 *      by call boundary.
 *   3. Decoys — ~10% of every batch are queries against unrelated well-known
 *      addresses, statistically diluting the user cohort.
 *   4. Jitter — 0–50ms random delay per dispatch so query timing can't be
 *      correlated to on-chain tx timing.
 *   5. Logs never contain a holder address in cleartext. Only metadata
 *      (chain id, queue depth, dispatch latency) is structured-logged.
 *
 * NOT a privacy guarantee: `getNativeBalance` calls `eth_getBalance(address)`
 * which inherently includes the holder address as the call argument. The
 * pooled-key cohort property still applies (provider sees Veiledhood not the
 * end user), but there is no `from = 0x0` trick available for this RPC method.
 */

const MULTICALL3_ADDRESS = "0xca11bde05977b3631167028862be2a173976ca11" as const;

const ERC20_BALANCE_OF_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "balance", type: "uint256" }],
  },
] as const;

/**
 * Decoy address pool — well-known, high-activity addresses unrelated to
 * Veiledhood users. Used to dilute the per-user cohort during multicall
 * dispatch. Rotate periodically (semantic ownership: anyone with on-chain
 * presence whose extra balance reads don't risk re-identification).
 */
const DECOY_ADDRESSES: ReadonlyArray<string> = [
  "0xd8da6bf26964af9d7eed9e03e53415d37aa96045", // vitalik.eth
  "0x28c6c06298d514db089934071355e5743bf21d60", // binance hot wallet
  "0x21a31ee1afc51d94c2efccaa2092ad1028285549", // binance hot wallet 2
  "0xdfd5293d8e347dfe59e90efd55b2956a1343963d", // binance hot wallet 3
  "0x47ac0fb4f2d84898e4d9e7b4dab3c24507a6d503", // binance hot wallet 4
  "0x40ec5b33f54e0e8a33a975908c5ba1c14e5bbbdf", // polygon team
  "0x53d284357ec70ce289d6d64134dfac8e511c8a3d", // kraken
  "0x267be1c1d684f78cb4f6a176c4911b741e4ffdc0", // kraken 2
  "0xa910f92acdaf488fa6ef02174fb86208ad7722ba", // poloniex
  "0xb8c77482e45f1f44de1745f52c74426c631bdd52", // bnb deployer
];

export interface TokenBalance {
  /** Lowercase 0x-prefixed token address. `native` for the chain's gas token. */
  readonly address: string;
  /** Token symbol (uppercase). */
  readonly symbol: string;
  /** Decimals as defined by the token. */
  readonly decimals: number;
  /** Raw balance as a base-10 string (avoid bigint in JSON payloads). */
  readonly balance: string;
}

export interface PooledRpcProxy {
  getBalances(chainId: number, holder: string, tokens?: ReadonlyArray<TokenListEntry>): Promise<TokenBalance[]>;
  getNativeBalance(chainId: number, holder: string): Promise<TokenBalance>;
  health(): Promise<{ ok: boolean; chains: Record<number, ChainHealth> }>;
  /** Test-only — exposes internal state for unit tests. Do not use in routes. */
  __internal?: InternalHooks;
}

interface ChainHealth {
  readonly provider: "primary" | "fallback" | "down";
  readonly errorCountInWindow: number;
}

interface InternalHooks {
  flushQueue(chainId: number): Promise<void>;
  getDecoyPool(): ReadonlyArray<string>;
  getQueueDepth(chainId: number): number;
}

interface QueueEntry {
  readonly holder: string;
  readonly tokens: ReadonlyArray<TokenListEntry>;
  readonly resolve: (balances: TokenBalance[]) => void;
  readonly reject: (err: Error) => void;
  readonly enqueuedAt: number;
}

interface ChainState {
  readonly chainId: number;
  readonly chain: Chain;
  /** Primary client (built from RPC_URL / ETH_RPC_URL). */
  readonly primary: PublicClient<Transport, Chain>;
  /** Fallback client (built from *_FALLBACK env vars). Undefined if no fallback configured. */
  readonly fallback?: PublicClient<Transport, Chain>;
  queue: QueueEntry[];
  timer?: NodeJS.Timeout;
  errorTimestamps: number[];
  using: "primary" | "fallback" | "down";
}

function lowercaseAddress(addr: string): string {
  // getAddress validates checksum; we then lower-case for storage
  return getAddress(addr).toLowerCase();
}

function isEvmAddress(addr: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(addr);
}

function pickRandomDecoy(): string {
  return DECOY_ADDRESSES[Math.floor(Math.random() * DECOY_ADDRESSES.length)]!;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function buildClient(chain: Chain, rpcUrl: string): PublicClient<Transport, Chain> {
  return createPublicClient({ chain, transport: http(rpcUrl, { batch: true }) }) as PublicClient<
    Transport,
    Chain
  >;
}

export const robinhoodTestnet: Chain = defineChain({
  id: 46630,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.chain.robinhood.com/rpc"] } },
  blockExplorers: { default: { name: "Blockscout", url: "https://explorer.testnet.chain.robinhood.com" } },
});

export const robinhoodMainnet: Chain = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
  blockExplorers: { default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" } },
});

function resolveChain(chainId: number): Chain | undefined {
  if (chainId === robinhoodTestnet.id) return robinhoodTestnet;
  if (chainId === robinhoodMainnet.id) return robinhoodMainnet;
  return undefined;
}

/**
 * Production callers pass `env`; tests pass `opts.buildClient` to substitute
 * a fake client. The factory matches the production signature so swapping
 * is invisible to internal code.
 */
export interface CreatePooledRpcProxyOptions {
  readonly buildClient?: (chain: Chain, rpcUrl: string) => PublicClient<Transport, Chain>;
}

export function createPooledRpcProxy(
  env: Env,
  opts: CreatePooledRpcProxyOptions = {},
): PooledRpcProxy {
  const builder = opts.buildClient ?? buildClient;
  const chains = new Map<number, ChainState>();

  // Primary chain (Robinhood Chain Testnet — RPC_URL / BASE_CHAIN_ID)
  if (env.RPC_URL) {
    const chainId = env.BASE_CHAIN_ID ?? robinhoodTestnet.id;
    const chain = resolveChain(chainId) ?? robinhoodTestnet;
    const primaryState: ChainState = {
      chainId,
      chain,
      primary: builder(chain, env.RPC_URL),
      fallback: env.BASE_RPC_URL_FALLBACK ? builder(chain, env.BASE_RPC_URL_FALLBACK) : undefined,
      queue: [],
      errorTimestamps: [],
      using: "primary",
    };
    chains.set(chainId, primaryState);
  }

  function currentClient(state: ChainState): PublicClient<Transport, Chain> {
    if (state.using === "fallback" && state.fallback) return state.fallback;
    return state.primary;
  }

  function recordError(state: ChainState): void {
    const now = Date.now();
    state.errorTimestamps.push(now);
    // Prune entries outside the window
    const cutoff = now - env.RPC_POOL_FAILOVER_WINDOW_S * 1000;
    state.errorTimestamps = state.errorTimestamps.filter((t) => t >= cutoff);
    if (state.errorTimestamps.length >= env.RPC_POOL_FAILOVER_ERROR_THRESHOLD) {
      if (state.using === "primary" && state.fallback) {
        state.using = "fallback";
        console.warn(`[veiledhood-context] chain ${state.chainId}: failing over to fallback RPC`);
      } else if (state.using === "primary") {
        state.using = "down";
        console.warn(`[veiledhood-context] chain ${state.chainId}: primary RPC down, no fallback`);
      } else if (state.using === "fallback") {
        state.using = "down";
        console.warn(`[veiledhood-context] chain ${state.chainId}: fallback RPC also down`);
      }
    }
  }

  function recordSuccess(state: ChainState): void {
    state.errorTimestamps = [];
    if (state.using === "fallback") {
      // Stay on fallback — we'll let a manual reset bring us back to primary
      // to avoid flapping. Operators can restart the API process for a hard reset.
    }
  }

  /**
   * Dispatch a drained queue + injected decoys via a single multicall.
   * `from` is intentionally not set — viem defaults to undefined which
   * translates to `0x0...0` in eth_call, satisfying privacy invariant #1.
   */
  async function dispatchQueue(state: ChainState): Promise<void> {
    if (state.queue.length === 0) return;

    // Drain
    const batch = state.queue.splice(0, state.queue.length);
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = undefined;
    }

    // Build the canonical contract list per entry
    interface RealCall {
      kind: "real";
      entryIdx: number;
      tokenIdx: number;
    }
    interface DecoyCall {
      kind: "decoy";
    }
    type CallTag = RealCall | DecoyCall;

    const contracts: Array<{
      address: `0x${string}`;
      abi: typeof ERC20_BALANCE_OF_ABI;
      functionName: "balanceOf";
      args: readonly [`0x${string}`];
    }> = [];
    const tags: CallTag[] = [];

    for (let entryIdx = 0; entryIdx < batch.length; entryIdx++) {
      const entry = batch[entryIdx]!;
      for (let tokenIdx = 0; tokenIdx < entry.tokens.length; tokenIdx++) {
        const t = entry.tokens[tokenIdx]!;
        contracts.push({
          address: t.address as `0x${string}`,
          abi: ERC20_BALANCE_OF_ABI,
          functionName: "balanceOf",
          args: [entry.holder as `0x${string}`],
        });
        tags.push({ kind: "real", entryIdx, tokenIdx });
      }
    }

    // Inject decoys at the RATIO rate. We size the decoy set relative to
    // the number of real calls so each batch has comparable dilution
    // regardless of how many users are in it.
    const realCallCount = contracts.length;
    const decoyTarget = Math.floor(realCallCount * env.RPC_POOL_DECOY_RATIO);
    for (let i = 0; i < decoyTarget; i++) {
      // Pick a random token from any chain that this proxy supports — keeping
      // the same chain id matches the dispatched multicall.
      const tokenList = getTokenList(state.chainId);
      if (tokenList.length === 0) break;
      const decoyToken = tokenList[Math.floor(Math.random() * tokenList.length)]!;
      contracts.push({
        address: decoyToken.address as `0x${string}`,
        abi: ERC20_BALANCE_OF_ABI,
        functionName: "balanceOf",
        args: [pickRandomDecoy() as `0x${string}`],
      });
      tags.push({ kind: "decoy" });
    }

    // Jitter — apply before dispatch so timing can't be correlated
    if (env.RPC_POOL_JITTER_MAX_MS > 0) {
      await sleep(Math.random() * env.RPC_POOL_JITTER_MAX_MS);
    }

    const client = currentClient(state);

    try {
      // viem's multicall does NOT include `from` in the underlying eth_call.
      // We pass multicallAddress explicitly to guard against viem default
      // changes between versions.
      const results = await client.multicall({
        contracts,
        multicallAddress: MULTICALL3_ADDRESS,
        allowFailure: true,
      });

      recordSuccess(state);

      // Distribute real results back to their queue entries
      const perEntry: Map<number, Map<number, bigint | null>> = new Map();
      for (let i = 0; i < tags.length; i++) {
        const tag = tags[i]!;
        if (tag.kind !== "real") continue; // discard decoy results
        const r = results[i]!;
        if (!perEntry.has(tag.entryIdx)) perEntry.set(tag.entryIdx, new Map());
        const value = r.status === "success" ? (r.result as bigint) : null;
        perEntry.get(tag.entryIdx)!.set(tag.tokenIdx, value);
      }

      for (let entryIdx = 0; entryIdx < batch.length; entryIdx++) {
        const entry = batch[entryIdx]!;
        const tokenResults = perEntry.get(entryIdx);
        const balances: TokenBalance[] = entry.tokens.map((t, tokenIdx) => {
          const raw = tokenResults?.get(tokenIdx) ?? null;
          return {
            address: t.address,
            symbol: t.symbol,
            decimals: t.decimals,
            balance: raw !== null ? raw.toString() : "0",
          };
        });
        entry.resolve(balances);
      }
    } catch (err) {
      recordError(state);
      const errInstance = err instanceof Error ? err : new Error("multicall dispatch failed");
      for (const entry of batch) {
        entry.reject(errInstance);
      }
    }
  }

  function scheduleDispatch(state: ChainState): void {
    if (state.timer) return;
    state.timer = setTimeout(() => {
      void dispatchQueue(state).catch((e) => {
        console.warn(`[veiledhood-context] dispatchQueue failed for chain ${state.chainId}:`, e);
      });
    }, env.RPC_POOL_BATCH_WINDOW_MS);
  }

  async function getBalances(
    chainId: number,
    holder: string,
    tokens?: ReadonlyArray<TokenListEntry>,
  ): Promise<TokenBalance[]> {
    if (!isEvmAddress(holder)) {
      throw new Error("Invalid holder address");
    }
    const state = chains.get(chainId);
    if (!state) {
      throw new Error(`Unsupported chain: ${chainId}`);
    }
    if (state.using === "down" && !state.fallback) {
      throw new Error(`RPC down for chain ${chainId}`);
    }

    const resolvedTokens = tokens ?? getTokenList(chainId);
    if (resolvedTokens.length === 0) return [];

    const normalizedHolder = lowercaseAddress(holder);

    return new Promise<TokenBalance[]>((resolve, reject) => {
      state.queue.push({
        holder: normalizedHolder,
        tokens: resolvedTokens,
        resolve,
        reject,
        enqueuedAt: Date.now(),
      });
      scheduleDispatch(state);
    });
  }

  async function getNativeBalance(chainId: number, holder: string): Promise<TokenBalance> {
    if (!isEvmAddress(holder)) {
      throw new Error("Invalid holder address");
    }
    const state = chains.get(chainId);
    if (!state) {
      throw new Error(`Unsupported chain: ${chainId}`);
    }

    if (env.RPC_POOL_JITTER_MAX_MS > 0) {
      await sleep(Math.random() * env.RPC_POOL_JITTER_MAX_MS);
    }

    const client = currentClient(state);
    try {
      const wei = await client.getBalance({ address: lowercaseAddress(holder) as `0x${string}` });
      recordSuccess(state);
      return {
        address: "native",
        symbol: "ETH",
        decimals: 18,
        balance: wei.toString(),
      };
    } catch (err) {
      recordError(state);
      throw err instanceof Error ? err : new Error("getBalance failed");
    }
  }

  async function health(): Promise<{ ok: boolean; chains: Record<number, ChainHealth> }> {
    const chainHealth: Record<number, ChainHealth> = {};
    let ok = true;
    for (const [chainId, state] of chains) {
      chainHealth[chainId] = {
        provider: state.using,
        errorCountInWindow: state.errorTimestamps.length,
      };
      if (state.using === "down") ok = false;
    }
    return { ok, chains: chainHealth };
  }

  const proxy: PooledRpcProxy = {
    getBalances,
    getNativeBalance,
    health,
    __internal: {
      flushQueue: async (chainId: number) => {
        const s = chains.get(chainId);
        if (s) await dispatchQueue(s);
      },
      getDecoyPool: () => DECOY_ADDRESSES,
      getQueueDepth: (chainId: number) => chains.get(chainId)?.queue.length ?? 0,
    },
  };

  return proxy;
}

// Re-exports used by tests / route layer
export { MULTICALL3_ADDRESS, DECOY_ADDRESSES, ERC20_BALANCE_OF_ABI };
// isAddressEqual is re-exported because future hardening (decoy uniqueness etc.) may need it
export { isAddressEqual };
