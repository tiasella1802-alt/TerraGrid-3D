// Checks the registry's rules against a fresh deployment on the local chain (npm run chain must be running).
//   node scripts/chain-test.mjs
import { readFileSync } from 'node:fs'
import { ethers } from 'ethers'
import { keys, provider as rpc } from './chain-config.mjs'

const { abi, bytecode } = JSON.parse(readFileSync('contracts/RetrofitRegistry.json', 'utf8'))
const provider = rpc('local'), { council, verifier } = keys('local', provider)
const stranger = new ethers.Wallet('0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a', provider) // local test account #2

const reg = await new ethers.ContractFactory(abi, bytecode, council).deploy()
await reg.waitForDeployment()
await (await reg.setVerifier(verifier.address, true)).wait()
const as = (s) => reg.connect(s)
const id = (s) => ethers.id(s), ev = (s) => ethers.sha256(ethers.toUtf8Bytes(s))

let fails = 0
async function check(name, fn) {
  try { await fn(); console.log(`  ok    ${name}`) } catch (e) { fails++; console.log(`  FAIL  ${name}\n        ${e.shortMessage || e.message}`) }
}
async function reverts(p, error) {
  try { await (await p).wait() } catch (e) {
    const got = e.revert?.name ?? reg.interface.parseError(e.data ?? e.info?.error?.data)?.name
    if (got === error) return
    throw new Error(`reverted with ${got ?? e.shortMessage}, wanted ${error}`)
  }
  throw new Error(`did not revert, wanted ${error}`)
}
const stage = async (r) => Number((await reg.buildings(r)).stage)

const A = id('parramatta:1'), B = id('parramatta:2'), C = id('parramatta:3'), HEAT = 0, ENERGY = 1
console.log('RetrofitRegistry rules')
await check('council enrols a roof with baseline evidence', async () => {
  await (await reg.enrol(A, HEAT, 270, 150, 8400000, ev('baseline A'))).wait()
  if ((await stage(A)) !== 1) throw new Error('not Enrolled')
})
await check('the same roof cannot be funded twice', () => reverts(reg.enrol(A, HEAT, 270, 150, 8400000, ev('again')), 'WrongStage'))
await check('enrolment without evidence is refused', () => reverts(reg.enrol(B, HEAT, 270, 150, 1, ethers.ZeroHash), 'NoEvidence'))
await check('only the council can enrol', () => reverts(as(stranger).enrol(B, HEAT, 270, 150, 1, ev('b')), 'NotCouncil'))
await check('a roof cannot be verified before it is installed', () => reverts(as(verifier).verify(A, 50, ev('after')), 'WrongStage'))
await check('council marks it installed', async () => {
  await (await reg.markInstalled(A)).wait()
  if ((await stage(A)) !== 2) throw new Error('not Installed')
})
await check('the council cannot verify its own roof', () => reverts(reg.verify(A, 50, ev('after')), 'NotVerifier'))
await check('a stranger cannot verify', () => reverts(as(stranger).verify(A, 50, ev('after')), 'NotVerifier'))
await check('too little cooling: no rebate, roof stays Installed', async () => {
  const rc = await (await as(verifier).verify(A, 200, ev('after 1'))).wait() // 2.70 → 2.00 = 0.70 °C < 1.50 required
  if (!rc.logs.some((l) => reg.interface.parseLog(l)?.name === 'NotYetImproved')) throw new Error('no NotYetImproved event')
  if ((await stage(A)) !== 2) throw new Error('stage changed')
})
await check('enough cooling: verified and rebate released', async () => {
  const rc = await (await as(verifier).verify(A, 50, ev('after 2'))).wait() // 2.70 → 0.50 = 2.20 °C ≥ 1.50
  const v = rc.logs.map((l) => reg.interface.parseLog(l)).find((l) => l?.name === 'Verified')
  if (!v || v.args.gain !== 220n || v.args.rebateCents !== 8400000n) throw new Error('wrong Verified event')
  if ((await stage(A)) !== 3) throw new Error('not Verified')
})
await check('a verified roof cannot be verified (paid) again', () => reverts(as(verifier).verify(A, 0, ev('after 3')), 'WrongStage'))
await check('energy metric: verified when use drops by the required kWh', async () => {
  await (await reg.enrol(C, ENERGY, 120000, 9000, 2500000, ev('baseline C'))).wait() // 120 MWh/yr, needs 9 MWh/yr less
  await (await reg.markInstalled(C)).wait()
  await (await as(verifier).verify(C, 115000, ev('meter 1'))).wait() // only 5 MWh less
  if ((await stage(C)) !== 2) throw new Error('verified too early')
  await (await as(verifier).verify(C, 108000, ev('meter 2'))).wait() // 12 MWh less
  if ((await stage(C)) !== 3) throw new Error('not Verified')
})
await check('sensor readings can be anchored by the verifier', async () => {
  const rc = await (await as(verifier).anchor(ev('readings'), 120, 'street sensor')).wait()
  if (!rc.logs.some((l) => reg.interface.parseLog(l)?.name === 'DataAnchored')) throw new Error('no DataAnchored event')
})
await check('strangers cannot anchor data', () => reverts(as(stranger).anchor(ev('x'), 1, 'fake'), 'NotVerifier'))

console.log(fails ? `\n${fails} failed` : '\nall passed')
process.exit(fails ? 1 : 0)
