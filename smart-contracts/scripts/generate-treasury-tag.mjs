/**
 * Generate a deterministic bytes32 treasury tag from a label.
 *
 * Usage:
 *   node scripts/generate-treasury-tag.mjs "veiledhood-treasury-eth-main"
 */
import { keccak256, toUtf8Bytes } from "ethers";

const label = process.argv[2]?.trim();

if (!label) {
  console.error('Missing label. Usage: node scripts/generate-treasury-tag.mjs "your-label"');
  process.exit(1);
}

const treasuryTag = keccak256(toUtf8Bytes(label));

console.log(`Label:        ${label}`);
console.log(`Treasury tag: ${treasuryTag}`);
console.log(`\nSet in .env as:`);
console.log(`VEILEDHOOD_ETH_TREASURY_TAG=${treasuryTag}`);
