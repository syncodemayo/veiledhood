import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { ethers } from "hardhat";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  const adminEnv = process.env.VEILEDHOOD_ADMIN?.trim();
  const signerEnv = process.env.VEILEDHOOD_WITHDRAW_SIGNER?.trim();

  const admin =
    adminEnv && ethers.isAddress(adminEnv) && adminEnv !== ethers.ZeroAddress
      ? ethers.getAddress(adminEnv)
      : deployer;
  const withdrawSigner =
    signerEnv && ethers.isAddress(signerEnv) && signerEnv !== ethers.ZeroAddress
      ? ethers.getAddress(signerEnv)
      : deployer;

  console.log("Veiledhood — deploying with parameters:");
  console.log("- Deployer:", deployer);
  console.log("- Admin (VEILEDHOOD_ADMIN or deployer):", admin);
  console.log("- Withdraw signer (VEILEDHOOD_WITHDRAW_SIGNER or deployer):", withdrawSigner);

  const veiledhood = await deploy("Veiledhood", {
    from: deployer,
    args: [admin, withdrawSigner],
    log: true,
  });

  console.log("Veiledhood deployed to:", veiledhood.address);
};

func.tags = ["Veiledhood"];
export default func;
