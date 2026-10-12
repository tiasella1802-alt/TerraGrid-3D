// Shared by scripts/chain.mjs and the dev server: which chain, which keys.
import { ethers } from 'ethers'

// The local chain's first two accounts. These keys are Hardhat's published test accounts: public, worthless, local only.
const LOCAL_COUNCIL = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const LOCAL_VERIFIER = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'

export const NETWORKS = {
  local: { rpc: 'http://127.0.0.1:8545' },
  // Read lazily: the dev server loads .env after this module is imported.
  sepolia: { get rpc() { return process.env.CHAIN_RPC || 'https://ethereum-sepolia-rpc.publicnode.com' }, explorer: 'https://sepolia.etherscan.io' },
}

export const network = () => process.env.CHAIN_NETWORK || 'local'

// No response caching: a fast local chain otherwise hands back a stale nonce for back-to-back transactions.
export const provider = (name) => new ethers.JsonRpcProvider(NETWORKS[name].rpc, undefined, { cacheTimeout: -1 })

// Council signs enrolments; a separate verifier signs measurements. On a testnet, CHAIN_VERIFIER_KEY may be omitted
// (the council key is then also allowed to verify), but two keys show the separation of duties.
// Plain wallets: with caching off each send fetches a fresh nonce, so send transactions one at a time.
export function keys(name, provider) {
  const local = name === 'local'
  const ck = local ? LOCAL_COUNCIL : process.env.CHAIN_KEY
  if (!ck) throw new Error(`CHAIN_KEY is not set for ${name}`)
  const vk = local ? LOCAL_VERIFIER : process.env.CHAIN_VERIFIER_KEY || ck
  return { council: new ethers.Wallet(ck, provider), verifier: new ethers.Wallet(vk, provider) }
}
