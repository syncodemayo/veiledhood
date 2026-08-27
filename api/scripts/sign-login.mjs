/**
 * Usage: TEST_WALLET_PK=0x... node scripts/sign-login.mjs "<login message>"
 */
import { ethers } from "ethers";

const msg = process.argv[2];
const pk = process.env.TEST_WALLET_PK;
if (!pk?.trim() || !msg) {
  console.error("Usage: TEST_WALLET_PK=0x... node scripts/sign-login.mjs \"<message>\"");
  process.exit(1);
}

const w = new ethers.Wallet(pk.trim());
process.stdout.write(await w.signMessage(msg));
