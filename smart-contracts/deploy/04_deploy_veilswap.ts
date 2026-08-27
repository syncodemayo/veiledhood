import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { ethers } from "hardhat";

const POOL_MANAGER_BASE = "0x498581ff718922c3f8e6a244956af099b2652b2b";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  const adminEnv       = process.env.VEILSWAP_ADMIN?.trim();
  const signerEnv      = process.env.VEILSWAP_WITHDRAW_SIGNER?.trim();
  const poolManagerEnv = process.env.VEILSWAP_POOL_MANAGER?.trim();

  const admin          = adminEnv && ethers.isAddress(adminEnv) ? ethers.getAddress(adminEnv) : deployer;
  const withdrawSigner = signerEnv && ethers.isAddress(signerEnv) ? ethers.getAddress(signerEnv) : deployer;
  const poolManager    = poolManagerEnv && ethers.isAddress(poolManagerEnv)
    ? ethers.getAddress(poolManagerEnv)
    : POOL_MANAGER_BASE;

  console.log("VeilSwap — deploying with parameters:");
  console.log("- Deployer:", deployer);
  console.log("- Admin (VEILSWAP_ADMIN or deployer):", admin);
  console.log("- Withdraw signer (VEILSWAP_WITHDRAW_SIGNER or deployer):", withdrawSigner);
  console.log("- PoolManager (VEILSWAP_POOL_MANAGER or Base default):", poolManager);

  const result = await deploy("VeilSwap", {
    from: deployer,
    args: [admin, withdrawSigner, poolManager],
    log: true,
  });

  console.log("VeilSwap deployed to:", result.address);
};

func.tags = ["VeilSwap"];
export default func;
