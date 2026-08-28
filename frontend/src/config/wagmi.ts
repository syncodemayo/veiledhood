import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { defineChain } from "viem";
import { http } from "wagmi";

const mainnetRpc = import.meta.env.VITE_MAINNET_RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com";
const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ?? "00000000000000000000000000000000";

export const robinhoodMainnet = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [mainnetRpc] } },
  blockExplorers: { default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" } },
});

export const wagmiConfig = getDefaultConfig({
  appName: "VeiledHood",
  projectId,
  chains: [robinhoodMainnet],
  transports: {
    [robinhoodMainnet.id]: http(mainnetRpc),
  },
  ssr: false,
});
