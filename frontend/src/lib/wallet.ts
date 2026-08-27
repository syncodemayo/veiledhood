import { BrowserProvider } from "ethers";
import { EthereumProvider } from "@walletconnect/ethereum-provider";

export const ROBINHOOD_TESTNET_CHAIN_ID = 46630;
export const ROBINHOOD_TESTNET_CHAIN_ID_HEX = "0x" + ROBINHOOD_TESTNET_CHAIN_ID.toString(16);
export const ROBINHOOD_TESTNET_RPC = import.meta.env.VITE_RPC_URL ?? "https://rpc.testnet.chain.robinhood.com/rpc";
export const ROBINHOOD_TESTNET_EXPLORER = "https://explorer.testnet.chain.robinhood.com";

export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  isMetaMask?: boolean;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
}

export function getInjectedProvider(): Eip1193Provider | null {
  const w = window as unknown as { ethereum?: Eip1193Provider };
  return w.ethereum ?? null;
}

async function addRobinhoodTestnet(raw: Eip1193Provider): Promise<void> {
  await raw.request({
    method: "wallet_addEthereumChain",
    params: [
      {
        chainId: ROBINHOOD_TESTNET_CHAIN_ID_HEX,
        chainName: "Robinhood Chain Testnet",
        nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
        rpcUrls: [ROBINHOOD_TESTNET_RPC],
        blockExplorerUrls: [ROBINHOOD_TESTNET_EXPLORER],
      },
    ],
  });
}

export async function ensureRobinhoodTestnet(raw: Eip1193Provider): Promise<void> {
  try {
    await raw.request({ method: "wallet_switchEthereumChain", params: [{ chainId: ROBINHOOD_TESTNET_CHAIN_ID_HEX }] });
  } catch (switchErr) {
    // Wallets signal "chain not added yet" inconsistently — MetaMask uses code 4902,
    // others return a differently-shaped error or just a message. Try adding the
    // chain on ANY switch failure rather than pattern-matching a specific error code.
    try {
      await addRobinhoodTestnet(raw);
    } catch {
      throw switchErr;
    }
  }
}

async function connectInjected(): Promise<{ address: string; provider: BrowserProvider; raw: Eip1193Provider }> {
  const injected = getInjectedProvider();
  if (!injected) throw new Error("No injected wallet found. Install MetaMask or a compatible wallet.");
  await injected.request({ method: "eth_requestAccounts" });
  await ensureRobinhoodTestnet(injected);
  const provider = new BrowserProvider(injected as never);
  const signer = await provider.getSigner();
  const address = await signer.getAddress();
  return { address: address.toLowerCase(), provider, raw: injected };
}

let wcProvider: Awaited<ReturnType<typeof EthereumProvider.init>> | null = null;

async function getWcProvider() {
  if (wcProvider) return wcProvider;
  const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID;
  if (!projectId) throw new Error("WalletConnect isn't configured (missing VITE_WALLETCONNECT_PROJECT_ID).");
  wcProvider = await EthereumProvider.init({
    projectId,
    chains: [ROBINHOOD_TESTNET_CHAIN_ID],
    rpcMap: { [ROBINHOOD_TESTNET_CHAIN_ID]: ROBINHOOD_TESTNET_RPC },
    showQrModal: true,
    metadata: {
      name: "VeiledHood",
      description: "Privacy protocol on Robinhood Chain",
      url: window.location.origin,
      icons: [],
    },
  });
  return wcProvider;
}

async function connectViaWalletConnect(): Promise<{ address: string; provider: BrowserProvider; raw: Eip1193Provider }> {
  const wc = await getWcProvider();
  await wc.connect();
  const provider = new BrowserProvider(wc as never);
  const signer = await provider.getSigner();
  const address = await signer.getAddress();
  return { address: address.toLowerCase(), provider, raw: wc as unknown as Eip1193Provider };
}

export type WalletKind = "injected" | "walletconnect";

export async function connectWallet(kind: WalletKind = "injected"): Promise<{ address: string; provider: BrowserProvider; raw: Eip1193Provider }> {
  return kind === "walletconnect" ? connectViaWalletConnect() : connectInjected();
}

export async function disconnectWalletConnect(): Promise<void> {
  if (wcProvider) {
    await wcProvider.disconnect().catch(() => {});
    wcProvider = null;
  }
}

export async function signMessage(provider: BrowserProvider, message: string): Promise<string> {
  const signer = await provider.getSigner();
  return signer.signMessage(message);
}
