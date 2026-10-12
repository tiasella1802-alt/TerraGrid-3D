// Dev-server routes for the retrofit ledger (contracts/RetrofitRegistry.sol). Keys stay server-side, like the Gemini key.
//   GET  /api/chain/status            network, contract, council and verifier addresses (503 if the chain or contract is missing)
//   GET  /api/chain/building?id=      the on-chain record for one building ("city:osmId")
//   GET  /api/chain/events            every ledger event, oldest first
//   POST /api/chain/enrol             { id, metric: 'heat'|'energy', baseline, minGain, rebate, evidence }   council signs
//   POST /api/chain/install           { id }                                                               council signs
//   POST /api/chain/verify            { id, measured, evidence }                                            verifier signs
//   POST /api/chain/anchor            { hash, readings, kind }                                              verifier signs
// Values arrive in display units (°C, kWh, dollars) and are scaled to the contract's integers here.
import { readFileSync, existsSync } from 'node:fs'
import { ethers } from 'ethers'
import { NETWORKS, network, keys, provider as rpc } from './chain-config.mjs'

const METRIC = { heat: 0, energy: 1 }, STAGE = ['none', 'enrolled', 'installed', 'verified']
const scale = (metric, v) => BigInt(Math.round(metric === 'heat' ? v * 100 : v)) // heat in hundredths of °C, energy in kWh
const unscale = (metric, v) => (metric === 0 ? Number(v) / 100 : Number(v))

let cached = null
function connect() {
  const name = network(), file = `contracts/deployments/${name}.json`
  if (!existsSync(file)) throw Object.assign(new Error(`No contract deployed on ${name}. Run: npm run chain:deploy`), { code: 503 })
  const info = JSON.parse(readFileSync(file, 'utf8'))
  if (cached?.info.address === info.address) return cached
  const { abi } = JSON.parse(readFileSync('contracts/RetrofitRegistry.json', 'utf8'))
  const provider = rpc(name), { council, verifier } = keys(name, provider)
  cached = { info, provider, net: NETWORKS[name], read: new ethers.Contract(info.address, abi, provider),
    council: new ethers.Contract(info.address, abi, council), verifier: new ethers.Contract(info.address, abi, verifier) }
  return cached
}

// One transaction at a time, so each send reads a fresh nonce.
let queue = Promise.resolve()
const serial = (fn) => (queue = queue.then(fn, fn))

const link = (c, hash) => (c.net.explorer ? `${c.net.explorer}/tx/${hash}` : null)
// Sends a transaction and waits for it; the parsed logs ride along non-enumerable, so they never reach the browser.
async function send(c, txp) {
  const tx = await txp, rc = await tx.wait()
  return Object.defineProperty({ tx: tx.hash, block: rc.blockNumber, url: link(c, tx.hash) }, 'logs',
    { value: rc.logs.map((l) => c.read.interface.parseLog(l)).filter(Boolean) })
}

// Turn the contract's custom errors into sentences the UI can show.
function why(c, e) {
  let err = e.revert
  try { err ??= c.read.interface.parseError(e.data ?? e.info?.error?.data) } catch {}
  const [have, want] = (err?.args ?? []).map((v) => STAGE[Number(v)])
  return { NotCouncil: 'Only the council can do that.', NotVerifier: 'Only an approved verifier can do that.', NoEvidence: 'Evidence is required.',
    WrongStage: have === 'none' ? 'This building is not in the program on the ledger.'
      : want === 'none' ? `This building is already in the program (${have}), so it can't be funded twice.`
      : `On the ledger this building is ${have}, but this step needs it ${want}.` }[err?.name]
    ?? (e.code === 'ECONNREFUSED' || /ECONNREFUSED|fetch failed/.test(String(e)) ? 'The blockchain is not running. Start it with: npm run chain' : e.shortMessage || e.message)
}

