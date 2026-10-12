// Compile contracts/RetrofitRegistry.sol and deploy it.
//   node scripts/chain.mjs compile          → contracts/RetrofitRegistry.json (ABI + bytecode)
//   node scripts/chain.mjs deploy           → local chain (npm run chain must be running)
//   node scripts/chain.mjs deploy sepolia   → public testnet; needs CHAIN_RPC + CHAIN_KEY (+ CHAIN_VERIFIER_KEY) in .env
// Writes contracts/deployments/<network>.json, which the dev server (vite.config.js) reads.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import solc from 'solc'
import { ethers } from 'ethers'
import { NETWORKS, keys, provider as rpc } from './chain-config.mjs'

const SRC = 'contracts/RetrofitRegistry.sol', OUT = 'contracts/RetrofitRegistry.json'

function compile() {
  const input = { language: 'Solidity', sources: { [SRC]: { content: readFileSync(SRC, 'utf8') } },
    settings: { optimizer: { enabled: true, runs: 200 }, outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } } }
  const out = JSON.parse(solc.compile(JSON.stringify(input)))
  const errs = (out.errors ?? []).filter((e) => e.severity === 'error')
  if (errs.length) throw new Error(errs.map((e) => e.formattedMessage).join('\n'))
  const c = out.contracts[SRC].RetrofitRegistry
  writeFileSync(OUT, JSON.stringify({ compiler: solc.version(), abi: c.abi, bytecode: '0x' + c.evm.bytecode.object }, null, 2))
  console.log(`compiled with solc ${solc.version()} → ${OUT}`)
  return c
}

async function deploy(name) {
  const net = NETWORKS[name]
  if (!net) throw new Error(`unknown network "${name}"; one of ${Object.keys(NETWORKS).join(', ')}`)
  const { abi, bytecode } = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : (compile(), JSON.parse(readFileSync(OUT, 'utf8')))
  const provider = rpc(name)
  const { council, verifier } = keys(name, provider)
  console.log(`deploying to ${name} (${net.rpc}) from council ${council.address}`)
  const contract = await new ethers.ContractFactory(abi, bytecode, council).deploy()
  await contract.waitForDeployment()
  const address = await contract.getAddress(), tx = contract.deploymentTransaction()
  await (await contract.setVerifier(verifier.address, true)).wait()
  const { chainId } = await provider.getNetwork()
  mkdirSync('contracts/deployments', { recursive: true })
  const info = { network: name, chainId: Number(chainId), address, council: council.address, verifier: verifier.address,
    deployTx: tx.hash, block: (await tx.wait()).blockNumber, explorer: net.explorer ?? null, deployedAt: new Date().toISOString() }
  writeFileSync(`contracts/deployments/${name}.json`, JSON.stringify(info, null, 2))
  console.log(`RetrofitRegistry at ${address} · verifier ${verifier.address}${net.explorer ? `\n${net.explorer}/address/${address}` : ''}`)
}

const [cmd = 'deploy', name = 'local'] = process.argv.slice(2)
if (cmd === 'compile') compile()
else if (cmd === 'deploy') await deploy(name)
else throw new Error(`unknown command "${cmd}"`)
