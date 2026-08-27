/**
 * Writes exports/<network>.json from hardhat-deploy artifacts:
 * { network, chainId, contracts: { ContractName: { address, abi } } }
 *
 * Usage: node scripts/export-deployments.mjs [network]
 * Default network: sepolia
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const network = process.argv[2] || "sepolia";
const depDir = path.join(root, "deployments", network);

if (!fs.existsSync(depDir)) {
  console.error(`export-deployments: missing ${depDir}`);
  process.exit(1);
}

let chainId = null;
const chainIdPath = path.join(depDir, ".chainId");
if (fs.existsSync(chainIdPath)) {
  chainId = fs.readFileSync(chainIdPath, "utf8").trim();
}

const contracts = {};
for (const f of fs.readdirSync(depDir)) {
  if (!f.endsWith(".json")) continue;
  const full = path.join(depDir, f);
  if (!fs.statSync(full).isFile()) continue;
  let j;
  try {
    j = JSON.parse(fs.readFileSync(full, "utf8"));
  } catch {
    continue;
  }
  if (typeof j.address === "string" && Array.isArray(j.abi)) {
    const name = path.basename(f, ".json");
    contracts[name] = { address: j.address, abi: j.abi };
  }
}

const outDir = path.join(root, "exports");
fs.mkdirSync(outDir, { recursive: true });
const payload = { network, chainId, contracts };
const outFile = path.join(outDir, `${network}.json`);
fs.writeFileSync(outFile, JSON.stringify(payload, null, 2) + "\n");
console.log(
  `Wrote ${path.relative(root, outFile)} (${Object.keys(contracts).length} contract(s))`
);
