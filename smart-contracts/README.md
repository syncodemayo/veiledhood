# Veiledhood

Veiledhood `smart-contracts/` contains **`Veiledhood`**: a standard-EVM vault that holds ERC-20 and native ETH while user balances live **off-chain** and are committed on-chain via a **Merkle root**.

The **same contract** is deployed on both **Base** and **Ethereum** — there is no FHE dependency on either chain.

Withdrawals are admin-executed and require:

- Merkle proof of `(user, token, balance)` inclusion under the current root
- EIP-712 `WithdrawAuth` signature (separate `withdrawSigner`)
- Root-bound nullifier replay protection

## Prerequisites

- Node.js and npm
- For **local tests** (`hardhat` network): no `.env` required
- For **live networks / verification**: set `PRIVATE_KEY`, `RPC_URL`, and `VERIFICATION_API_KEY` in `.env` (see `env.example`)

## Quick start

```bash
npm install --legacy-peer-deps
cp env.example ../.env
npx hardhat compile
npm test
```

### Deploy — Base

```bash
# Optional: deploy MockUSDC first (testnet only)
npx hardhat deploy --tags MockUSDC --network baseSepolia

# Deploy Veiledhood on Base
npx hardhat deploy --tags Veiledhood --network baseSepolia
# or mainnet:
npx hardhat deploy --tags Veiledhood --network base
```

### Deploy — Ethereum

```bash
# Deploy Veiledhood on Ethereum (same contract, separate instance)
npx hardhat deploy --tags Veiledhood_ETH --network sepolia
# or mainnet:
npx hardhat deploy --tags Veiledhood_ETH --network ethereum
```

Set `VEILEDHOOD_ETH_WITHDRAW_SIGNER` in `.env` before deploying if the withdraw signer should differ from the deployer key.

After any deploy, regenerate **`exports/<network>.json`** with:

```bash
npm run export:deployments -- baseSepolia
```

## Layout

- `contracts/Veiledhood.sol` — Merkle-root vault (ERC-20 + ETH), deployed on both Base and Ethereum
- `deploy/01_deploy_mock_usdc.ts` — optional MockUSDC for testnets (tag: `MockUSDC`)
- `deploy/02_deploy_veiledhood.ts` — Base deployment (tag: `Veiledhood`)
- `deploy/03_deploy_veiledhood_eth_vault.ts` — Ethereum deployment (tag: `Veiledhood_ETH`)
- `test/Veiledhood.ts` — unit tests
- `scripts/export-deployments.mjs` — exports deployment addresses/ABIs

## Notes

- Amounts in deposit/withdraw txs are public; “shielded” means balances are not stored per-user on-chain.
- Native ETH deposits use `deposit(address(0), amount)` with `msg.value`.
