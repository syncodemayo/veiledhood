import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { ethers } from "hardhat";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  const withdrawSignerEnv = process.env.VEILEDHOOD_ETH_WITHDRAW_SIGNER?.trim();
  const withdrawSigner =
    withdrawSignerEnv &&
    ethers.isAddress(withdrawSignerEnv) &&
    withdrawSignerEnv !== ethers.ZeroAddress
      ? ethers.getAddress(withdrawSignerEnv)
      : deployer;

  console.log("Veiledhood (ETH) — deploying with parameters:");
  console.log("- Deployer / admin:", deployer);
  console.log("- Withdraw signer (VEILEDHOOD_ETH_WITHDRAW_SIGNER or deployer):", withdrawSigner);

  const deployed = await deploy("Veiledhood_ETH", {
    contract: "Veiledhood",
    from: deployer,
    args: [deployer, withdrawSigner],
    log: true,
  });

  console.log("Veiledhood (ETH) deployed to:", deployed.address);
};

func.tags = ["Veiledhood_ETH"];
export default func;
