import { HardhatUserConfig } from "hardhat/config";
import path from "node:path";
import "@nomicfoundation/hardhat-toolbox";
import "hardhat-deploy";
import "hardhat-contract-sizer"
require('@openzeppelin/hardhat-upgrades');
require("dotenv").config({ path: path.join(__dirname, "../.env") });
require("dotenv").config();

const PRIVATE_KEY = process.env.PRIVATE_KEY;
const RPC_URL = process.env.RPC_URL;
/** Blockscout verification API key for Robinhood Chain Testnet (often accepts any non-empty value). */
const VERIFICATION_API_KEY = process.env.VERIFICATION_API_KEY;

const hasLiveRpc = Boolean(PRIVATE_KEY && RPC_URL);
const hasVerification = Boolean(VERIFICATION_API_KEY);

/**
 * Fork mode — set FORK=1 in .env (or shell) together with RPC_URL pointing at Robinhood Chain Testnet.
 * Affects only the default `hardhat` network; regular `npx hardhat test` is unaffected when FORK
 * is not set.
 */
const forkEnabled = process.env.FORK === "1" && Boolean(RPC_URL);

if (!hasLiveRpc) {
  console.warn(
    "Hardhat config: PRIVATE_KEY/RPC_URL not set; live network (robinhoodMainnet) disabled. Local tests still run."
  );
}
if (!hasVerification) {
  console.warn(
    "Hardhat config: VERIFICATION_API_KEY not set; hardhat-verify on robinhoodTestnet disabled."
  );
}

const config: HardhatUserConfig = {
  defaultNetwork: 'hardhat',
  solidity: {
    version: "0.8.25",
    settings: {
      evmVersion: "cancun",
      optimizer: {
        enabled: true,
        runs: 1
      },
      viaIR: true
    }
  },
  networks: {
    hardhat: {
      deploy: [],
      ...(forkEnabled ? { forking: { url: RPC_URL as string } } : {}),
    },
    ...(hasLiveRpc
      ? {
          robinhoodMainnet: {
            url: RPC_URL,
            accounts: [PRIVATE_KEY as `0x${string}`],
            chainId: 4663,
          },
        }
      : {}),
  },
  namedAccounts: {
    deployer: {
      default: 0,
    },
  },
  paths: {
    deployments: "deployments",
  },
  ...(hasVerification
    ? {
        etherscan: {
          apiKey: VERIFICATION_API_KEY,
          customChains: [
            {
              network: "robinhoodMainnet",
              chainId: 4663,
              urls: {
                apiURL: "https://robinhoodchain.blockscout.com/api",
                browserURL: "https://robinhoodchain.blockscout.com",
              },
            },
          ],
        },
      }
    : {}),
  sourcify: {
    enabled: true
  },
  gasReporter: {
    enabled: true,
    currency: 'USD',
    gasPrice: 0.095,
    token: 'ETH',
    tokenPrice: '2000',
    showMethodSig: true,
    excludeContracts: [],
    outputFile: "gas-report.txt",
    noColors: true,
  },
} as HardhatUserConfig;

export default config;
