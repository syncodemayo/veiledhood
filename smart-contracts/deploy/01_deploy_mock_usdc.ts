import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { ethers } from "hardhat";

/**
 * Standalone MockUSDC deploy (6 decimals, full supply minted to deployer).
 * Optional helper for local Hardhat / testnets.
 *
 * Env: MOCK_USDC_INITIAL_SUPPLY — raw 6-decimal units (default 1_000_000e6).
 */
const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts } = hre;
    const { deploy } = deployments;
    const { deployer } = await getNamedAccounts();

    const mockUsdcInitialSupply = process.env.MOCK_USDC_INITIAL_SUPPLY
        ? BigInt(process.env.MOCK_USDC_INITIAL_SUPPLY)
        : ethers.parseUnits("1000000", 6);

    console.log("Veiledhood — deploying MockUSDC:");
    console.log("- Deployer:", deployer);
    console.log("- Initial supply (raw 6-dec units):", mockUsdcInitialSupply.toString());

    const mockUsdc = await deploy("MockUSDC", {
        from: deployer,
        args: [mockUsdcInitialSupply],
        log: true,
    });

    console.log("MockUSDC deployed to:", mockUsdc.address);
};

func.tags = ["MockUSDC"];
export default func;
