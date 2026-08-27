import { ethers } from "ethers";

const ERRORS = [
  "OnlyAdmin()",
  "NotSelf()",
  "ZeroAddress()",
  "ZeroAmount()",
  "MsgValueMismatch()",
  "InvalidMerkleProof()",
  "NullifierAlreadyUsed()",
  "WithdrawExpired()",
  "InvalidSignature()",
  "InsufficientReserves()",
  "ETHTransferFailed()",
  "NoSurplus()",
  "InvalidPath()",
];

const target = (process.argv[2] ?? "0xb05e92fa").toLowerCase();
console.log(`Looking up selector ${target}\n`);

for (const sig of ERRORS) {
  const sel = ethers.id(sig).slice(0, 10).toLowerCase();
  const hit = sel === target ? "  ← MATCH" : "";
  console.log(`${sel}  ${sig}${hit}`);
}
