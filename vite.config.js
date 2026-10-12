import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { chainApi } from './scripts/chain-server.mjs'

// Server-only settings (GEMINI_API_KEY, CHAIN_NETWORK, CHAIN_KEY...) can live in an optional .env; shell variables win.
try { process.loadEnvFile() } catch {}

// winget install path; shells opened before install don't have it on PATH yet
const WIN_EXE = 'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe'
const CLOUDFLARED = existsSync(WIN_EXE) ? WIN_EXE : 'cloudflared'

// Runs the Cloudflare tunnel only while the dev server is up, so
// preview.amsham.net goes down when `npm run dev` stops.
const tunnel = {
  name: 'cloudflare-tunnel',
  configureServer(server) {
    const proc = spawn(CLOUDFLARED, ['tunnel', '--url', 'http://localhost:5173', 'run', 'terragrid-preview'], { stdio: 'ignore' })
    proc.on('error', () => console.warn('cloudflared not found, preview.amsham.net is off'))
    server.httpServer?.on('close', () => proc.kill())
    process.on('exit', () => proc.kill())
  },
}

// POST /api/brief: optimizer facts in, three-section council brief out. POST /api/rank: per-measure totals in,
// top 3 measures with a reason each out. Key stays server-side; the model orders and explains, never invents numbers.
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite'
const PROMPTS = {
  brief: (facts) => `You write a one-page business case for a city council officer pitching a cooling budget to councillors (COP31 framing welcome).
Use ONLY the facts below; quote their numbers exactly as written (e.g. "$1.2M", "1.0 years"), invent no new figures, use correct singular/plural. Plain, confident, specific. No markdown.
Return JSON {"hazard": string, "plan": string, "roi": string}, each 2-3 sentences, max 60 words:
- hazard: who is exposed to what heat and air quality right now, and where.
- plan: what the budget funds, where, and why these roofs beat a uniform rollout. If measure_order is given, present the measures in that order.
- roi: payback, peak grid demand cut, and health/equity outcome.
Facts: ${facts}`,
  rank: (facts) => `You advise a city council on which building retrofit measures to fund first in one suburb.
Each measure below comes with totals computed over the suburb's buildings. Pick the best 3, best first, weighing payback, yearly saving,
buildings reached and vulnerable buildings reached (schools, health, aged care nearby, older residents) against the suburb's heat and people.
Use ONLY these facts; quote their numbers exactly as written (e.g. "$1.2M", "1.0 years"), invent no new figures, use correct singular/plural. No markdown.
Return JSON {"top": [{"key": string, "why": string}]} with exactly 3 items; key is a measure key from the facts; why is one short phrase, max 10 words, specific to this suburb.
Facts: ${facts}`,
}
const gemini = {
  name: 'gemini',
  configureServer(server) {
    for (const route in PROMPTS) server.middlewares.use(`/api/${route}`, async (req, res) => {
      const send = (code, obj) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj)) }
      const key = process.env.GEMINI_API_KEY
      // cloudflared stamps every tunnelled request; keep the paid key local-only
      if (req.headers['cf-connecting-ip']) return send(403, { error: 'local only' })
      if (req.method !== 'POST') return send(405, { error: 'POST only' })
      if (!key) return send(503, { error: 'GEMINI_API_KEY not set' })
      let body = ''
      for await (const c of req) body += c
      try {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify({ contents: [{ parts: [{ text: PROMPTS[route](body) }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.4 } }),
        })
        const j = await r.json()
        if (!r.ok) return send(502, { error: j.error?.message || r.status })
        send(200, { ...JSON.parse(j.candidates[0].content.parts[0].text), model: MODEL })
      } catch (e) {
        send(502, { error: String(e) })
      }
    })
  },
}

export default {
  server: { port: 5173, strictPort: true, allowedHosts: ['preview.amsham.net'] },
  plugins: [tunnel, gemini, chainApi],
}
