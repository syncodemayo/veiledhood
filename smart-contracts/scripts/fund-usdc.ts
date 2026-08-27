import { ethers } from "hardhat";

async function main() {
  const to = process.env.TO;
  if (!to) throw new Error("Set TO=<address> env var");
  const usdc = await ethers.getContractAt("MockUSDC", process.env.USDC_ADDRESS!);
  const amount = ethers.parseUnits("1000", 6);
  const tx = await usdc.transfer(to, amount);
  const receipt = await tx.wait();
  console.log(`Transferred 1000 USDC to ${to} — tx ${receipt?.hash}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
