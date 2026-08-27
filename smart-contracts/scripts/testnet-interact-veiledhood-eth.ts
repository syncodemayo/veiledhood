import hre, { ethers } from "hardhat";
import type { VeiledhoodETHVault } from "../typechain-types/contracts/VeiledhoodETHVault";

type TxResponseLike = {
  hash: string;
  wait: () => Promise<{ status: number | null }>;
};

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing ${name} in environment.`);
  }
  return value;
}

function ownerCommit(owner: string, secret: string): string {
  return ethers.keccak256(
    ethers.solidityPacked(["address", "bytes32"], [owner, secret])
  );
}

async function sendTx(label: string, txPromise: Promise<TxResponseLike>): Promise<void> {
  const tx = await txPromise;
  console.log(`${label} tx hash: ${tx.hash}`);
  const receipt = await tx.wait();
  if (receipt.status !== 1) {
    throw new Error(`${label} failed: ${tx.hash}`);
  }
}

async function isTagRegistered(vault: VeiledhoodETHVault, tag: string): Promise<boolean> {
  try {
    await vault.encryptedBalanceOfTag(tag);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  await hre.fhevm.initializeCLIApi();

  const vaultAddress = requireEnv("VEILEDHOOD_ETH_VAULT_ADDRESS");
  const recipientAddressEnv =
    process.env.VEILEDHOOD_ETH_TEST_RECIPIENT?.trim() ?? process.env.TRANSFER_TO_ADDRESS?.trim();

  if (!recipientAddressEnv || !ethers.isAddress(recipientAddressEnv)) {
    throw new Error(
      "Set VEILEDHOOD_ETH_TEST_RECIPIENT (or TRANSFER_TO_ADDRESS) to a valid recipient address."
    );
  }

  const [signer] = await ethers.getSigners();
  const recipientAddress = ethers.getAddress(recipientAddressEnv);
  const vault = (await ethers.getContractAt(
    "VeiledhoodETHVault",
    vaultAddress,
    signer
  )) as VeiledhoodETHVault;

  const withdrawVerifier = await vault.withdrawVerifier();
  const transferFeeBps = await vault.transferFeeBps();
  const transferFeeFixed = await vault.transferFeeFixed();
  const treasuryTag = await vault.treasuryTag();
  if (withdrawVerifier.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error(
      `Signer ${signer.address} is not withdrawVerifier ${withdrawVerifier}. ` +
        "Use the verifier key as PRIVATE_KEY for this script."
    );
  }

  const nowLabel = Date.now().toString();
  const ownerTag = ethers.keccak256(ethers.toUtf8Bytes(`script-owner-${nowLabel}`));
  const recipientTag = ethers.keccak256(ethers.toUtf8Bytes(`script-recipient-${nowLabel}`));
  const ownerSecret = ethers.keccak256(ethers.toUtf8Bytes(`owner-secret-${nowLabel}`));
  const recipientSecret = ethers.keccak256(ethers.toUtf8Bytes(`recipient-secret-${nowLabel}`));
  const treasurySecret = ethers.keccak256(ethers.toUtf8Bytes("script-treasury-secret"));

  console.log(`Contract: ${vaultAddress}`);
  console.log(`Signer (owner): ${signer.address}`);
  console.log(`Recipient: ${recipientAddress}`);
  console.log(`Owner tag: ${ownerTag}`);
  console.log(`Recipient tag: ${recipientTag}`);

  // register owner tag
  {
    const input = hre.fhevm.createEncryptedInput(vaultAddress, signer.address);
    input.addAddress(signer.address);
    const enc = await input.encrypt();
    await sendTx(
      "register owner tag",
      vault.registerTag(
        ownerTag,
        enc.handles[0] as `0x${string}`,
        enc.inputProof,
        ownerCommit(signer.address, ownerSecret)
      ) as unknown as Promise<TxResponseLike>
    );
  }

  // register recipient tag
  {
    const input = hre.fhevm.createEncryptedInput(vaultAddress, signer.address);
    input.addAddress(recipientAddress);
    const enc = await input.encrypt();
    await sendTx(
      "register recipient tag",
      vault.registerTag(
        recipientTag,
        enc.handles[0] as `0x${string}`,
        enc.inputProof,
        ownerCommit(recipientAddress, recipientSecret)
      ) as unknown as Promise<TxResponseLike>
    );
  }

  // if transfer fees are enabled, treasury tag must be registered for transfers to work
  if (transferFeeBps > 0 || transferFeeFixed > 0n) {
    const treasuryRegistered = await isTagRegistered(vault, treasuryTag);
    if (!treasuryRegistered) {
      const input = hre.fhevm.createEncryptedInput(vaultAddress, signer.address);
      input.addAddress(signer.address);
      const enc = await input.encrypt();
      await sendTx(
        "register treasury tag",
        vault.registerTag(
          treasuryTag,
          enc.handles[0] as `0x${string}`,
          enc.inputProof,
          ownerCommit(signer.address, treasurySecret)
        ) as unknown as Promise<TxResponseLike>
      );
    } else {
      console.log("register treasury tag skipped: already registered");
    }
  }

  const depositAmount = ethers.parseEther("0.00001");
  const transferAmount = depositAmount / 2n;
  const withdrawAmount = depositAmount - transferAmount;

  await sendTx(
    "deposit 0.00001 ETH",
    vault.depositToTag(depositAmount, ownerTag, { value: depositAmount }) as unknown as Promise<TxResponseLike>
  );

  {
    const input = hre.fhevm.createEncryptedInput(vaultAddress, signer.address);
    input.add128(transferAmount);
    const enc = await input.encrypt();
    await sendTx(
      "transfer half to recipient tag",
      vault.transferEncryptedToTag(
        ownerTag,
        recipientTag,
        enc.handles[0] as `0x${string}`,
        enc.inputProof,
        ownerSecret
      ) as unknown as Promise<TxResponseLike>
    );
  }

  const chainId = (await ethers.provider.getNetwork()).chainId;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const domain = {
    name: "VeiledhoodETHVault",
    version: "1",
    chainId,
    verifyingContract: vaultAddress,
  };
  const types = {
    WithdrawAuth: [
      { name: "amount", type: "uint128" },
      { name: "tag", type: "bytes32" },
      { name: "owner", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
  };
  const value = {
    amount: withdrawAmount,
    tag: ownerTag,
    owner: signer.address,
    deadline,
  };
  const signature = await signer.signTypedData(domain, types, value);

  await sendTx(
    "withdraw remaining half",
    vault.withdrawFromTag(
      withdrawAmount,
      ownerTag,
      ownerSecret,
      deadline,
      signature
    ) as unknown as Promise<TxResponseLike>
  );

  console.log("Done.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