async function record(c, id) {
  const b = await c.read.buildings(ethers.id(id)), m = Number(b.metric)
  return { id, stage: STAGE[Number(b.stage)], metric: m ? 'energy' : 'heat', baseline: unscale(m, b.baseline), measured: unscale(m, b.measured),
    minGain: unscale(m, b.minGain), rebate: Number(b.rebateCents) / 100, baselineEvidence: b.baselineEvidence, afterEvidence: b.afterEvidence,
    enrolledAt: Number(b.enrolledAt), installedAt: Number(b.installedAt), verifiedAt: Number(b.verifiedAt) }
}

const routes = {
  'GET status': async (c) => {
    if ((await c.provider.getCode(c.info.address)) === '0x') throw Object.assign(new Error('The chain was restarted, so the contract is gone. Run: npm run chain:deploy'), { code: 503 })
    return { ...c.info, explorer: c.net.explorer ?? null, count: Number(await c.read.count()), block: await c.provider.getBlockNumber() }
  },
  'GET building': (c, q) => record(c, q.get('id')),
  'GET events': async (c) => {
    const logs = await c.read.queryFilter('*', c.info.block ?? 0), metricOf = {}, out = []
    for (const l of logs) { // oldest first, so each building's Enrolled event (which carries its metric) comes before its results
      const p = c.read.interface.parseLog(l), a = p.args
      if (p.name === 'Enrolled') metricOf[a.id] = Number(a.metric)
      const m = a.id ? metricOf[a.id] : undefined
      out.push({ event: p.name, id: a.id ?? null, block: l.blockNumber, tx: l.transactionHash, url: link(c, l.transactionHash),
        time: (await l.getBlock()).timestamp, metric: m === undefined ? null : m ? 'energy' : 'heat',
        gain: a.gain !== undefined ? unscale(m, a.gain) : null, rebate: a.rebateCents !== undefined ? Number(a.rebateCents) / 100 : null,
        evidence: a.evidence ?? a.dataHash ?? null, kind: a.kind ?? null, readings: a.readings !== undefined ? Number(a.readings) : null })
    }
    return out
  },
  'POST enrol': (c, _, b) => serial(() => send(c, c.council.enrol(ethers.id(b.id), METRIC[b.metric], scale(b.metric, b.baseline), scale(b.metric, b.minGain),
    BigInt(Math.round(b.rebate * 100)), b.evidence))),
  'POST install': (c, _, b) => serial(() => send(c, c.council.markInstalled(ethers.id(b.id)))),
  'POST verify': async (c, _, b) => {
    const { metric } = await record(c, b.id)
    const r = await serial(() => send(c, c.verifier.verify(ethers.id(b.id), scale(metric, b.measured), b.evidence)))
    const ev = r.logs.find((l) => l.name === 'Verified' || l.name === 'NotYetImproved')
    return { ...r, verified: ev?.name === 'Verified', gain: unscale(METRIC[metric], ev?.args.gain ?? 0) }
  },
  'POST anchor': (c, _, b) => serial(() => send(c, c.verifier.anchor(b.hash, b.readings, b.kind))),
}

export const chainApi = {
  name: 'chain-api',
  configureServer(server) {
    server.middlewares.use('/api/chain', async (req, res) => {
      const reply = (code, obj) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj, (_, v) => (typeof v === 'bigint' ? Number(v) : v))) }
      const url = new URL(req.url, 'http://x'), route = routes[`${req.method} ${url.pathname.slice(1)}`]
      if (!route) return reply(404, { error: 'unknown route' })
      // Writes spend the server's keys: local only, like /api/brief. Reads are fine through the tunnel.
      if (req.method === 'POST' && req.headers['cf-connecting-ip']) return reply(403, { error: 'local only' })
      let c
      try {
        c = connect()
        let body = ''
        for await (const chunk of req) body += chunk
        reply(200, await route(c, url.searchParams, body ? JSON.parse(body) : {}))
      } catch (e) {
        const msg = c ? why(c, e) : e.message
        reply(e.code === 503 || !c || /not running/.test(msg) ? 503 : 400, { error: msg })
      }
    })
  },
}
