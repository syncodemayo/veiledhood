import { ethers } from "hardhat";

export function getEthersProvider(networkName: string) {
    let providerURL;
    if (networkName == 'localhost') {
        providerURL = 'http://127.0.0.1:8545/';
    } else {
        providerURL = process.env.RPC_URL;
    }

    if (!providerURL) {
        throw new Error("Provider URL not found for network: " + networkName);
    }

    const provider = new ethers.JsonRpcProvider(providerURL);
    return provider
}