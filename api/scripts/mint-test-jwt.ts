/**
 * Mint a JWT for a fake wallet address, signed with the local JWT_SECRET.
 * For local dev smoke ONLY. Do NOT use in prod — bypasses SIWE.
 *
 * Usage:
 *   tsx api/scripts/mint-test-jwt.ts 0x1111111111111111111111111111111111111111
 */
import jwt from "jsonwebtoken";
import { loadEnv } from "../src/config/env.js";

const wallet = (process.argv[2] ?? "0x1111111111111111111111111111111111111111").toLowerCase();
if (!/^0x[a-f0-9]{40}$/.test(wallet)) {
  console.error("argv[2] must be a 0x-prefixed 40-hex address");
  process.exit(1);
}
const env = loadEnv();
const token = jwt.sign(
  { sub: wallet },
  env.JWT_SECRET,
  { expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"] },
);
console.log(token);
