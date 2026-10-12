import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';

// Vite's dep pre-bundling breaks MapLibre's own worker lookup; without the worker no vector tiles render.
maplibregl.setWorkerUrl(workerUrl);

// Everything location-specific lives here. Buildings: data/buildings-<key>.geojson (scripts/fetch-buildings.mjs);
// precincts and POIs carry a `city` key. `co2`: grid t CO₂ per MWh. `box`: [W, S, E, N] of the baked buildings. `surf`: typical summer roof °C for cities outside the Landsat scene.
// `warm`: °C/yr trend in summer daily max, 1995–2050, mean of 7 CMIP6 HighResMIP models (Open-Meteo Climate API).
const CITIES = [
  { key: 'parramatta', warm: 0.019, place: 'Sydney, New South Wales, Australia', box: [150.955, -33.850, 151.045, -33.785], name: 'Parramatta', region: 'Sydney', center: [151.003, -33.815], ref: [151.177, -33.946], refName: 'Sydney Airport station',
    ghi: 1790, kwh$: 0.30, co2: 0.66, cur: '$', cool: 1, plumes: [{ at: [151.026, -33.817], name: 'Camellia industrial' }, { at: [151.0418, -33.827], name: 'Clyde fuel terminal' }],
    tree_cover_pct: 12, age65_pct: 18, population: 64700 },
  { key: 'melbourne', warm: 0.027, place: 'Victoria, Australia', box: [144.930, -37.833, 144.977, -37.791], name: 'Melbourne CBD', region: 'Melbourne', center: [144.962, -37.815], ref: [144.843, -37.669], refName: 'Melbourne Airport station',
    ghi: 1600, surf: 41, kwh$: 0.29, co2: 0.79, cur: '$', cool: 0.7, plumes: [{ at: [144.928, -37.824], name: 'Port of Melbourne' }, { at: [144.925, -37.806], name: 'Dynon rail freight terminals' }],
    tree_cover_pct: 12, age65_pct: 8, population: 111900 },
  { key: 'london', warm: 0.035, place: 'England, United Kingdom', box: [-0.131, 51.500, -0.069, 51.530], name: 'Central London', region: 'London', center: [-0.098, 51.512], ref: [-0.454, 51.470], refName: 'Heathrow station',
    ghi: 1000, surf: 33, kwh$: 0.25, co2: 0.2, cur: '£', cool: 0.35, plumes: [{ at: [-0.075, 51.4985], name: 'Tower Bridge Rd traffic' }, { at: [-0.0798, 51.4915], name: 'Mandela Way industrial area' }],
    tree_cover_pct: 14, age65_pct: 11, population: 53100 },
  { key: 'sydney', warm: 0.019, place: 'New South Wales, Australia', box: [151.196, -33.893, 151.220, -33.852], name: 'Sydney CBD', region: 'Sydney', center: [151.207, -33.869], ref: [151.177, -33.946], refName: 'Sydney Airport station',
    ghi: 1800, kwh$: 0.30, co2: 0.66, cur: '$', cool: 0.9, plumes: [{ at: [151.181, -33.866], name: 'Rozelle Interchange stacks' }, { at: [151.2100, -33.8582], name: 'Overseas Passenger Terminal (cruise ships)' }],
    tree_cover_pct: 15, age65_pct: 10, population: 46000 },
  { key: 'suva', warm: 0.019, place: 'Central Division, Fiji', box: [178.417, -18.158, 178.455, -18.124], name: 'Suva', region: 'Fiji', center: [178.429, -18.139], ref: [178.559, -18.043], refName: 'Nausori Airport station',
    ghi: 1950, surf: 39, kwh$: 0.42, co2: 0.5, cur: 'FJ$', cool: 1, plumes: [{ at: [178.4325, -18.1285], name: 'Walu Bay industrial' }],
    tree_cover_pct: 20, age65_pct: 6, population: 93900 },
];
// Energy use by building type: EUI kWh per m² floor per year (NABERS/CBECS-style medians), cooling share of it
// in a warm-temperate climate (scaled by the city's `cool`). OSM building tags map onto these types in buildingType().
const ENERGY = {
  house: { eui: 110, cool: 0.18 }, apartment: { eui: 130, cool: 0.2 }, office: { eui: 210, cool: 0.32 },
  retail: { eui: 300, cool: 0.28 }, school: { eui: 95, cool: 0.22 }, health: { eui: 380, cool: 0.26 },
  hotel: { eui: 270, cool: 0.27 }, industrial: { eui: 140, cool: 0.12 }, other: { eui: 0, cool: 0 },
  perC: 0.07, // extra cooling energy per °C of local roof heat
  cdd: 0.25, // citywide cooling demand growth per °C of climate warming (cooling degree days rise faster than mean temp)
};
// Retrofit measures. Cost = rate × basis (roof = footprint m², floor = floor m², tree = trees planted).
// Saving = share of the building's cooling kWh (`cool`), total kWh (`all`) and local-heat penalty (`extra`); solar offsets its own yield.
const MEASURES = {
  roofs: { name: 'Cool roofs', types: 'house apartment office retail school health hotel industrial', basis: 'roof', rate: 45, cool: 0.15, extra: 0.6, life: 20 },
  trees: { name: 'Tree canopy', types: 'house apartment school health retail', basis: 'tree', rate: 900, cool: 0.12, life: 40, max: 15 },
  solar: { name: 'Rooftop solar', types: 'house apartment office retail school health hotel industrial', basis: 'roof', rate: 180, solar: 1, life: 25 },
  insul: { name: 'Insulation', types: 'house apartment school retail', basis: 'roof', rate: 35, cool: 0.2, all: 0.05, life: 30 },
  hvac: { name: 'Efficient HVAC', types: 'apartment office retail school health hotel', basis: 'floor', rate: 60, cool: 0.3, life: 15 },
  ctrl: { name: 'Smart controls', types: 'office retail school health hotel', basis: 'floor', rate: 8, all: 0.08, life: 10 },
};
Object.values(MEASURES).forEach((m, i) => Object.assign(m, { types: new Set(m.types.split(' ')), i }));
// Stable 0..1 per building and measure: existing condition (roof state, plant age, glazing) scales what each measure saves.
const fit = (q, m) => { const x = Math.sin(q.seed * 12.9898 + m.i * 78.233) * 43758.5453; return 0.55 + 0.9 * (x - Math.floor(x)); };
// One building, one measure: [capex, kWh/yr saved]. Trees: one per 150 m² of footprint, low-rise only.
function retrofit(q, k) {
  const m = MEASURES[k];
  if (!m.types.has(q.type) || (k === 'trees' && q.height > 15)) return [0, 0];
  const n = { roof: q.area, floor: q.floor, tree: Math.min(m.max, Math.ceil(q.area / 150)) }[m.basis];
  const top = m.basis === 'floor' ? 1 : Math.min(1, (2 * q.area) / (q.floor || 1)); // roofs and trees only reach the top two floors
  return [n * m.rate, m.solar ? q.mwh * 1000 : fit(q, m) * top * ((m.cool ?? 0) * q.cool_kwh + (m.all ?? 0) * q.kwh + (m.extra ?? 0) * q.extra_kwh)];
}

// ---- Retrofit priority: per-building inputs, each a 0..1 percentile rank so one outlier can't flatten the ramp ----
// nS savings $/yr and nP 1/payback of the building's best measure (highest saving per $), nV public/vulnerable, nH roof heat.
// Score = weighted mean; heat has a fixed weight, the other three are the scenario card sliders.
const W = { nS: 1, nP: 1, nV: 1, nH: 0.5 };
const score = (q) => Object.entries(W).reduce((s, [k, w]) => s + w * q[k], 0) / Object.values(W).reduce((a, b) => a + b, 0);
const PUBLIC = new Set('government civic public townhall library community_centre fire_station police courthouse'.split(' '));
function priorityInputs(fs, cityPois) {
  const kx = Math.cos((CITY.center[1] * Math.PI) / 180) * 111320, ky = 110540;
  const best = fs.map((f) => {
    let b = { k: null, cap: 0, kwh: 0 };
    // Best fix = biggest yearly saving that pays back within the measure's life. Demand-side only: solar is generation and would win on almost every roof.
    for (const k in MEASURES) if (k !== 'solar') {
      const [c, e] = retrofit(f.properties, k);
      if (c > 0 && e > b.kwh && c / (e * CITY['kwh$']) < MEASURES[k].life) b = { k, cap: c, kwh: e };
    }
    return { ...b, usd: b.kwh * CITY['kwh$'] };
  });
  const nS = rank(best.map((b) => b.usd)), nP = rank(best.map((b) => (b.cap ? b.usd / b.cap : 0))), nH = rank(fs.map((f) => f.properties.lst ?? 0));
  fs.forEach((f, i) => {
    const q = f.properties, b = best[i], [x, y] = mid(f.geometry.coordinates[0]);
    // Vulnerable: schools, health and aged care themselves, public buildings, then fading out to 300 m from a school or aged care; homes carry the city's 65+ share.
    const d = Math.min(...cityPois.map((p) => Math.hypot((p.geometry.coordinates[0] - x) * kx, (p.geometry.coordinates[1] - y) * ky)));
    const nV = q.type === 'school' || q.type === 'health' ? 1 : PUBLIC.has(q.osm) ? 0.8
      : Math.max(0.8 * Math.max(0, 1 - d / 300), q.type === 'house' || q.type === 'apartment' ? CITY.age65_pct / 40 : 0);
    Object.assign(q, { best: b.k, best_usd: Math.round(b.usd), best_cap: Math.round(b.cap), nS: b.k ? nS[i] : 0, nP: b.k ? nP[i] : 0, nV, nH: nH[i] });
  });
}
// Where each input comes from: measured (m), estimated (e), missing (x). Roof °C is measured only inside the Landsat scene.
const conf = (q) => [['Roof °C', CITY.surf ? 'e' : 'm'], ['Footprint', 'm'], ['Type', q.conf === 'osm' ? 'm' : 'e'], ['Floor area', 'e'], ['Energy', 'e'], ['Metered', 'x']];
const CONF = { m: 'measured', e: 'estimated', x: 'missing' };
const dots = (q, labels) => `<span class="conf">${conf(q).map(([l, c]) => `<i class="cf ${c}" title="${l}: ${CONF[c]}">${labels ? l : ''}</i>`).join('')}</span>`;
// Score ± band in points: estimated inputs carry their weight's share of a ±12 pt spread (savings and payback always do: no metering).
const band = (q) => Math.round((12 * (W.nS + W.nP + (CITY.surf ? W.nH : 0) + (q.conf === 'osm' ? 0 : W.nV))) / Object.values(W).reduce((a, b) => a + b, 0));
let scores = [];
const rescore = () => (scores = buildings.map((f) => score(f.properties)).sort((a, b) => a - b));
const pct = (q) => { if (scores.length !== buildings.length) rescore(); const s = score(q); let lo = 0, hi = scores.length; while (lo < hi) { const m = (lo + hi) >> 1; if (scores[m] < s) lo = m + 1; else hi = m; } return Math.round((100 * lo) / Math.max(1, scores.length - 1)); };
// Teal ramp stretched over the city's score quantiles, so the top 10% always stand out whatever the weights.
function prioColor() {
  rescore();
  const tot = Object.values(W).reduce((a, b) => a + b, 0), e = ['/', ['+', ...Object.entries(W).map(([k, w]) => ['*', w, ['get', k]])], tot];
  let prev = -1;
  const at = (p) => (prev = Math.max(prev + 1e-6, scores[Math.floor(p * (scores.length - 1))] ?? p));
  return ['interpolate', ['linear'], e, at(0.5), '#1b2a3d', at(0.8), '#0f6f6a', at(0.93), '#14b8a6', at(0.99), '#99f6e4'];
}
const TYPE_NAME = { house: 'House', apartment: 'Apartments', office: 'Office', retail: 'Retail', school: 'School', health: 'Health / aged care', hotel: 'Hotel', industrial: 'Industrial', other: 'Other' };
const OSM_TYPE = {
  house: 'house detached semidetached_house terrace bungalow hut cabin farm', apartment: 'apartments residential dormitory',
  office: 'office commercial government civic public', retail: 'retail supermarket shop restaurant pub cafe fast_food bar kiosk marketplace',
  school: 'school kindergarten university college', health: 'hospital clinic nursing_home doctors social_facility aged',
  hotel: 'hotel', industrial: 'industrial warehouse factory service manufacture',
  other: 'roof shelter garage garages carport shed construction ruins bridge church place_of_worship cathedral chapel',
};
const TYPE_OF = Object.fromEntries(Object.entries(OSM_TYPE).flatMap(([k, v]) => v.split(' ').map((t) => [t, k])));
// Start city: ?city=, else the last one picked, else Sydney CBD.
let lastCity = null;
try { lastCity = localStorage.getItem('tg-city'); } catch {}
let CITY = CITIES.find((c) => c.key === (new URLSearchParams(location.search).get('city') ?? lastCity)) ?? CITIES.find((c) => c.key === 'sydney');
const OCEANIA = [150, -25];

const map = new maplibregl.Map({
  container: 'map',
  style: 'https://tiles.openfreemap.org/styles/liberty',
  center: OCEANIA,
  zoom: 1.6,
  attributionControl: { compact: true },
});
// Zoom buttons live in .ctrls with 2D/3D and the sensor (see below), so the stack lines up.

// Recolour liberty to the dark canvas.
const greens = []; // park/wood fill layers, brightened by the canopy layer
const C = { bg: '#0b1220', land: '#111a2b', green: '#10241f', water: '#0d2238', road: '#1c2840', bld: '#2a3447' };

function recolour() {
  for (const l of map.getStyle().layers) {
    const id = l.id, set = (k, v) => map.setPaintProperty(id, k, v);
    if (/poi|shield|one_way|road_area_pattern|park_outline/.test(id)) map.setLayoutProperty(id, 'visibility', 'none');
    else if (l.type === 'background') set('background-color', C.bg);
    else if (l.type === 'raster') { set('raster-brightness-max', 0.35); set('raster-saturation', -0.6); }
    else if (id === 'water') set('fill-color', C.water);
    else if (id === 'building') set('fill-color', '#1a2335');
    else if (id === 'building-3d') {
      set('fill-extrusion-color', C.bld);
      set('fill-extrusion-opacity', ['interpolate', ['linear'], ['zoom'], 13.5, 0.95, 14, 0]);
      set('fill-extrusion-vertical-gradient', true);
    }
    else if (l.type === 'fill') set('fill-color', /park|wood|grass|wetland/.test(id) ? (greens.push(id), C.green) : C.land);
    else if (l.type === 'line') set('line-color', /waterway/.test(id) ? C.water : /casing/.test(id) ? C.bg : /boundary/.test(id) ? '#334155' : C.road);
    else if (l.type === 'symbol') { set('text-color', '#94a3b8'); set('text-halo-color', C.bg); }
  }
}

window.map = map; // console debugging

map.on('style.load', () => {
  map.setProjection({ type: 'globe' });
  map.setSky({
    'sky-color': '#0b1220',
    'horizon-color': '#1e3a5f',
    'fog-color': '#0b1220',
    'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 10, 1, 12, 0],
  });
  recolour();
  addHeatLayers();
  addOverlays();
});

// Intro: slow spin over Oceania, then fly in.
let spinning = true, flown = false;
function spin() {
  if (!spinning) return;
  const c = map.getCenter();
  map.setCenter([c.lng - 0.04, c.lat]);
  requestAnimationFrame(spin);
}
map.on('load', () => {
  // Compact attribution starts expanded and only collapses on the first drag; collapse it now.
  document.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
  spin();
  setTimeout(() => !flown && flyIn(), 4000);
});
map.on('mousedown', () => (spinning = false));

function flyIn() {
  flown = true;
  spinning = false;
  setMode3d(true, false);
  map.flyTo({ center: CITY.center, zoom: 15.4, pitch: 45, bearing: 0, speed: 0.55, curve: 1.6, essential: true });
  map.once('moveend', () => map.easeTo({ zoom: 16, pitch: 60, bearing: -20, duration: 2500 }));
}

function restartIntro() {
  flown = true; // demo replays manually, no auto timer
  map.stop();
  select(null);
  setLayers(['heat']);
  map.jumpTo({ center: OCEANIA, zoom: 1.6, pitch: 0, bearing: 0 });
  spinning = true;
  spin();
  setTimeout(flyIn, 4000);
}

// Workflow rail: Explore → Compare → Plan → Deliver. Steps map onto the body classes the panels already key off.
document.getElementById('explore').onclick = () => { document.body.classList.remove('fresh'); compare(false); closeScenario(); if (!flown) flyIn(); };
$('plan').onclick = $('d-plan').onclick = () => {
  document.body.classList.remove('deliver', 'briefed');
  $('s-export').textContent = 'Create council brief';
  if (!document.body.classList.contains('scenario')) openScenario();
};
$('deliver').onclick = () => {
  if (!document.body.classList.contains('scenario')) openScenario();
  if (!document.body.classList.contains('scenario')) return;
  document.body.classList.add('deliver');
  renderProgram();
  ledgerApi('status').then((s) => (ledger = s), () => (ledger = null)).then(renderLedger);
  if (!document.body.classList.contains('briefed')) makeBrief();
};
$('d-letters').onclick = () => (last?.chosen.length ? sendOffers() : $('plan').onclick());
$('p-cmp').onclick = () => compare(true);
$('loc').onclick = () => $('search').focus();
function syncRail() {
  const c = document.body.classList;
  if (!c.contains('scenario') && c.contains('deliver')) c.remove('deliver'); // remove() rewrites the attribute even when absent, which would re-fire the observer forever
  const m = c.contains('deliver') ? 'deliver' : c.contains('scenario') ? 'plan' : c.contains('compare') ? 'compare' : 'explore';
  for (const id of ['explore', 'compare', 'plan', 'deliver']) $(id).classList.toggle('active', id === m);
}
new MutationObserver(syncRail).observe(document.body, { attributes: true, attributeFilter: ['class'] });
document.getElementById('demo').onclick = restartIntro;

// City switch: flyTo's zoom-out arc takes it up to the globe and back down; data swaps in while it flies.
// `at`: a searched address to land on instead of the centre; it gets a pin and its precinct is selected.
function goCity(c, at, name) {
  addrPin?.remove();
  addrPin = null;
  const land = () => {
    if (c !== CITY) return;
    if (at) addrPin = new maplibregl.Marker({ element: pin('addr', esc(name), ICON.pin), anchor: 'bottom' }).setLngLat(at).addTo(map);
    const p = at && precincts.find((p) => inside(at, p.geometry.coordinates[0]));
    select(p ? p.properties.name : null);
    if (!p) map.easeTo({ zoom: 16, pitch: 60, bearing: -20, duration: 2500 });
  };
  if (c === CITY) {
    if (!at) return flyIn();
    flown = true;
    spinning = false;
    map.flyTo({ center: at, zoom: 15.4, pitch: 45, bearing: 0, speed: 0.8, curve: 1.5, essential: true });
    return map.once('moveend', land);
  }
  select(null);
  CITY = c;
  try { localStorage.setItem('tg-city', c.key); } catch {}
  live = aq = null;
  $('crumb').textContent = c.region;
  flown = true;
  spinning = false;
  setMode3d(true, false);
  // Pull back to the globe, load the new city up there (building layers are off below z12, so it costs no rendering),
  // then dive in flat and tilt up on landing. A pitched flight loads masses of horizon tiles and stutters.
  loadSeq++;
  buildings = [];
  for (const s of ['bld', 'trees', 'precincts', 'picks']) map.getSource(s)?.setData(EMPTY);
  markers.forEach((m) => m.remove());
  plumeMarkers.forEach((m) => m.remove());
  liveTemp();
  map.easeTo({ zoom: 2.2, pitch: 0, bearing: 0, duration: 2000, essential: true });
  map.once('moveend', async () => {
    if (c !== CITY) return;
    await loadCity();
    if (c !== CITY) return;
    map.flyTo({ center: at ?? c.center, zoom: 15.4, speed: 0.9, curve: 1.5, essential: true });
    map.once('moveend', land);
  });
}

// Search: modelled cities and precincts first (shown like any other result), then any address from Photon (OSM geocoder, keyless).
// An address inside a city box switches to that city; elsewhere it just flies there and pins it.
$('crumb').textContent = CITY.region;
let addrPin = null, sugg = [], sTimer = 0, sSeq = 0;
const esc = (t) => String(t).replace(/[&<>"]/g, (ch) => `&#${ch.charCodeAt(0)};`);
function showSugg(list) {
  sugg = list;
  $('sugg').innerHTML = list.map((s, i) => `<li data-i="${i}"><b>${esc(s.name)}</b><span>${esc(s.sub)}</span></li>`).join('');
  $('sugg').hidden = !list.length;
}
$('search').oninput = (e) => {
  const q = e.target.value.trim(), hit = (s) => s.toLowerCase().startsWith(q.toLowerCase());
  clearTimeout(sTimer);
  sSeq++;
  if (q.length < 3) return showSugg([]);
  // Name matches before region matches ("Sydney" → Sydney CBD, then Parramatta); everything appears together.
  const local = [...CITIES.filter((c) => hit(c.name)), ...CITIES.filter((c) => !hit(c.name) && hit(c.region))].map((c) => ({ name: c.name, sub: c.place, city: c }))
    .concat(precincts.filter((p) => hit(p.properties.name)).map((p) => ({ name: p.properties.name, sub: `${CITY.name}, ${CITY.place}`, precinct: p.properties.name })));
  const seq = sSeq;
  sTimer = setTimeout(() => fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6&lang=en`).then((r) => r.json()).catch(() => ({ features: [] })).then((j) => {
    if (seq !== sSeq) return;
    const seen = new Set(local.map((s) => s.name.toLowerCase())); // our entry replaces Photon's same-named one
    showSugg([...local, ...j.features.map(({ geometry, properties: p }) => {
      const street = [p.housenumber, p.street].filter(Boolean).join(' ');
      return { name: p.name || street || p.city, sub: [p.name && street, p.district || p.city || p.county, p.country].filter(Boolean).join(', '), at: geometry.coordinates };
    }).filter((s) => !seen.has(s.name.toLowerCase() + s.sub) && seen.add(s.name.toLowerCase() + s.sub) && !seen.has(s.name.toLowerCase()))].slice(0, 6));
  }).catch(() => {}), 250);
};
function pick(s) {
  showSugg([]);
  $('search').value = '';
  $('search').blur();
  if (s.city) return goCity(s.city);
  if (s.precinct) return select(s.precinct);
  const [x, y] = s.at, c = CITIES.find(({ box: [w, so, e, n] }) => x >= w && x <= e && y >= so && y <= n);
  goCity(c ?? CITY, s.at, s.name);
}
$('sugg').onmousedown = (e) => { const li = e.target.closest('li'); if (li) e.preventDefault(), pick(sugg[li.dataset.i]); };
$('search').onkeydown = (e) => { if (e.key === 'Enter' && sugg.length) pick(sugg[0]); if (e.key === 'Escape') showSugg([]); };
$('search').onblur = () => showSugg([]);

// 2D / 3D toggle
const b2 = document.getElementById('btn-2d'), b3 = document.getElementById('btn-3d');
function setMode3d(on, animate = true) {
  b3.classList.toggle('on', on);
  b2.classList.toggle('on', !on);
  if (animate) map.easeTo({ pitch: on ? 60 : 0, bearing: on ? -20 : 0, duration: 1000 });
}
b2.onclick = () => setMode3d(false);
b3.onclick = () => setMode3d(true);
$('zin').onclick = () => map.zoomIn();
$('zout').onclick = () => map.zoomOut();

// ---- Surface heat: GIBS LST drape + per-building Landsat heat ----
// Ironbow thermal-camera ramp: -1 = 1.5 °C cooler than the local median (violet), 0 = average (red), +1 = hotter (white-hot).
// Scenario: feature-state `cool` 0..1 blends toward cyan (was hottest) / green (was coolest).
const HEAT = ['coalesce', ['feature-state', 'heat'], 0];
const coolBlend = (base) => ['interpolate', ['linear'], ['coalesce', ['feature-state', 'cool'], 0],
  0, base, 1, ['interpolate', ['linear'], HEAT, -1, '#34d399', 1, '#22d3ee']];
const HEAT_COLOR = coolBlend(['interpolate', ['linear'], HEAT, -1, '#5b21b6', -0.5, '#b5179e', 0, '#e5484d', 0.5, '#f59e0b', 1, '#fef3c7']);
const day = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const gibsUrl = (layer, z, d) =>
  `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${layer}/default/${d}/GoogleMapsCompatible_Level${z}/{z}/{y}/{x}.png`;

// Tile [z, y, x] under the city centre.
function tileAt(z, [lon, lat] = CITY.center) {
  const n = 2 ** z, r = (lat * Math.PI) / 180;
  return [z, Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n), Math.floor(((lon + 180) / 360) * n)];
}

// GIBS 404s until a period is processed; probe back from yesterday at the city's tile.
async function latestGibs(layer, z) {
  const [tz, ty, tx] = tileAt(z);
  for (let n = 1; n <= 24; n++) {
    const url = gibsUrl(layer, z, day(n)).replace('{z}', tz).replace('{y}', ty).replace('{x}', tx);
    const ok = await new Promise((r) => { const i = new Image(); i.onload = () => r(true); i.onerror = () => r(false); i.src = url; });
    if (ok) return day(n);
  }
  return day(16);
}

// Landsat mosaic bounds and pixel size (scripts/fetch-landsat.py, fetch-ndvi.py); grey LST encodes 35..50 °C as 0..255.
const LANDSAT = { w: 150.70, e: 151.35, n: -33.55, s: -34.10, t0: 35, t1: 50, px: [2400, 2031], day: '9 January 2026' };
const CORNERS = [[LANDSAT.w, LANDSAT.n], [LANDSAT.e, LANDSAT.n], [LANDSAT.e, LANDSAT.s], [LANDSAT.w, LANDSAT.s]];

// Greyscale PNG over the Landsat bounds → (lon, lat) → 0..1 (null outside the scene / no data).
async function sampler(url) {
  const img = new Image();
  await new Promise((ok, no) => ((img.onload = ok), (img.onerror = no), (img.src = url))); // not decode(): it stalls in hidden tabs
  const cv = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height });
  const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.drawImage(img, 0, 0);
  const px = cx.getImageData(0, 0, img.width, img.height).data, L = LANDSAT;
  return (lon, lat) => {
    const x = Math.floor(((lon - L.w) / (L.e - L.w)) * img.width), y = Math.floor(((L.n - lat) / (L.n - L.s)) * img.height);
    if (x < 0 || y < 0 || x >= img.width || y >= img.height) return null;
    const i = (y * img.width + x) * 4;
    return px[i + 3] ? px[i] / 255 : null;
  };
}

// Recolour the greyscale Landsat scene with the ironbow ramp so the ground matches the buildings. Returns a data URL.
const IRONBOW = ['#5b21b6', '#b5179e', '#e5484d', '#f59e0b', '#fef3c7'].map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
async function ironbow(url) {
  const img = new Image();
  await new Promise((ok, no) => ((img.onload = ok), (img.onerror = no), (img.src = url))); // not decode(): it stalls in hidden tabs
  const cv = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height }), cx = cv.getContext('2d');
  cx.drawImage(img, 0, 0);
  const d = cx.getImageData(0, 0, img.width, img.height), px = d.data, n = IRONBOW.length - 1;
  for (let i = 0; i < px.length; i += 4) {
    const t = (px[i] / 255) * n, k = Math.min(n - 1, Math.floor(t)), f = t - k;
    for (let c = 0; c < 3; c++) px[i + c] = IRONBOW[k][c] + (IRONBOW[k + 1][c] - IRONBOW[k][c]) * f;
  }
  cx.putImageData(d, 0, 0);
  return cv.toDataURL();
}

async function addHeatLayers() {
  // 8-day composite (daily has big cloud/swath gaps).
  const lstLayer = 'MODIS_Terra_L3_Land_Surface_Temp_8Day_Day', drape = ironbow('/data/lst-landsat-gray.png');
  map.addSource('lst', { type: 'raster', tiles: [gibsUrl(lstLayer, 7, await latestGibs(lstLayer, 7))], tileSize: 256, maxzoom: 7, attribution: 'NASA GIBS · MODIS Terra LST 8-day · Landsat: USGS via Microsoft Planetary Computer' });
  map.addLayer({ id: 'lst', type: 'raster', source: 'lst', layout: vis('lst'), paint: { 'raster-opacity': ['interpolate', ['linear'], ['zoom'], 8, 0.6, 10, 0.5, 11, 0] , 'raster-resampling': 'linear' } }, 'building-3d');
  // 100 m Landsat scene takes over from 1 km MODIS at city zoom.
  map.addSource('landsat', { type: 'image', url: await drape, coordinates: CORNERS });
  map.addLayer({ id: 'landsat', type: 'raster', source: 'landsat', layout: vis('landsat'), paint: { 'raster-opacity': ['interpolate', ['linear'], ['zoom'], 9.5, 0, 11, 0.9, 15, 0.75], 'raster-fade-duration': 0 } }, 'building-3d');

  map.addSource('bld', { type: 'geojson', data: EMPTY, attribution: '© OpenStreetMap contributors' });
  map.addLayer({
    id: 'bld-heat', type: 'fill-extrusion', source: 'bld', minzoom: 12,
    paint: {
      'fill-extrusion-color': wallColor(),
      'fill-extrusion-height': ['get', 'height'],
      'fill-extrusion-base': ['get', 'min_height'],
      'fill-extrusion-opacity': 1,
      'fill-extrusion-vertical-gradient': true,
    },
  });
  // Solar paints a thin cap on each roof only, so it mixes with the heat-coloured walls.
  map.addLayer({
    id: 'roofs', type: 'fill-extrusion', source: 'bld', minzoom: 12, layout: vis('roofs'),
    paint: {
      'fill-extrusion-color': SOLAR_COLOR,
      'fill-extrusion-base': ['get', 'height'],
      'fill-extrusion-height': ['+', ['get', 'height'], 0.8],
      'fill-extrusion-opacity': 1,
    },
  });
  // Optimizer picks: a pulsing teal cap above each funded roof (above the solar cap so they never z-fight).
  map.addSource('picks', { type: 'geojson', data: EMPTY });
  map.addLayer({ id: 'picks', type: 'fill-extrusion', source: 'picks', minzoom: 12, paint: {
    'fill-extrusion-color': '#2dd4bf', 'fill-extrusion-base': ['+', ['get', 'height'], 0.8], 'fill-extrusion-height': ['+', ['get', 'height'], 4],
  } });
  // Retrofit program: a cap coloured by each enrolled roof's stage (installed = white). Council view only.
  map.addSource('program', { type: 'geojson', data: EMPTY });
  map.addLayer({ id: 'program', type: 'fill-extrusion', source: 'program', minzoom: 12, layout: { visibility: view === 'council' ? 'visible' : 'none' }, paint: {
    'fill-extrusion-color': ['match', ['get', 'st'], ...Object.entries(STAGES).flatMap(([k, [, c]]) => [k, c]), '#fff'],
    'fill-extrusion-base': ['+', ['get', 'height'], 0.8], 'fill-extrusion-height': ['+', ['get', 'height'], 3],
  } });
  map.addSource('trees', { type: 'geojson', data: EMPTY });
  map.addLayer({ id: 'trees', type: 'fill-extrusion', source: 'trees', minzoom: 12.5, layout: vis('trees'), paint: {
    'fill-extrusion-color': ['get', 'c'],
    'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-base': ['get', 'b'],
    'fill-extrusion-vertical-gradient': true,
  } });
  addPrecinctLayers();
  loadCity();
}

// Per-city data: buildings + heat/solar state, precincts, POI pins, plume source. Re-run on every city switch.
const EMPTY = { type: 'FeatureCollection', features: [] };
const json = (u) => fetch(u).then((r) => r.json());
let landsatP = null, placesP = null, loadSeq = 0, markers = [];
async function loadCity() {
  const c = CITY, seq = ++loadSeq;
  buildings = []; lstMed = 0; scores = [];
  landsatP ??= sampler('/data/lst-landsat-gray.png');
  placesP ??= Promise.all([json('/data/precincts.geojson'), json('/data/pois.geojson')]);
  const [gj, raw, [pre, all]] = await Promise.all([json(`/data/buildings-${c.key}.geojson`), landsatP, placesP]);
  if (seq !== loadSeq) return; // switched again mid-load

  const sample = (lon, lat) => { const v = raw(lon, lat); return v == null ? null : LANDSAT.t0 + v * (LANDSAT.t1 - LANDSAT.t0); };
  // Building colour = Landsat surface temp at its footprint (vertex mean) vs the scene's building median.
  let lst = gj.features.map((f) => sample(...mid(f.geometry.coordinates[0])));
  if (!lst.some((t) => t != null)) lst = proxyLst(gj.features, c.surf);
  gj.features.forEach((f, i) => (f.properties.lst = lst[i]));
  const sorted = lst.filter((t) => t != null).sort((a, b) => a - b), med = sorted[sorted.length >> 1];
  const cityPois = all.features.filter((f) => f.properties.city === c.key);
  energyModel(gj.features, lst, cityPois);
  // Colour by rank of rooftop yield so the ramp spreads evenly.
  const mwh = gj.features.map(roofMWh), solar = rank(mwh);
  gj.features.forEach((f, i) => (f.properties.mwh = mwh[i]));
  map.removeFeatureState({ source: 'bld' });
  map.getSource('bld').setData(gj);
  gj.features.forEach((f, i) => {
    map.setFeatureState({ source: 'bld', id: f.id }, { solar: solar[i] });
  });
  buildings = gj.features;
  lstAt = (lon, lat) => { const t = sample(lon, lat); return t == null ? null : t + dT(); }; lstMed = med; cityPois_ = cityPois;
  warmUp();

  precincts = pre.features.filter((f) => f.properties.city === c.key);
  map.getSource('precincts').setData({ type: 'FeatureCollection', features: precincts });
  pois = all.features.filter((f) => f.properties.city === c.key);
  showPins();
  plumeMarkers.forEach((m) => m.remove());
  plumeMarkers = c.plumes.map(({ at, name }) => new maplibregl.Marker({ element: pin('poi ind', 'Industrial', ICON.factory, `<span class="pin-name">${name}</span><span class="pin-sub">Emission source</span>`), anchor: 'bottom' }).setLngLat(at).addTo(map));
  plumeMarkers.forEach((m) => (m.getElement().style.display = on.has('smoke') ? '' : 'none'));

  treesP = null;
  map.getSource('trees').setData(EMPTY);
  applyLayers(); // also recolours walls for the new city's priority scores
  renderProgram();
  compare(false);
}

// Per-building energy: type (OSM tag, else inferred), floor area, baseline + cooling kWh, and the extra cooling
// local heat adds: roof °C above the city's coolest 10% of roofs. Everything downstream reads these props.
function energyModel(fs, lst, cityPois) {
  const ref = lst.filter((t) => t != null).sort((a, b) => a - b);
  cool10 = ref[Math.floor(ref.length / 10)] ?? 0;
  const near = (p, m) => Math.hypot((p[0] - CITY.center[0]) * 93000, (p[1] - CITY.center[1]) * 111000) < m;
  fs.forEach((f, i) => {
    const q = f.properties, ring = f.geometry.coordinates[0];
    let type = TYPE_OF[q.type], conf = type ? 'osm' : 'inferred';
    if (!type) {
      const poi = cityPois.find((p) => inside(p.geometry.coordinates, ring));
      type = poi ? (poi.properties.type === 'aged' ? 'health' : 'school')
        : q.height > 30 ? (near(mid(ring), 800) ? 'office' : 'apartment')
        : q.area < 60 ? 'other' : q.area < 300 ? 'house' : q.height >= 10 ? 'apartment' : 'retail';
    }
    const e = ENERGY[type], floor = q.area * (q.levels || Math.max(1, Math.round(q.height / 3.2)));
    const kwh = floor * e.eui, cool = kwh * Math.min(0.6, e.cool * (CITY.cool ?? 1));
    Object.assign(q, { seed: i, osm: q.type, type, conf, floor: Math.round(floor), kwh: Math.round(kwh), cool0: cool, lst0: q.lst });
  });
}

// ---- Future projection: Now / 2030 / 2050. Every roof warms by the city's CMIP6 trend; cooling demand grows ENERGY.cdd per °C,
// and the local-heat penalty is still measured against today's coolest 10% of roofs. Everything downstream reads lst / cool_kwh / extra_kwh.
let year = 2026, cool10 = 0, cityPois_ = [];
const dT = () => (year - 2026) * CITY.warm;
function warmUp() {
  const d = dT();
  for (const f of buildings) {
    const q = f.properties;
    q.lst = q.lst0 == null ? null : q.lst0 + d;
    q.cool_kwh = Math.round(q.cool0 * (1 + ENERGY.cdd * d));
    q.extra_kwh = Math.round(q.cool_kwh * ENERGY.perC * Math.max(0, (q.lst0 ?? cool10) + d - cool10));
    // A 100 m pixel under a tower is mostly its shadow and the street, not its roof: damp tall buildings toward average.
    map.setFeatureState({ source: 'bld', id: f.id }, { heat: q.lst == null ? 0 : Math.max(-1, Math.min(1, ((q.lst - lstMed) / 1.5) * Math.min(1, 20 / (q.height || 8)))) });
  }
  priorityInputs(buildings, cityPois_);
}
function setYear(y) {
  year = y;
  for (const b of document.querySelectorAll('#year button')) b.classList.toggle('on', +b.dataset.y === y);
  if (!buildings.length) return;
  warmUp();
  applyLayers(); // legend, panel, priority colours
  if (document.body.classList.contains('scenario')) { if (picks) optimize(); animateTo(target()); }
  if (document.body.classList.contains('compare')) renderCompare();
}
document.querySelectorAll('#year button').forEach((b) => (b.onclick = () => setYear(+b.dataset.y)));

// Percentile rank 0..1 of each value.
function rank(v) {
  const r = [];
  v.map((_, i) => i).sort((a, b) => v[a] - v[b]).forEach((i, k) => (r[i] = k / Math.max(1, v.length - 1)));
  return r;
}

// No Landsat scene: roof °C from big footprints, low rise and distance to green (ranks), plus ~600 m warm/cool patches.
function proxyLst(fs, surf) {
  const a = rank(fs.map((f) => f.properties.area)), g = rank(fs.map((f) => f.properties.dist_green)), h = rank(fs.map((f) => -f.properties.height));
  return fs.map((f, i) => {
    const [x, y] = mid(f.geometry.coordinates[0]), patch = Math.sin(x * 900) * Math.cos(y * 1100) + 0.5 * Math.sin((x + y) * 2300);
    return surf + 3 * (0.4 * a[i] + 0.35 * g[i] + 0.25 * h[i] - 0.5) + 0.8 * patch + 0.6 * (Math.random() - 0.5);
  });
}

const mid =(ring) => [ring.reduce((a, p) => a + p[0], 0) / ring.length, ring.reduce((a, p) => a + p[1], 0) / ring.length];

// Rooftop yield: roof m² × 60% usable × 20% panel efficiency × 80% performance ratio × annual irradiance.
// Every building part has its own roof, so towers made of parts count too.
function roofMWh(f) {
  const ring = f.geometry.coordinates[0], k = Math.cos((ring[0][1] * Math.PI) / 180) * 111320 * 110540;
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  return (Math.abs(a / 2) * k * 0.6 * 0.2 * 0.8 * CITY.ghi) / 1000;
}

// ---- Layers: any mix can be on. Rasters stack; walls show heat (neutral if off); solar paints roof caps only. ----
const SOLAR_COLOR = ['interpolate', ['linear'], ['coalesce', ['feature-state', 'solar'], 0], 0, '#3b2a12', 0.5, '#b45309', 0.85, '#f59e0b', 1, '#fde68a'];
const LAYERS = {
  heat: { ids: ['lst', 'landsat'],
    legend: ['Building surface heat', '#5b21b6, #b5179e 25%, #e5484d 50%, #f59e0b 75%, #fef3c7', 'Cooler', 'Hotter', () => `avg <b>${lstMed ? (lstMed + dT()).toFixed(1) : '--'}°C</b> · ${CITY.surf ? 'summer roofs' : 'Landsat'}`] },
  smoke: { ids: ['smoke', 'plume'],
    legend: ['Aerosol optical depth', '#fef3c7, #f59e0b 50%, #7c2d12', 'Clear', 'Smoky', () => 'NASA MODIS · CAMS'] },
  canopy: { ids: ['canopy', 'ndvi', 'trees'],
    legend: ['Vegetation (NDVI)', '#84cc16, #22c55e 50%, #065f46', 'Sparse', 'Dense', () => 'Landsat 30 m'] },
  solar: { ids: ['roofs'],
    legend: ['Rooftop solar potential', '#3b2a12, #b45309 50%, #f59e0b 85%, #fde68a', 'Low', 'High', () => `${CITY.ghi.toLocaleString()} kWh/m²/yr`] },
  // Priority recolours the building walls (over heat); it has no layers of its own.
  prio: { ids: [],
    legend: ['Retrofit priority', '#1b2a3d, #0f6f6a 40%, #14b8a6 75%, #99f6e4', 'Later', 'Fix first', () => 'savings · payback · vulnerable · heat'] },
};
const OVERLAYS = Object.values(LAYERS).flatMap((l) => l.ids);
const on = new Set(['heat']);
const vis = (id) => ({ visibility: [...on].some((k) => LAYERS[k].ids.includes(id)) ? 'visible' : 'none' });
const wallColor = () => (on.has('prio') && buildings.length ? coolBlend(prioColor()) : on.has('heat') ? HEAT_COLOR : C.bld);

// Each active layer's colour key sits right under its toggle in the layers card.
function renderLegend() {
  for (const k of Object.keys(LAYERS)) {
    const [title, ramp, lo, hi, src] = LAYERS[k].legend, el = $(`lg-${k}`);
    el.title = `${title} · ${src().replace(/<[^>]+>/g, '')}`;
    el.innerHTML = on.has(k) ? `<span>${lo}</span><div class="ramp" style="background:linear-gradient(90deg, ${ramp})"></div><span>${hi}</span>` : '';
  }
}

function toggleLayer(k, state = !on.has(k)) {
  if (state) on.add(k); else on.delete(k);
  applyLayers();
}

function setLayers(keys) {
  on.clear();
  keys.forEach((k) => on.add(k));
  applyLayers();
}

function applyLayers() {
  if (on.has('canopy')) addTrees();
  for (const id of OVERLAYS) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis(id).visibility);
  if (map.getLayer('bld-heat')) map.setPaintProperty('bld-heat', 'fill-extrusion-color', wallColor());
  for (const id of greens) map.setPaintProperty(id, 'fill-color', on.has('canopy') ? '#1f6f3f' : C.green);
  plumeMarkers.forEach((m) => (m.getElement().style.display = on.has('smoke') ? '' : 'none'));
  cancelAnimationFrame(plumeAnim);
  if (on.has('smoke')) plumeAnim = requestAnimationFrame(plumeFrame);
  for (const b of document.querySelectorAll('#layers button')) b.classList.toggle('on', on.has(b.dataset.k));
  renderLegend();
  renderPanel();
}
document.querySelectorAll('#layers button').forEach((b) => (b.onclick = () => toggleLayer(b.dataset.k)));

// Satellite overlays (global GIBS rasters, Landsat NDVI drape) + smoke plume source.
async function addOverlays() {
  const aod = 'MODIS_Combined_Value_Added_AOD', ndvi = 'MODIS_Terra_NDVI_8Day';
  map.addSource('plume', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  // At z16 a pixel is ~2 m, so 40..200 px ≈ 80..400 m puffs; size doubles per zoom level.
  const R = ['+', 40, ['*', 160, ['get', 'a']]];
  map.addLayer({ id: 'plume', type: 'circle', source: 'plume', layout: vis('plume'), paint: {
    'circle-radius': ['interpolate', ['exponential', 2], ['zoom'], 10, ['/', R, 64], 18, ['*', R, 4]],
    'circle-blur': 1,
    'circle-color': ['interpolate', ['linear'], ['get', 'a'], 0, '#f2e3bd', 1, '#a39b8a'],
    'circle-opacity': ['*', 0.6, ['-', 1, ['get', 'a']], ['min', 1, ['*', 8, ['get', 'a']]]],
    'circle-pitch-alignment': 'map', 'circle-pitch-scale': 'map',
  } });
  // 30 m Landsat NDVI (bare ground transparent) takes over from 250 m MODIS at city zoom.
  map.addSource('ndvi', { type: 'image', url: '/data/ndvi-landsat.png', coordinates: CORNERS });
  map.addLayer({ id: 'ndvi', type: 'raster', source: 'ndvi', layout: vis('ndvi'),
    paint: { 'raster-opacity': ['interpolate', ['linear'], ['zoom'], 9.5, 0, 11, 0.85, 16, 0.6], 'raster-fade-duration': 0 } }, 'building-3d');
  const [dAod, dNdvi] = await Promise.all([latestGibs(aod, 6), latestGibs(ndvi, 9)]);
  map.addSource('smoke', { type: 'raster', tiles: [gibsUrl(aod, 6, dAod)], tileSize: 256, maxzoom: 6 });
  map.addLayer({ id: 'smoke', type: 'raster', source: 'smoke', layout: vis('smoke'),
    paint: { 'raster-opacity': ['interpolate', ['linear'], ['zoom'], 4, 0.7, 12, 0.45, 16, 0.3], 'raster-resampling': 'linear' } }, 'building-3d');
  map.addSource('canopy', { type: 'raster', tiles: [gibsUrl(ndvi, 9, dNdvi)], tileSize: 256, maxzoom: 9 });
  map.addLayer({ id: 'canopy', type: 'raster', source: 'canopy', layout: vis('canopy'),
    paint: { 'raster-opacity': ['interpolate', ['linear'], ['zoom'], 6, 0.8, 10, 0.6, 11, 0], 'raster-resampling': 'linear' } }, 'ndvi');
}

// 3D trees. Parramatta: grown from the 30 m NDVI (at most one per pixel, likelier and taller where greener).
// Other cities (Sydney CBD's Landsat scene is cloudy): OSM mapped trees + trees/shrubs scattered in parks and woods.
let treesP = null, ndviP = null;
const DENSITY = { wood: [1 / 70, 0], park: [1 / 300, 1 / 600], scrub: [1 / 900, 1 / 60], grass: [1 / 2500, 1 / 500] }; // [trees, shrubs] per m²
function inRing([x, y], g) {
  let c = false;
  for (let i = 0, j = g.length - 1; i < g.length; j = i++) {
    const [xi, yi] = g[i], [xj, yj] = g[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
async function treeSpots(key) {
  const spots = []; // [lon, lat, greenness 0..1 or -1 for a shrub]
  if (key === 'parramatta') {
    const ndvi = await (ndviP ??= sampler('/data/ndvi-landsat-gray.png'));
    let [w, s, e, n] = [180, 90, -180, -90];
    for (const f of buildings) for (const [x, y] of f.geometry.coordinates[0]) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
    const L = LANDSAT, sx = (L.e - L.w) / L.px[0], sy = (L.n - L.s) / L.px[1];
    for (let x = w; x < e; x += sx) for (let y = s; y < n; y += sy) {
      const v = (ndvi(x, y) ?? 0) * 0.8, at = [x + Math.random() * sx, y + Math.random() * sy]; // NDVI
      if (v >= 0.25 && v < 0.4) { if (Math.random() < 0.25) spots.push([...at, -1]); } // lightly green: shrub tufts
      else if (v >= 0.4 && Math.random() < (v - 0.3) / 0.3) spots.push([...at, Math.min(1, (v - 0.4) / 0.25)]);
    }
    return spots;
  }
  const { features } = await fetch(`/data/green-${key}.geojson`).then((r) => r.json());
  const kx = 111320 * Math.cos((CITY.center[1] * Math.PI) / 180), ky = 110540;
  for (const { properties: { k }, geometry: g } of features) {
    if (k === 'tree') { spots.push([...g.coordinates, 0.3 + 0.7 * Math.random()]); continue; }
    const ring = g.coordinates[0], xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1]);
    const w = Math.min(...xs), e = Math.max(...xs), s = Math.min(...ys), n = Math.max(...ys);
    const box = (e - w) * kx * (n - s) * ky, [dt, ds] = DENSITY[k];
    // ponytail: density applied to the bbox and rejected outside the ring, so thin diagonal parks get fewer; fine for a demo
    for (let i = Math.min(4000, Math.round(box * (dt + ds))); i > 0; i--) {
      const at = [w + Math.random() * (e - w), s + Math.random() * (n - s)];
      if (inRing(at, ring)) spots.push([...at, Math.random() < dt / (dt + ds) ? 0.4 + 0.6 * Math.random() : -1]);
    }
  }
  return spots;
}
function addTrees() {
  if (treesP || !buildings.length) return;
  const seq = loadSeq;
  treesP = treeSpots(CITY.key).then((spots) => {
    if (seq !== loadSeq) return;
    const ky = 1 / 110540, kx = 1 / (111320 * Math.cos((CITY.center[1] * Math.PI) / 180)), features = [];
    const add = (cx, cy, r, b, h, c, sides = 8) => {
      const a0 = Math.random() * Math.PI;
      const ring = Array.from({ length: sides + 1 }, (_, i) => { const a = a0 + (i * 2 * Math.PI) / sides; return [cx + Math.cos(a) * r * kx, cy + Math.sin(a) * r * ky]; });
      features.push({ type: 'Feature', properties: { b, h, c }, geometry: { type: 'Polygon', coordinates: [ring] } });
    };
    const pick = (a) => a[(Math.random() * a.length) | 0];
    // Crown tiers per species, bottom to top: [radius ×r, tier height ×h]. Gum = rounded, poplar = tall narrow, fig = wide flat.
    const SPECIES = [
      { w: 0.55, tiers: [[0.75, 0.3], [1, 0.4], [0.6, 0.3]], trunk: 0.4, cols: ['#4d7c0f', '#5f7f1d', '#3f6212', '#65803a'] },
      { w: 0.2, tiers: [[0.5, 0.35], [0.42, 0.35], [0.25, 0.3]], trunk: 0.2, cols: ['#166534', '#14532d', '#1f6f3a'] },
      { w: 0.25, tiers: [[1.3, 0.55], [0.95, 0.45]], trunk: 0.45, cols: ['#15803d', '#2f7d32', '#3b7a2a'] },
    ];
    for (const [cx, cy, g] of spots) {
      if (g < 0) { add(cx, cy, 1 + Math.random(), 0, 0.8 + Math.random(), pick(['#65a30d', '#84cc16', '#6b8e23']), 6); continue; }
      const r = 3 + 3 * Math.random() + 2 * g, h = 7 + 3 * Math.random() + 10 * g * Math.random();
      let u = Math.random(), sp = SPECIES[0];
      for (const q of SPECIES) if ((u -= q.w) < 0) { sp = q; break; }
      const hs = sp === SPECIES[1] ? h * 1.4 : sp === SPECIES[2] ? h * 0.8 : h, c = pick(sp.cols);
      let z = hs * sp.trunk;
      add(cx, cy, 0.35 + 0.15 * g, 0, z + 0.5, '#5b4636', 6);
      for (const [kr, kh] of sp.tiers) { const t = (hs - hs * sp.trunk) * kh; add(cx, cy, r * kr, z, z + t, c); z += t; }
    }
    map.getSource('trees').setData({ type: 'FeatureCollection', features });
  });
}

// One wind for every source: from the main source toward the city centre (so it crosses the CBD), offsets in lat-degree
// units (east scaled by k). Main plume runs 1.8x that distance; smaller sites get a short ~1.3 km plume at half strength.
function plumeAxes() {
  const [x0, y0] = CITY.plumes[0].at, [x1, y1] = CITY.center, k = Math.cos((y0 * Math.PI) / 180);
  const ex = (x1 - x0) * k, ny = y1 - y0, len = Math.hypot(ex, ny), dx = ex / len, dy = ny / len;
  return CITY.plumes.map(({ at: [x, y] }, i) => { const L = i ? 0.012 : len * 1.8; return { x0: x, y0: y, k, dx, dy, L, W: L * 0.18, q: i ? 15 : 30 }; });
}

// Plumes' PM2.5 contribution (µg/m³) at a point: strongest near each source, thinning downwind and off-axis.
function plumeAt([lon, lat]) {
  return plumeAxes().reduce((sum, { x0, y0, k, dx, dy, L, W, q }) => {
    const ex = (lon - x0) * k, ny = lat - y0, a = (ex * dx + ny * dy) / L, w = -ex * dy + ny * dx;
    return sum + (a <= 0 || a >= 1 ? 0 : q * (1 - a) * Math.exp(-((w / (a * W)) ** 2)));
  }, 0);
}

// Stateless particles: each loops along its source's axis, widening as it ages. First 260 belong to the main source.
const PLUME = Array.from({ length: 420 }, () => [Math.random() * 2 - 1, Math.random()]);
let plumeAnim = 0, plumeMarkers = [];
function plumeFrame(now) {
  const axes = plumeAxes();
  const features = PLUME.map(([r, ph], i) => {
    const j = i < 260 || axes.length < 2 ? 0 : 1 + (i % (axes.length - 1)), { x0, y0, k, dx, dy, L, W } = axes[j];
    const a = (now / (j ? 9000 : 14000) + ph) % 1, s = a * L, w = (r + 0.25 * Math.sin(a * 9 + i)) * a * W;
    return { type: 'Feature', properties: { a }, geometry: { type: 'Point', coordinates: [x0 + (dx * s - dy * w) / k, y0 + dy * s + dx * w] } };
  });
  map.getSource('plume')?.setData({ type: 'FeatureCollection', features });
  plumeAnim = requestAnimationFrame(plumeFrame);
}

// ---- Precincts + POI pins (stats in data/ are illustrative) ----
function $(id) { return document.getElementById(id); }
const ICON = {
  pin: '<svg viewBox="0 0 24 24"><path d="M12 22s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12Z"/><circle cx="12" cy="10" r="2.5"/></svg>',
  sensor: '<svg viewBox="0 0 24 24"><path d="M5 12a7 7 0 0 1 14 0M8.5 12a3.5 3.5 0 0 1 7 0"/><circle cx="12" cy="12" r="1"/><path d="M12 13v8"/></svg>',
  factory: '<svg viewBox="0 0 24 24"><path d="M2 20V10l6 4v-4l6 4V4h4l2 16Z"/></svg>',
  school: '<svg viewBox="0 0 24 24"><path d="M22 10 12 5 2 10l10 5 10-5Z"/><path d="M6 12v5c3 2 9 2 12 0v-5"/></svg>',
  aged: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="4"/><path d="M2 21v-1a6 6 0 0 1 12 0v1"/><circle cx="17" cy="8" r="3"/><path d="M16 15a5 5 0 0 1 6 5v1"/></svg>',
};
let precincts = [], pois = [], selected = null, label = null, live = null, aq = null, buildings = [], lstAt = () => null, lstMed = 0;

function pin(cls, text, icon = '', more = '') {
  const el = document.createElement('div');
  el.className = `pin ${cls}`;
  el.innerHTML = `<div class="pin-body">${icon}<span><span class="pin-short">${text}</span>${more && `<span class="pin-more">${more}</span>`}</span></div><div class="pin-stem"></div>`;
  return el;
}

// Hover detail: facility type + street, and the Landsat surface temp at the site vs the local building average.
function poiMore({ name, kind, street }, [lon, lat]) {
  const t = lstAt(lon, lat), d = t - lstMed;
  const c = d > 0 ? 'hot' : 'cool';
  const heat = t == null ? '' : `<span class="pin-t">Surface<b class="${c}">${t.toFixed(1)}°C</b><i class="${c}">${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(1)}° vs avg</i></span>`;
  return `<span class="pin-name">${name}</span><span class="pin-sub">${[kind, street].filter(Boolean).join(' · ')}</span>${heat}`;
}

// Facilities in the selected precinct, else the whole city box (pois are baked per box).
const poisHere = () => (selected ? pois.filter((f) => inside(f.geometry.coordinates, ringOf(selected.name))) : pois);

// Every pin inside a selected precinct; otherwise a spread-out dozen (greedy, >= 1/6 box width apart, types alternating).
function showPins() {
  let list = poisHere();
  if (!selected) {
    const gap = (CITY.box[2] - CITY.box[0]) / 6, k = Math.cos((CITY.center[1] * Math.PI) / 180), by = (t) => list.filter((f) => f.properties.type === t);
    const [a, b] = [by('school'), by('aged')], mixed = Array.from({ length: Math.max(a.length, b.length) }, (_, i) => [b[i], a[i]]).flat().filter(Boolean);
    list = [];
    for (const f of mixed) {
      const [x, y] = f.geometry.coordinates;
      if (list.length < 12 && list.every(({ geometry: { coordinates: [u, v] } }) => Math.hypot((x - u) * k, y - v) > gap * k)) list.push(f);
    }
  }
  markers.forEach((m) => m.remove());
  markers = list.map((f) => new maplibregl.Marker({ element: pin(`poi ${f.properties.type}`, f.properties.type === 'school' ? 'School' : 'Aged care', ICON[f.properties.type], poiMore(f.properties, f.geometry.coordinates)), anchor: 'bottom' })
    .setLngLat(f.geometry.coordinates).addTo(map));
}

function addPrecinctLayers() {
  const sel = ['boolean', ['feature-state', 'sel'], false];
  map.addSource('precincts', { type: 'geojson', data: EMPTY, promoteId: 'name' });
  const hov = ['boolean', ['feature-state', 'hover'], false], rkN = ['to-number', ['coalesce', ['feature-state', 'rk'], 0]], rk = ['>', rkN, 0];
  map.addLayer({ id: 'precinct-fill', type: 'fill', source: 'precincts', paint: {
    'fill-color': ['case', sel, '#14b8a6', rk, '#c4363c', '#ffffff'],
    'fill-opacity': ['case', sel, 0.12, rk, ['*', 1.4, rkN], hov, 0.06, 0] } }, 'bld-heat');
  // Lines sit on the ground under the 3D buildings (buildings in front hide them) instead of floating over the roofs.
  map.addLayer({ id: 'precinct-casing', type: 'line', source: 'precincts', layout: { 'line-join': 'round' },
    paint: { 'line-color': '#0b1220', 'line-width': ['case', sel, 7, 0], 'line-opacity': 0.7 } }, 'bld-heat');
  map.addLayer({ id: 'precinct-line', type: 'line', source: 'precincts', layout: { 'line-join': 'round' },
    paint: { 'line-color': ['case', sel, '#14b8a6', rk, '#f87171', '#ffffff'], 'line-width': ['case', sel, 3, hov, 2, rk, 1.5, 1.2],
      'line-opacity': ['case', sel, 1, hov, 0.9, rk, 0.85, 0.55] } }, 'bld-heat');
  let hovered = null;
  const hover = (id) => {
    if (hovered) map.setFeatureState({ source: 'precincts', id: hovered }, { hover: false });
    hovered = id;
    if (id) map.setFeatureState({ source: 'precincts', id }, { hover: true });
  };
  map.on('mousemove', 'precinct-fill', (e) => e.features[0].id !== hovered && hover(e.features[0].id));
  map.on('mouseleave', 'precinct-fill', () => hover(null));
  map.on('click', 'precinct-fill', (e) => select(e.features[0].properties.name));
  map.on('click', 'bld-heat', buildingPopup);
  map.on('mouseenter', 'bld-heat', () => (map.getCanvas().style.cursor = 'pointer'));
  map.on('mouseenter', 'precinct-fill', () => (map.getCanvas().style.cursor = 'pointer'));
  map.on('mouseleave', 'precinct-fill', () => (map.getCanvas().style.cursor = ''));
}

// Click a building: name or street address (Nominatim reverse, filled in when it answers), coords, roof heat, solar.
const popup = new maplibregl.Popup({ className: 'bpop', closeButton: false, maxWidth: '280px', offset: 12 });
// Reverse geocode → { name, addr } (name = building/venue name, else street), cached by point.
const geoCache = new Map();
function placeName([lng, lat]) {
  const key = `${lng.toFixed(5)},${lat.toFixed(5)}`;
  if (!geoCache.has(key)) geoCache.set(key, fetch(`https://nominatim.openstreetmap.org/reverse?format=json&zoom=18&lat=${lat}&lon=${lng}`).then((r) => r.json()).then((j) => {
    // Reverse geocoding returns the nearest named object; keep its name only if it's a building or venue, not a sign or bench.
    if (!/^(building|amenity|tourism|office|shop|leisure|historic)$/.test(j.class)) j.name = '';
    const a = j.address ?? {}, street = [a.house_number, a.road].filter(Boolean).join(' ');
    return { name: j.name || street, addr: [j.name ? street : '', a.suburb || a.city_district || a.city].filter(Boolean).join(', ') };
  }).catch(() => ({ name: '', addr: '' })));
  return geoCache.get(key);
}

function buildingPopup(e) {
  const f = buildings.find((b) => b.id === e.features[0].id);
  if (!f) return;
  const { lng, lat } = e.lngLat, p = f.properties, d = p.lst - lstMed;
  const heat = p.lst == null ? '<b>--</b>' : `<b class="${d > 0 ? 'hot' : 'cool'}">${p.lst.toFixed(1)}°C</b><i>${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(1)} vs avg</i>`;
  const pay = p.best_usd ? `<b>${(p.best_cap / p.best_usd).toFixed(1)} yrs</b><i>${money(p.best_usd)}/yr</i>` : '<b>--</b>';
  popup.setLngLat(e.lngLat).setHTML(`<div class="bp-name">${TYPE_NAME[p.type]}</div><div class="bp-addr">&nbsp;</div>` +
    `<div class="bp-grid"><div><span>Roof</span>${heat}</div><div><span>Height</span><b>${Math.round(p.height)} m</b></div>` +
    `<div><span>Solar</span><b>${Math.round(p.mwh)}</b><i>MWh/yr</i></div>` +
    `<div><span>Type</span><b>${TYPE_NAME[p.type]}</b></div><div><span>Best fix</span><b>${p.best ? MEASURES[p.best].name : '--'}</b></div><div><span>Payback</span>${pay}</div></div>` +
    `<div class="bp-prio"><span>Retrofit priority</span><b>${pct(p)}</b><i>± ${band(p)} / 100</i></div><div class="bp-bar"><i style="width:${pct(p)}%"></i></div>${dots(p, true)}` +
    `<div class="bp-xy">${Math.abs(lat).toFixed(5)}° ${lat < 0 ? 'S' : 'N'}, ${Math.abs(lng).toFixed(5)}° ${lng < 0 ? 'W' : 'E'}</div>` + progHtml(f)).addTo(map);
  const el = popup.getElement();
  wireProg(el, f);
  placeName([lng, lat]).then(({ name, addr }) => {
    // Program roofs keep their address, so the council's lists show streets instead of codes.
    const r = prog[pk(f.id)];
    if (r && name && !r.addr) r.addr = [name, addr].filter(Boolean).join(', '), saveProg();
    if (popup.getElement() !== el || !name) return;
    el.querySelector('.bp-name').textContent = name;
    el.querySelector('.bp-addr').textContent = addr ? `${TYPE_NAME[p.type]} · ${addr}` : TYPE_NAME[p.type];
  });
}

function flyToBuilding(f) {
  const [lng, lat] = mid(f.geometry.coordinates[0]);
  map.flyTo({ center: [lng, lat], zoom: 17.5, pitch: 60, duration: 1400 });
  map.once('moveend', () => buildingPopup({ features: [{ id: f.id }], lngLat: { lng, lat } }));
}

function select(name) {
  if (name) compare(false), document.body.classList.remove('fresh');
  if (name === selected?.name) return;
  closeScenario();
  if (selected) map.setFeatureState({ source: 'precincts', id: selected.name }, { sel: false });
  label?.remove();
  const f = precincts.find((p) => p.properties.name === name);
  selected = f?.properties ?? null;
  if (f) {
    map.setFeatureState({ source: 'precincts', id: name }, { sel: true });
    const ring = f.geometry.coordinates[0], xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1]);
    const b = [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]];
    label = new maplibregl.Marker({ element: pin('area', name), anchor: 'bottom' })
      .setLngLat([(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2]).addTo(map);
  }
  showPins();
  renderPanel();
}
$('p-close').onclick = () => (select(null), document.body.classList.add('fresh'));
map.on('zoom', () => document.body.classList.toggle('far', map.getZoom() < 13.5));
document.body.classList.add('far');

function renderPanel() {
  const p = selected ?? CITY;
  $('p-name').textContent = p.name;
  const here = poisHere();
  $('p-schools').textContent = here.filter((f) => f.properties.type === 'school').length;
  $('p-aged').textContent = here.filter((f) => f.properties.type === 'aged').length;
  $('p-pop').textContent = `${(p.population / 1000).toFixed(1)}k`;
  $('p-age').textContent = `${p.age65_pct}%`;
  // Every layer's metric is always shown, whether or not it is on the map. Icon/colour from the toolbar chip.
  $('lrows').innerHTML = Object.keys(LAYERS).filter((k) => k !== 'prio').map((k) => {
    const r = layerRow(k, p) ?? ['', '--', ''], chip = document.querySelector(`#layers [data-k=${k}]`);
    return `<div class="lrow" style="${chip.getAttribute('style')}">${chip.querySelector('svg').outerHTML}` +
      `<div><div class="lrow-l">${r[0] || chip.textContent}</div><div class="lrow-s">${r[2]}</div></div><div class="lrow-v">${r[1]}</div></div>`;
  }).join('');
  if (!live) return;
  const t = live.t + (p.offset || 0) + dT(), d = t - live.ref - dT();
  $('temp').textContent = `${t.toFixed(1)}°C`;
  $('delta').textContent = `${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(1)}°C vs ${CITY.refName}`;
  $('delta').classList.toggle('cool', d < 0);
  const usd = (selected ? within(ringOf(selected.name)) : buildings).reduce((s, f) => s + (f.properties.extra_kwh || 0), 0) * CITY['kwh$'];
  $('extra').innerHTML = buildings.length ? `${CITY.cur}${(Math.round(usd / 100) * 100).toLocaleString()}<small> / yr</small>` : '';
  $('extra-l').textContent = `Extra cooling cost ${year > 2026 ? `by ${year}, ` : ''}caused by local heat`;
}

// ---- Compare areas: every precinct ranked by extra cooling $, roof heat or vulnerable residents ----
let cmpRows = null;
function compare(open) {
  if (!open && !document.body.classList.contains('compare')) return;
  document.body.classList.toggle('compare', open);
  $('explore').classList.toggle('active', !open);
  $('compare').classList.toggle('active', open);
  if (!open) return precincts.forEach((p) => map.setFeatureState({ source: 'precincts', id: p.properties.name }, { rk: null }));
  select(null);
  renderCompare();
}
function renderCompare() {
  // Same sums as the panel: extra cooling as in renderPanel, vulnerable = 65+ residents + the optimizer's per-facility headcounts.
  if (cmpRows?.city !== CITY.key || cmpRows.n !== buildings.length || cmpRows.year !== year) cmpRows = { city: CITY.key, n: buildings.length, year, rows: precincts.map(({ properties: p, geometry: g }) => {
    const ring = g.coordinates[0], b = within(ring), by = {};
    for (const f of b) if (f.properties.best) by[f.properties.best] = (by[f.properties.best] || 0) + f.properties.best_usd;
    const t = b.map((f) => f.properties.lst).filter((v) => v != null).sort((x, y) => x - y);
    const fac = pois.filter((f) => inside(f.geometry.coordinates, ring)).reduce((a, f) => a + (f.properties.type === 'school' ? 450 : 80), 0);
    return { name: p.name, usd: b.reduce((s, f) => s + (f.properties.extra_kwh || 0), 0) * CITY['kwh$'], heat: t[t.length >> 1] ?? lstMed,
      vul: Math.round((p.population * p.age65_pct) / 100) + fac, best: Object.keys(by).sort((x, y) => by[y] - by[x])[0] };
  }) };
  const k = $('c-sort').querySelector('.on').dataset.s, rows = [...cmpRows.rows].sort((a, b) => b[k] - a[k]);
  const vs = rows.map((r) => r[k]), hi = Math.max(...vs), lo = k === 'heat' ? Math.min(...vs) - (hi - Math.min(...vs) || 1) / 3 : 0;
  const fmt = { usd: money, heat: (v) => `${v.toFixed(1)}°C`, vul: (v) => `${(v / 1000).toFixed(1)}k` };
  $('c-list').innerHTML = rows.map((r, i) => `<li data-n="${r.name}" style="--w:${Math.round((100 * (r[k] - lo)) / (hi - lo || 1))}%"><span class="c-rk">${i + 1}</span>` +
    `<div><b>${r.name}</b><small>${[k !== 'usd' && `${fmt.usd(r.usd)}/yr`, k !== 'heat' && `${fmt.heat(r.heat)} roofs`, k !== 'vul' && `${fmt.vul(r.vul)} vulnerable`,
      r.best && MEASURES[r.best].name].filter(Boolean).join(' · ')}</small></div>` +
    `<span class="c-v">${fmt[k](r[k])}</span></li>`).join('');
  rows.forEach((r, i) => map.setFeatureState({ source: 'precincts', id: r.name }, { rk: Math.max(0.06, 0.32 - 0.07 * i) }));
}
$('compare').onclick = () => compare(true);
$('c-sort').onclick = (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  $('c-sort').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
  renderCompare();
};
$('c-list').onclick = (e) => { const li = e.target.closest('li'); if (li) select(li.dataset.n); };

// Panel row for a map layer: [label, value, sub-line] for the selected precinct (or the whole city).
function layerRow(k, p) {
  const area = () => (selected ? within(ringOf(selected.name)) : buildings);
  if (k === 'heat') {
    if (!buildings.length) return null;
    const t = area().map((f) => f.properties.lst).filter((v) => v != null).sort((a, b) => a - b), m = t[t.length >> 1] ?? lstMed, d = m - lstMed;
    // Hot = 1°C+ above the city median, the red end of the building ramp.
    const hot = Math.round((100 * t.filter((v) => v > lstMed + 1).length) / (t.length || 1));
    return ['Roof surface', `${m.toFixed(1)}°C`, `${selected ? `${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(1)}°C vs avg` : CITY.surf ? 'Summer median' : 'Landsat median'} · ${hot}% roofs hot`];
  }
  if (k === 'smoke') {
    if (!aq) return null;
    // CAMS is a ~40 km grid, so precincts differ only by what the plume adds on top.
    const extra = selected ? plumeAt(mid(ringOf(selected.name))) : 0;
    return ['PM2.5', `${(aq.pm2_5 + extra).toFixed(1)} µg/m³`, extra >= 0.1 ? `+${extra.toFixed(1)} from plume · AQI ${aq.us_aqi}` : `AQI ${aq.us_aqi}`];
  }
  if (k === 'canopy') {
    const d = p.tree_cover_pct - 40;
    return ['Tree canopy', `${p.tree_cover_pct}%`, `${Math.abs(d)} pts ${d < 0 ? 'below' : 'above'} 40% target`];
  }
  if (!buildings.length) return null;
  const a = area(), m = a.reduce((s, f) => s + f.properties.mwh, 0);
  return ['Rooftop solar', m >= 1e4 ? `${Math.round(m / 1e3)} GWh/yr` : `${Math.round(m).toLocaleString()} MWh/yr`, `${a.length.toLocaleString()} roofs · ≈ ${Math.round(m / 6).toLocaleString()} homes`];
}

// ---- Scenario simulator: chosen measures on the precinct's buildings; KPIs are sums over them and count up ----
const ZERO = { cool: 0, mwh: 0, usd: 0, capex: 0, pay: 0, n: 0, co2: 0 };
const lev = new Set(Object.keys(MEASURES));
// Chosen measures on one building: [capex, kWh/yr saved]; demand savings capped at 60% of its use, solar on top.
function plan(q) {
  let c = 0, e = 0, pv = 0;
  for (const k of lev) { const [a, b] = retrofit(q, k); c += a; if (k === 'solar') pv += b; else e += b; }
  return [c, Math.min(e, 0.6 * q.kwh) + pv];
}
let cur = { ...ZERO }, ids = [], anim = 0, scnB = [], picks = null, pulse = 0, last = null;
const budget = () => $('s-bud').value * 1e6;

function inside([x, y], ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

const ringOf = (name) => precincts.find((p) => p.properties.name === name).geometry.coordinates[0];
// Any corner inside: big footprints on the edge (Westfield) otherwise stay hot mid-precinct.
const within = (ring) => buildings.filter((f) => f.geometry.coordinates[0].some((p) => inside(p, ring)));

function target() {
  // Optimizer off: the budget funds the best saving-per-$ buildings first.
  let list = picks ? picks.map((c) => c.f) : scnB, capex = 0, kwh = 0, n = 0, left = budget();
  const rows = list.map((f) => plan(f.properties)).filter(([c]) => c > 0);
  if (!picks) rows.sort((a, b) => b[1] / b[0] - a[1] / a[0]);
  for (const [c, e] of rows) if (picks || c <= left) capex += c, kwh += e, n++, left -= c;
  const usd = kwh * CITY['kwh$'];
  return { cool: n ? (picks ? 1 : 0.4 + (0.6 * n) / rows.length) : 0, mwh: kwh / 1000, usd, capex,
    pay: usd ? capex / usd : 0, n, co2: (kwh / 1000) * CITY.co2 };
}

const money = (v) => `${CITY.cur}${v >= 1e6 ? `${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M` : v < 1000 ? Math.round(v) : `${Math.round(v / 1000)}k`}`;
function draw(s) {
  cur = s;
  for (const id of ids) map.setFeatureState({ source: 'bld', id }, { cool: s.cool });
  $('k-usd').textContent = money(s.usd);
  $('k-pay').textContent = `${s.pay.toFixed(1)} yrs`;
  $('k-capex').textContent = money(s.capex);
  $('k-mwh').textContent = Math.round(s.mwh).toLocaleString();
  $('k-co2').textContent = Math.round(s.co2).toLocaleString();
  $('k-n').textContent = Math.round(s.n).toLocaleString();
}

function animateTo(to, ms = 1500) {
  cancelAnimationFrame(anim);
  const from = cur, t0 = performance.now();
  const step = (now) => {
    const p = Math.min(1, (now - t0) / ms), e = 1 - (1 - p) ** 3;
    draw(Object.fromEntries(Object.keys(to).map((k) => [k, from[k] + (to[k] - from[k]) * e])));
    if (p < 1) anim = requestAnimationFrame(step);
  };
  anim = requestAnimationFrame(step);
}

function openScenario() {
  if (!buildings.length || !precincts.length) return;
  if (!selected) return select(precincts[0].properties.name), openScenario();
  if (!on.has('heat')) toggleLayer('heat', true);
  scnB = within(ringOf(selected.name));
  ids = scnB.map((f) => f.id);
  $('s-where').textContent = $('s-where2').textContent = $('r-where').textContent = selected.name;
  document.body.classList.add('scenario');
  draw({ ...ZERO });
  animateTo(target());
  recommend();
}

function closeScenario() {
  cancelAnimationFrame(anim);
  draw({ ...ZERO });
  ids = []; scnB = [];
  clearPicks();
  document.body.classList.remove('scenario');
}

// ---- Budget optimizer: which roofs get the money ----
// Score = the weighted retrofit priority (savings, payback, vulnerable people, heat).
// Greedy fill by score per $ (knapsack heuristic, so "× per $" stays ≥ 1) at each building's cost for the chosen measures until the budget runs out. "× per $" compares against spending
// the same budget evenly over every roof in the precinct (uniform rollout), on the same score.
function optimize() {
  if (!scnB.length) return;
  const kx = Math.cos((CITY.center[1] * Math.PI) / 180) * 111320, ky = 110540;
  const dist = ([x, y], [u, v]) => Math.hypot((x - u) * kx, (y - v) * ky);
  const cand = scnB.map((f) => {
    const c = mid(f.geometry.coordinates[0]);
    let d = 500, near = null;
    for (const p of pois) { const e = dist(c, p.geometry.coordinates); if (!near || e < d) d = e, near = p.properties.name; }
    return { f, c, d, near, cost: plan(f.properties)[0], s: score(f.properties) };
  }).sort((a, b) => b.s / (b.cost || Infinity) - a.s / (a.cost || Infinity));
  // ex = roof °C over the precinct median (offer letters quote it).
  const t = scnB.map((f) => f.properties.lst).filter((v) => v != null).sort((a, b) => a - b), med = t[t.length >> 1] ?? lstMed;
  for (const c of cand) c.ex = Math.max(0, (c.f.properties.lst ?? med) - med);
  let left = budget();
  const chosen = [];
  for (const c of cand) if (c.cost > 0 && c.cost <= left) chosen.push(c), left -= c.cost;
  const sum = (l, k) => l.reduce((a, c) => a + c[k], 0);
  const reach = cand.filter((c) => c.cost > 0); // uniform rollout only covers buildings the chosen measures apply to
  const x = (sum(chosen, 's') / (budget() - left || 1)) / (sum(reach, 's') / (sum(reach, 'cost') || 1));

  // Vulnerable residents: pupils and aged-care residents at facilities within 200 m of a funded roof,
  // plus the precinct's 65+ residents in proportion to its buildings within 200 m of one.
  const close = (pt) => chosen.some((c) => dist(c.c, pt) < 200);
  const fac = pois.filter((p) => close(p.geometry.coordinates)).reduce((a, p) => a + (p.properties.type === 'school' ? 450 : 80), 0);
  const share = cand.filter((c) => close(c.c)).length / (cand.length || 1);
  const res = fac + Math.round(selected.population * (selected.age65_pct / 100) * share);
  last = { x, res, chosen, spent: budget() - left };
  document.body.classList.remove('briefed'); $('s-export').textContent = 'Create council brief';

  for (const f of scnB) map.setFeatureState({ source: 'bld', id: f.id }, { cool: 0 });
  const again = !!picks;
  picks = chosen;
  ids = chosen.map((c) => c.f.id);
  // Roofs already in the program show their stage cap instead of the pulse.
  const fresh = chosen.filter((c) => !prog[pk(c.f.id)]);
  map.getSource('picks').setData({ type: 'FeatureCollection', features: fresh.map((c) => c.f) });
  $('o-send').textContent = fresh.length ? `Review ${fresh.length} offer letters` : 'View offer letters';
  document.body.classList.add('optimized');
  $('o-x').textContent = `${x.toFixed(1)}×`;
  $('o-res').textContent = res.toLocaleString();
  // Top 5: address once Nominatim answers (cached), else type + nearest facility. One row per site: a school's other buildings are skipped.
  // A school's or hospital's buildings merge into one row (summed); sites saving $1k+/yr first, small homes fill leftover rows.
  const site = (c) => /school|health/.test(c.f.properties.type) && c.d < 150 && c.near;
  const rows = [];
  for (const c of chosen) {
    const q = c.f.properties, r = site(c) && rows.find((t) => t.site === site(c));
    if (!q.best) continue;
    if (r) { r.usd += q.best_usd; r.cap += q.best_cap; r.n++; } else rows.push({ c, site: site(c), usd: q.best_usd, cap: q.best_cap, n: 1 });
  }
  const top = [...rows.filter((r) => r.usd >= 1000), ...rows.filter((r) => r.usd < 1000)].slice(0, 5).sort((a, b) => b.c.s - a.c.s);
  $('o-top').innerHTML = top.map(({ c, usd, cap, n }) => {
    const q = c.f.properties;
    return `<li data-i="${chosen.indexOf(c)}"><div><b>${c.near && c.d < 300 ? `Near ${esc(c.near)}` : TYPE_NAME[q.type]}</b>` +
      `<span>${TYPE_NAME[q.type]}${n > 1 ? ` · ${n} buildings` : ''} · ${MEASURES[q.best].name} ${dots(q)}</span></div>` +
      `<div class="t-n"><em>${money(usd)}/yr</em><span>${(cap / usd).toFixed(1)} yrs</span></div></li>`;
  }).join('');
  top.reduce((wait, { c }, i) => wait.then(async () => {
    const hit = geoCache.has(`${c.c[0].toFixed(5)},${c.c[1].toFixed(5)}`), { name } = await placeName(c.c);
    const b = picks === chosen && $('o-top').children[i]?.querySelector('b');
    if (b && name) b.textContent = name;
    if (!hit) await new Promise((r) => setTimeout(r, 1000)); // Nominatim allows ~1 request/s
  }), Promise.resolve());
  cancelAnimationFrame(pulse);
  const beat = (now) => {
    map.setPaintProperty('picks', 'fill-extrusion-color', `hsl(173, 80%, ${45 + 25 * (0.5 + 0.5 * Math.sin(now / 250))}%)`);
    pulse = requestAnimationFrame(beat);
  };
  pulse = requestAnimationFrame(beat);
  // First run: funded roofs fade to cool. Budget drags re-run it: keep them cool, no flicker.
  if (!again) cur = { ...cur, cool: 0 };
  animateTo(target(), again ? 300 : 1500);
}

function clearPicks() {
  cancelAnimationFrame(pulse);
  picks = null;
  map.getSource('picks')?.setData(EMPTY);
  document.body.classList.remove('optimized', 'briefed'); $('s-export').textContent = 'Create council brief';
}

$('o-top').onclick = (e) => {
  const c = picks?.[e.target.closest('li')?.dataset.i];
  if (c) flyToBuilding(c.f);
};

$('p-plan').onclick = openScenario;
$('s-back').onclick = closeScenario;
$('s-reset').onclick = () => {
  for (const id of ids) map.setFeatureState({ source: 'bld', id }, { cool: 0 });
  clearPicks();
  ids = scnB.map((f) => f.id);
  cur = { ...cur, cool: 0 };
  animateTo({ ...ZERO });
};
$('s-opt').onclick = optimize;
const levChanged = () => {
  for (const b of $('levers').children) b.classList.toggle('on', lev.has(b.dataset.m));
  if (rec) showRec();
  if (picks) optimize(); else animateTo(target(), 500);
};
$('levers').onclick = (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (!lev.delete(b.dataset.m)) lev.add(b.dataset.m);
  levChanged();
};

// ---- AI picks the measures: per-measure totals over the precinct → Gemini (/api/rank) orders the top 3 and says why ----
// It only orders and explains the computed numbers. Fallback (no key / offline) = best saving per $.
let rec = null;
const recs = new Map();
async function recommend() {
  const name = selected.name, key = `${CITY.key}:${name}`;
  rec = recs.get(key) ?? null;
  if (rec) return showRec();
  $('ai-list').innerHTML = '<li>Weighing six measures…</li>';
  $('s-ai').classList.remove('on');
  const m = Object.keys(MEASURES).map((k) => {
    let cap = 0, kwh = 0, n = 0, v = 0;
    for (const f of scnB) { const [c, e] = retrofit(f.properties, k); if (c > 0) cap += c, kwh += e, n++, v += f.properties.nV >= 0.5; }
    const usd = kwh * CITY['kwh$'];
    return { key: k, name: MEASURES[k].name, saved_per_yr: money(usd), capex: money(cap), payback_yrs: (cap / (usd || 1)).toFixed(1),
      useful_life_yrs: MEASURES[k].life, buildings_reached: n, vulnerable_buildings_reached: v, r: usd / (cap || 1) };
  }).filter((x) => x.buildings_reached);
  const canned = [...m].sort((a, b) => b.r - a.r).map((x) => ({ key: x.key, why: `${x.saved_per_yr}/yr, ${x.payback_yrs}-yr payback` }));
  let top = [];
  try {
    const r = await fetch('/api/rank', { method: 'POST', body: JSON.stringify({
      city: CITY.name, suburb: name, roof_surface: layerRow('heat', selected)?.slice(1).join(', '), residents: selected.population,
      age65_pct: selected.age65_pct, schools: $('p-schools').textContent, aged_care: $('p-aged').textContent, measures: m.map(({ r, ...x }) => x) }) });
    if (r.ok) top = (await r.json()).top ?? [];
  } catch {}
  top = top.filter((t, i) => m.some((x) => x.key === t?.key) && t.why && top.findIndex((u) => u?.key === t.key) === i).slice(0, 3);
  for (const c of canned) if (top.length < 3 && !top.some((t) => t.key === c.key)) top.push(c);
  top = top.map((t) => ({ ...t, pay: m.find((x) => x.key === t.key).payback_yrs }));
  recs.set(key, top);
  if (selected?.name === name && document.body.classList.contains('scenario')) rec = top, showRec();
}
const M_ICON = {
  roofs: '<svg viewBox="0 0 24 24"><path d="M3 11 12 4l9 7M5 10v10h14V10"/></svg>',
  trees: '<svg viewBox="0 0 24 24"><path d="M12 22v-6M12 16a6 6 0 1 0-5.2-3A4 4 0 0 0 12 16a4 4 0 0 0 5.2-3"/></svg>',
  solar: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5"/></svg>',
  insul: '<svg viewBox="0 0 24 24"><path d="M3 11 12 4l9 7M5 10v10h14V10M9 20v-6h6v6"/></svg>',
  hvac: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="2"/><path d="M12 10c0-4 1-7 4-7s2 5-2 7M14 12c4 0 7 1 7 4s-5 2-7-2M12 14c0 4-1 7-4 7s-2-5 2-7M10 12c-4 0-7-1-7-4s5-2 7 2"/></svg>',
  ctrl: '<svg viewBox="0 0 24 24"><path d="M14 14.8V5a2 2 0 0 0-4 0v9.8a4 4 0 1 0 4 0Z"/></svg>',
};
const M_WHAT = {
  roofs: 'Reflect sun off roofs', trees: 'Shade streets and walls', solar: 'Make power on the roof',
  insul: 'Keep heat out of buildings', hvac: 'Cool more for less power', ctrl: 'Run cooling only when needed',
};
function showRec() {
  // Plain "what it does" + payback; the AI's own reasons (area-wide totals) go to the brief, not here, so nothing clashes with Results.
  $('ai-list').innerHTML = rec.map((t) => `<li data-m="${t.key}" class="${lev.has(t.key) ? 'on' : ''}"><span class="ck"></span>${M_ICON[t.key]}<div><b>${MEASURES[t.key].name}</b>${M_WHAT[t.key]}<i>Pays back in ${t.pay} yrs</i></div></li>`).join('');
  $('ai-why').innerHTML = rec.map((t) => `<li><b>${MEASURES[t.key].name}:</b> ${esc(t.why)}</li>`).join('');
  $('s-ai').closest('.ai').classList.toggle('on', lev.size === rec.length && rec.every((t) => lev.has(t.key)));
}
// Tick a suggested upgrade on or off, same as its lever.
$('ai-list').onclick = (e) => {
  const k = e.target.closest('li')?.dataset.m;
  if (!k) return;
  if (!lev.delete(k)) lev.add(k);
  levChanged();
};
$('s-edit').onclick = () => { const l = $('levers'); l.hidden = !l.hidden; $('s-edit').textContent = l.hidden ? 'Edit' : 'Done'; };
$('s-ai').onclick = () => {
  if (!rec) return;
  lev.clear();
  for (const t of rec) lev.add(t.key);
  levChanged();
};
// ---- Council brief: optimizer facts → Gemini (/api/brief), canned text if no key or offline ----
async function makeBrief() {
  if (document.body.classList.contains('briefed')) return window.print();
  if (!picks) optimize();
  if (!last) return;
  const { x, res, chosen, spent } = last, area = chosen.reduce((a, c) => a + c.f.properties.area, 0);
  // Energy = the scenario's own sums over the funded buildings; ~10 W/m² peak cut per funded roof, ~$180/yr avoided heat-health cost per protected resident.
  const energy = target().usd, health = res * 180, peak = area * 0.01 / 1000;
  const ord = (k) => { const i = rec?.findIndex((t) => t.key === k) ?? -1; return i < 0 ? 9 : i; }; // AI ranking sets the plan's order
  const f = {
    city: CITY.name, precinct: selected.name, air_temp_c: live && (live.t + (selected.offset || 0)).toFixed(1),
    vs_airport_station_c: live && (live.t + (selected.offset || 0) - live.ref).toFixed(1), roof_surface: layerRow('heat', selected)?.slice(1).join(', '),
    pm2_5: aq && (aq.pm2_5 + plumeAt(mid(ringOf(selected.name)))).toFixed(1), residents: selected.population, age65_pct: selected.age65_pct,
    schools: $('p-schools').textContent, aged_care: $('p-aged').textContent,
    budget: `$${(spent / 1e6).toFixed(2)}M`, measures: [...lev].sort((a, b) => ord(a) - ord(b)).map((k) => MEASURES[k].name).join(', '),
    measure_order: rec?.filter((t) => lev.has(t.key)).map((t) => `${MEASURES[t.key].name} (${t.why})`).join('; '), buildings_funded: chosen.length, roof_area_m2: Math.round(area),
    cooling_per_dollar_vs_uniform: `${x.toFixed(1)}x`, vulnerable_residents_protected: res,
    annual_benefit: `${money(energy + health)} (energy ${money(energy)}, health ${money(health)})`,
    payback_years: (spent / (energy + health)).toFixed(1), peak_demand_cut_mw: peak.toFixed(2),
    priority_weights: [...document.querySelectorAll('[data-w]')].map((s) => `${s.parentNode.firstChild.textContent.trim()} ${s.previousElementSibling.textContent}`).join(', '),
    top_targets: [...$('o-top').children].map((li) => li.innerText.replace(/\n/g, ' · ')).join('; '),
  };
  $('s-export').textContent = 'Drafting brief…';
  let b;
  try {
    const r = await fetch('/api/brief', { method: 'POST', body: JSON.stringify(f) });
    b = r.ok ? await r.json() : null;
  } catch {}
  b ??= {
    hazard: `${f.precinct} is at ${f.air_temp_c}°C today, and its hottest funded roofs run up to ${Math.max(0, ...chosen.map((c) => (c.f.properties.lst ?? lstMed) - lstMed)).toFixed(1)}°C over the city median. ${f.residents.toLocaleString()} residents live here, ${f.age65_pct}% aged 65+, alongside ${f.schools} schools and ${f.aged_care} aged-care sites.`,
    plan: `${f.budget} funds ${f.measures.toLowerCase()} on ${f.buildings_funded} buildings (${f.roof_area_m2.toLocaleString()} m² of roof), ranked by savings, payback, vulnerable people and roof heat. That delivers ${f.cooling_per_dollar_vs_uniform} more cooling per dollar than a uniform rollout.`,
    roi: `The program returns ${f.annual_benefit} a year, paying back in ${f.payback_years} years. It cuts peak grid demand by ${f.peak_demand_cut_mw} MW and protects ${res.toLocaleString()} vulnerable residents through the hottest weeks.`,
  };
  $('b-hazard').textContent = b.hazard; $('b-plan').textContent = b.plan; $('b-roi').textContent = b.roi;
  $('b-meta').textContent = `${f.city} · ${new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })}`;
  $('s-export').textContent = 'Print council brief (PDF)';
  document.body.classList.add('briefed');
}
$('s-export').onclick = makeBrief;

// ---- Retrofit program: council offers → owner applies → installed → verified ----
// Council view sends offer letters (one-time code per roof) to the optimizer's funded roofs. Public view lets an owner
// click their building and apply with that code (enrolled at once) or a rates number (applied; council confirms ownership).
// Both views share one status list, kept in this browser for the demo. In production the council view sits behind a
// staff login, letters go to owners from the rates system, and payment waits for an installer invoice + the next Landsat pass.
const STAGES = { offered: ['Offered', '#f59e0b'], applied: ['Applied', '#a78bfa'], enrolled: ['Enrolled', '#38bdf8'], coated: ['Installed', '#f8fafc'], verified: ['Verified', '#22c55e'] };
const NEXT = { applied: ['Confirm ownership', 'enrolled'], enrolled: ['Mark installed', 'coated'], coated: ['Verify with satellite', 'verified'] };
const MINE = { applied: 'The council will confirm you own this property against its rates records before any work.',
  enrolled: "You're enrolled. The council will book a licensed installer.", coated: 'Work done. Waiting for the next satellite pass to confirm.',
  verified: 'Verified: satellite data shows your roof running cooler.' };
let prog = {}, view = 'council', letters = [], li = 0, open = null; // open: stage whose roof list the card shows
try { prog = JSON.parse(localStorage.getItem('tg-program')) ?? {}; } catch {}
const pk = (id) => `${CITY.key}:${id}`;
// Best fix per building from the energy model; falls back to the chosen measures' plan if nothing pays back alone.
const fix = (q) => q.best ? [MEASURES[q.best].name, q.best_cap, q.best_usd] : ['Retrofit', ...plan(q).map((v, i) => (i ? v * CITY['kwh$'] : v))];
const saving = (f) => Math.round(fix(f.properties)[2]).toLocaleString();

function saveProg() {
  try { localStorage.setItem('tg-program', JSON.stringify(prog)); } catch {}
  renderProgram();
}

// Stage caps on the map + the pipeline card. Each stage opens a list of its roofs (newest first); a row flies to the
// building and opens its popup, so the council never hunts the map. "Applied" needs council action, so it's flagged.
function renderProgram() {
  const here = buildings.filter((f) => prog[pk(f.id)]), st = (f) => prog[pk(f.id)].st;
  map.getSource('program')?.setData({ type: 'FeatureCollection', features: here.map((f) => ({ ...f, properties: { ...f.properties, st: st(f) } })) });
  const n = (k) => here.filter((f) => st(f) === k).length;
  const list = here.filter((f) => st(f) === open).sort((a, b) => (prog[pk(b.id)].t ?? 0) - (prog[pk(a.id)].t ?? 0));
  $('prog').innerHTML = '<div class="prog-row"><b>Retrofit program</b>' + Object.entries(STAGES).map(([k, [t, c]]) =>
    `<button data-s="${k}" class="${k === open ? 'on' : ''}${k === 'applied' && n(k) ? ' todo' : ''}" style="--c:${c}">${t} <em>${n(k)}</em></button>`).join('') + '</div>' +
    (open ? `<ol class="prog-list">${list.map((f) => {
      const r = prog[pk(f.id)], t = f.properties.lst;
      return `<li data-id="${f.id}"><b>${esc(r.addr ?? (r.code ? `Roof ${r.code}` : 'Roof (rates application)'))}</b>` +
        `<span>${[t != null && `${t.toFixed(1)}°C roof`, r.addr && r.code, r.via && `via ${r.via}`].filter(Boolean).join(' · ')}</span></li>`;
    }).join('') || '<li class="empty">No roofs at this stage yet</li>'}</ol>` : '');
  $('prog').hidden = !here.length;
}

$('prog').onclick = (e) => {
  const s = e.target.closest('[data-s]')?.dataset.s, id = e.target.closest('[data-id]')?.dataset.id;
  if (s) open = open === s ? null : s, renderProgram();
  const f = id && buildings.find((b) => String(b.id) === id);
  if (f) flyToBuilding(f);
};

// Popup section. Council: stage, code and the next action. Public: savings and an application form; an owner only
// ever sees the status of a building they applied for, never offers to other people.
function progHtml(f) {
  const r = prog[pk(f.id)], badge = (t) => `<div class="bp-st" style="--c:${STAGES[r.st][1]}">${t}</div>`;
  if (view === 'council') {
    if (!r) return '';
    // With the ledger up, "Verify" opens a measurement form and the smart contract decides; offline it just advances.
    // Energy retrofits are checked against meter data, not the satellite.
    const form = r.st === 'coated' && ledger && r.chain?.enrol;
    const label = r.st === 'coated' && (r.ev?.base?.metric ?? metricOf(f.properties)) === 'energy' ? 'Verify with meter data' : NEXT[r.st]?.[0];
    return `<div class="bp-prog">${badge([STAGES[r.st][0], r.code, r.via && `via ${r.via}`].filter(Boolean).join(' · '))}` +
      chainHtml(r) +
      (NEXT[r.st] ? `<button class="bp-btn" data-act="${form ? 'measure' : 'next'}">${label}</button>` : '') +
      (form ? verifyFormHtml(r) : '') + '</div>';
  }
  if (r?.mine) return `<div class="bp-prog">${badge(`Your application: ${STAGES[r.st][0]}`)}<div class="bp-note">${MINE[r.st]}</div>` +
    (r.chain?.enrol ? `<div class="bp-note">Each step is recorded on a public ledger, so the council's decision can be checked by anyone.</div>` : '') + '</div>';
  return `<div class="bp-prog">${r?.st === 'offered' ? badge('This building qualifies for a fully funded energy retrofit. Got a letter? Enter its code.') : ''}<div class="bp-q">${fix(f.properties)[0]} could save about <b>${CITY.cur}${saving(f)}/yr</b> on energy for this building.</div>` +
    '<button class="bp-btn" data-act="apply">Apply for a funded retrofit</button>' +
    '<form class="bp-form" hidden novalidate><input name="email" type="email" placeholder="Your email" autocomplete="email">' +
    '<input name="code" placeholder="Letter code (CP-1234) or rates number" autocomplete="off"><div class="bp-err"></div>' +
    '<button class="bp-btn">Submit application</button></form></div>';
}

function wireProg(el, f) {
  const box = el.querySelector('.bp-prog');
  if (!box) return;
  const redraw = () => { box.outerHTML = progHtml(f); wireProg(el, f); };
  box.onclick = (e) => {
    const act = e.target.dataset.act, r = prog[pk(f.id)];
    if (act === 'apply') e.target.hidden = true, box.querySelector('form').hidden = false, box.querySelector('input').focus();
    if (act === 'measure') e.target.hidden = true, box.querySelector('[data-f=verify]').hidden = false, box.querySelector('[data-f=verify] input').focus();
    if (act === 'check') checkEvidence(f, r, e.target);
    if (act === 'next') {
      r.st = NEXT[r.st][1];
      r.t = Date.now();
      if (r.st === 'enrolled' && !r.via) r.via = 'rates check';
      saveProg(); redraw();
      sync(f, r).then(redraw2);
    }
  };
  // Redraw whichever .bp-prog is current (redraw() replaced the one this closure captured).
  const redraw2 = () => { const b = el.querySelector('.bp-prog'); if (b) b.outerHTML = progHtml(f), wireProg(el, f); };
  const vf = box.querySelector('[data-f=verify]');
  if (vf) wireVerify(vf, f, redraw2);
  const form = box.querySelector('form:not([data-f])');
  if (!form) return;
  const err = (t) => (form.querySelector('.bp-err').textContent = t);
  form.oninput = () => err('');
  form.onkeydown = (e) => e.stopPropagation(); // the popup sits inside the map, whose keyboard handler zooms on "-"
  form.onsubmit = (e) => {
    e.preventDefault();
    const { email, code } = form.elements, c = code.value.trim().toUpperCase(), r = prog[pk(f.id)];
    if (!/^\S+@\S+\.\S+$/.test(email.value.trim())) return err('Enter your email so the council can reply.');
    // Letter code: the letter only reached the rates-record owner, so a match enrols straight away.
    if (/^CP-\d{4}$/.test(c)) {
      if (r?.code !== c) return err("That code isn't for this building. Check your letter.");
      Object.assign(r, { st: r.st === 'offered' ? 'enrolled' : r.st, via: 'letter code', mine: true, t: Date.now() });
    } else if (/^\d{5,}$/.test(c.replace(/[\s-]/g, ''))) {
      prog[pk(f.id)] = { ...r, st: !r || r.st === 'offered' ? 'applied' : r.st, via: r?.via ?? 'rates number', mine: true, t: Date.now() };
    } else return err('Enter the code from your letter, or your rates notice number.');
    saveProg(); redraw();
    sync(f, prog[pk(f.id)]).then(redraw2);
  };
}

// ---- Ledger: pay for measured performance (contracts/RetrofitRegistry.sol via /api/chain, see scripts/chain-server.mjs) ----
// Enrolling a building writes its baseline evidence's SHA-256 to the chain; installing records the date; verifying sends
// the after-work measurement and the contract releases the rebate only if the building improved by the agreed amount.
// Evidence JSON stays with the record here, so anyone can re-hash it and compare with the chain. Offline, the program
// still works and stays in this browser, as before.
// Metric: cool roofs and trees change roof heat (°C over nearby roofs on the same satellite pass, so the weather on the
// day doesn't count); every other measure is judged on annual energy use.
let ledger = null; // /api/chain/status when the chain is up, else null
const ledgerApi = (path, body) => fetch(`/api/chain/${path}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined)
  .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error); return j; });
const sha = async (obj) => '0x' + [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(obj))))]
  .map((b) => b.toString(16).padStart(2, '0')).join('');
const HEAT_MIN = 1.0; // °C less excess heat the program requires before paying (set in the funding agreement)
const ENERGY_SHARE = 0.5; // share of the predicted energy saving that must show up in the meter data
const metricOf = (q) => ((q.best === 'roofs' || q.best === 'trees') && (q.lst0 ?? q.lst) != null ? 'heat' : 'energy');
const fmtGain = (m, v) => (m === 'heat' ? `${v.toFixed(1)}°C` : `${(v / 1000).toFixed(1)} MWh/yr`);
const short = (h) => `${h.slice(0, 8)}…${h.slice(-4)}`;
const cash = (v) => `${CITY.cur}${v >= 1e4 ? `${Math.round(v / 1000)}k` : Math.round(v).toLocaleString()}`;
const txLink = (x) => (x.url ? `<a href="${x.url}" target="_blank" rel="noopener">${short(x.tx)}</a>` : short(x.tx));

// Median of today's satellite roof temperature for buildings within 250 m (not the building itself).
function nearMedian(f) {
  const [x, y] = mid(f.geometry.coordinates[0]), kx = Math.cos((y * Math.PI) / 180) * 111320, ky = 110540;
  const t = buildings.filter((b) => b !== f && (b.properties.lst0 ?? b.properties.lst) != null && (() => {
    const [u, v] = mid(b.geometry.coordinates[0]);
    return Math.hypot((u - x) * kx, (v - y) * ky) < 250;
  })()).map((b) => b.properties.lst0 ?? b.properties.lst).sort((a, b) => a - b);
  return t.length ? { med: t[t.length >> 1], n: t.length } : { med: lstMed, n: 0 }; // no neighbours: the city median
}

function baselineEvidence(f, r) {
  const q = f.properties, metric = metricOf(q), [measure, cap, usd] = fix(q), at = new Date().toISOString();
  const base = { v: 1, kind: 'baseline', building: pk(f.id), place: r.addr ?? null, measure, rebate: Math.round(cap), metric };
  if (metric === 'heat') {
    const roof = q.lst0 ?? q.lst, { med, n } = nearMedian(f), excess = +(roof - med).toFixed(2);
    return { ...base, value: excess, unit: '°C over nearby roofs', min_gain: HEAT_MIN, roof_c: +roof.toFixed(2), nearby_median_c: +med.toFixed(2),
      nearby_roofs: n, radius_m: 250, source: CITY.surf ? 'TerraGrid summer roof heat model (no Landsat scene for this city)' : `Landsat 8 Collection 2 Level-2 surface temperature, ${LANDSAT.day}`, recorded: at };
  }
  const saving = Math.round(usd / CITY['kwh$']);
  return { ...base, value: q.kwh, unit: 'kWh/yr', min_gain: Math.round(saving * ENERGY_SHARE), predicted_saving_kwh: saving,
    source: 'TerraGrid energy model estimate (floor area × benchmark intensity); replace with 12 months of metered use', recorded: at };
}

// Bring the chain up to the record's stage: enrol (with baseline evidence), then mark installed. Verification has its own form.
async function sync(f, r) {
  if (!ledger || !r) return;
  try {
    if ((r.st === 'enrolled' || r.st === 'coated') && !r.chain?.enrol) {
      const ev = baselineEvidence(f, r), hash = await sha(ev);
      const x = await ledgerApi('enrol', { id: pk(f.id), metric: ev.metric, baseline: ev.value, minGain: ev.min_gain, rebate: ev.rebate, evidence: hash });
      r.ev = { base: ev, baseHash: hash };
      r.chain = { enrol: x, last: { ...x, what: 'Enrolled' } };
    }
    if (r.st === 'coated' && r.chain?.enrol && !r.chain.install) {
      const x = await ledgerApi('install', { id: pk(f.id) });
      r.chain.install = x;
      r.chain.last = { ...x, what: 'Installed' };
    }
    delete r.chainErr;
  } catch (e) {
    r.chainErr = e.message;
  }
  saveProg();
  renderLedger();
}

function chainHtml(r) {
  if (r.chainErr) return `<div class="bp-chain err">Ledger: ${esc(r.chainErr)}</div>`;
  if (!r.chain?.last) return ledger && r.st !== 'offered' && r.st !== 'applied' ? '<div class="bp-chain">Recording on the ledger…</div>' : '';
  const b = r.ev?.base, chk = r.check;
  return `<div class="bp-chain"><span class="lk"></span>${r.chain.last.what} on the ledger · block ${r.chain.last.block} · ${txLink(r.chain.last)}` +
    `<button class="lnk" data-act="check">Check evidence</button><span class="bp-chk"></span></div>` +
    (r.st === 'verified' && r.chain.verify ? `<div class="bp-note ok">The contract released the ${cash(b.rebate)} rebate: ` +
      `${fmtGain(b.metric, r.chain.verify.gain)} better, ${fmtGain(b.metric, b.min_gain)} required.${r.ev.after?.simulated ? ' Measurement was a demo value.' : ''}</div>` : '') +
    (r.st === 'coated' && chk ? `<div class="bp-note warn">Not yet: ${fmtGain(b.metric, chk.gain)} better, ${fmtGain(b.metric, b.min_gain)} required. ` +
      'No rebate. Re-check with the next measurement.</div>' : '');
}

const SOURCES = { heat: ['Landsat 8/9 pass', 'Field thermal survey', 'Demo value (simulated)'], energy: ['Smart meter, 12 months', 'Utility bills, 12 months', 'Demo value (simulated)'] };
function verifyFormHtml(r) {
  const b = r.ev?.base;
  if (!b) return '';
  const heat = b.metric === 'heat', need = b.value - b.min_gain;
  return `<form class="bp-form" data-f="verify" hidden novalidate>` +
    `<div class="bp-note">${heat ? `Before: roof ran <b>${b.value.toFixed(1)}°C</b> over nearby roofs. Rebate needs <b>${need.toFixed(1)}°C</b> or less.`
      : `Before: <b>${(b.value / 1000).toFixed(1)} MWh/yr</b>. Rebate needs <b>${(need / 1000).toFixed(1)} MWh/yr</b> or less.`}</div>` +
    `<input name="measured" type="number" step="${heat ? '0.1' : '100'}" placeholder="${heat ? 'Measured: °C over nearby roofs' : 'Measured: kWh per year'}">` +
    `<select name="source">${SOURCES[b.metric].map((s, i) => `<option${i === 2 ? ' selected' : ''}>${s}</option>`).join('')}</select>` +
    '<div class="bp-err"></div><button class="bp-btn">Submit to the contract</button></form>';
}

function wireVerify(form, f, redraw) {
  const err = (t) => (form.querySelector('.bp-err').textContent = t);
  form.oninput = () => err('');
  form.onkeydown = (e) => e.stopPropagation();
  form.onsubmit = async (e) => {
    e.preventDefault();
    const r = prog[pk(f.id)], b = r.ev.base, v = parseFloat(form.elements.measured.value), source = form.elements.source.value;
    if (!Number.isFinite(v)) return err(b.metric === 'heat' ? 'Enter the measured °C over nearby roofs.' : 'Enter the measured kWh per year.');
    const ev = { v: 1, kind: 'after', building: pk(f.id), metric: b.metric, value: b.metric === 'heat' ? +v.toFixed(2) : Math.round(v), unit: b.unit,
      source, simulated: source.startsWith('Demo'), baseline_evidence: r.ev.baseHash, recorded: new Date().toISOString() };
    form.querySelector('button').disabled = true;
    try {
      const hash = await sha(ev), x = await ledgerApi('verify', { id: pk(f.id), measured: ev.value, evidence: hash });
      if (x.verified) Object.assign(r, { st: 'verified', t: Date.now() }), r.chain.verify = x, r.chain.last = { ...x, what: 'Verified' }, r.ev.after = ev, r.ev.afterHash = hash, delete r.check;
      else r.check = { gain: x.gain, tx: x.tx }, r.chain.last = { ...x, what: 'Checked' }, (r.chain.checks ??= []).push(x);
      saveProg(); renderLedger(); redraw();
    } catch (x) {
      err(x.message);
      form.querySelector('button').disabled = false;
    }
  };
}

// Re-hash the evidence held here and compare with what the chain recorded: proof the data wasn't changed afterwards.
async function checkEvidence(f, r, btn) {
  const out = btn.parentElement.querySelector('.bp-chk');
  out.textContent = 'Checking…';
  try {
    const rec = await ledgerApi(`building?id=${encodeURIComponent(pk(f.id))}`);
    const ok = (await sha(r.ev.base)) === rec.baselineEvidence && (!r.ev.after || (await sha(r.ev.after)) === rec.afterEvidence);
    out.className = `bp-chk ${ok ? 'ok' : 'bad'}`;
    out.textContent = ok ? `✓ Evidence matches the ledger (${rec.stage})` : '✗ Evidence here differs from the ledger';
  } catch (e) {
    out.className = 'bp-chk bad';
    out.textContent = e.message;
  }
}

// Deliver screen: where the ledger is, and every transaction on it, newest first.
async function renderLedger() {
  const el = $('ledger');
  if (!el || !document.body.classList.contains('deliver')) return;
  if (!ledger) {
    el.innerHTML = '<div class="eb">Public ledger</div><p class="dlv-empty">Offline. The program is kept in this browser only. Start the blockchain with <code>npm run chain</code> and <code>npm run chain:deploy</code>.</p>';
    return;
  }
  const byTx = {};
  for (const r of Object.values(prog)) for (const x of Object.values(r.chain ?? {}).flat()) if (x?.tx) byTx[x.tx] = r;
  let evs = [];
  try { evs = (await ledgerApi('events')).filter((x) => x.event !== 'VerifierSet').reverse(); } catch {}
  const label = { Enrolled: 'Enrolled', Installed: 'Installed', Verified: 'Verified · rebate released', NotYetImproved: 'Checked · not yet', DataAnchored: 'Sensor data sealed' };
  const net = ledger.network === 'local' ? 'local test chain' : ledger.network;
  el.innerHTML = `<div class="eb">Public ledger</div><p class="led-h"><span class="lk"></span>${net} · contract ` +
    (ledger.explorer ? `<a href="${ledger.explorer}/address/${ledger.address}" target="_blank" rel="noopener">${short(ledger.address)}</a>` : short(ledger.address)) + '</p>' +
    (evs.length ? `<ol class="led">${evs.slice(0, 12).map((x) => {
      const r = byTx[x.tx], who = x.event === 'DataAnchored' ? `${x.readings} readings · ${esc(x.kind)}` : esc(r?.addr ?? (r?.code ? `Roof ${r.code}` : 'Building'));
      const extra = x.event === 'Verified' ? ` · ${fmtGain(x.metric, x.gain)} better · ${cash(x.rebate)}`
        : x.event === 'NotYetImproved' ? ` · ${fmtGain(x.metric, x.gain)} better` : '';
      return `<li class="${x.event}"><b>${label[x.event] ?? x.event}</b><span>${who}${extra}</span><small>block ${x.block} · ${txLink(x)}</small></li>`;
    }).join('')}</ol>` : '<p class="dlv-empty">No transactions yet. Enrol a building to record its baseline.</p>');
}

ledgerApi('status').then((s) => { ledger = s; renderLedger(); }).catch(() => renderLedger());

// Offer letters for the optimizer's funded roofs. They open as drafts to review; "Send all" puts every unsent one into
// the program (new ones keep their draft code, roofs already in the program keep their stage).
let draft = {}, addrT = 0;
const offerRec = (c) => prog[pk(c.f.id)] ?? (draft[c.f.id] ??= { st: 'offered', code: `CP-${1000 + Math.floor(Math.random() * 9000)}`, t: Date.now() });
function sendOffers() {
  if (!last?.chosen.length) return;
  letters = last.chosen;
  draft = {};
  showLetter(0);
}
function sendAll() {
  for (const c of letters) prog[pk(c.f.id)] ??= offerRec(c);
  cancelAnimationFrame(pulse);
  map.getSource('picks').setData(EMPTY);
  $('o-send').textContent = 'View offer letters';
  saveProg();
  renderLetters();
}

const toLine = (c) => {
  const r = offerRec(c), at = mid(c.f.geometry.coordinates[0]);
  return r.addr ?? `Property at ${Math.abs(at[1]).toFixed(5)}° ${at[1] < 0 ? 'S' : 'N'}, ${Math.abs(at[0]).toFixed(5)}° ${at[0] < 0 ? 'W' : 'E'}`;
};
function letterHtml(c) {
  const { f } = c, [m, cap] = fix(f.properties);
  const hot = CITY.surf
    ? `Our heat model estimates your roof runs ${c.ex.toFixed(1)}°C hotter than nearby roofs in summer.`
    : `Satellite data (Landsat 8) shows your roof reached ${f.properties.lst.toFixed(1)}°C on ${LANDSAT.day}, ${c.ex.toFixed(1)}°C hotter than nearby roofs.`;
  const fund = `The council will fund ${m.toLowerCase()} for your building (about ${CITY.cur}${Math.round(cap / 1000).toLocaleString()}k) ` +
    `at no cost to you. It could save around ${CITY.cur}${saving(f)} a year on energy` +
    (c.near && c.d < 400 ? ` and help keep ${c.near}, ${Math.round(c.d)} m away, cooler during heatwaves.` : '.');
  return `<div class="l-top"><span>${CITY.region} retrofit program</span><span>${new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })}</span></div>` +
    `<div class="l-to">To the owner of<b>${esc(toLine(c))}</b></div><h3>Your building qualifies for a fully funded energy retrofit</h3><p>${hot}</p><p>${fund}</p>` +
    `<div class="l-code"><div>Your code <b>${offerRec(c).code}</b></div><span>To accept, open TerraGrid, switch to Public, click your building and enter this code.</span></div>`;
}

function renderLetters() {
  const unsent = letters.filter((c) => !prog[pk(c.f.id)]).length;
  $('l-title').textContent = `Offer letters · ${letters.length}`;
  $('l-list').innerHTML = letters.map((c, i) => {
    const r = prog[pk(c.f.id)], t = c.f.properties.lst;
    return `<li data-i="${i}" class="${i === li ? 'on' : ''}"><span class="l-i">${i + 1}</span><div><b>${esc(offerRec(c).addr ?? `Roof ${offerRec(c).code}`)}</b>` +
      `<small>${[t != null && `${t.toFixed(1)}°C roof`, fix(c.f.properties)[0]].filter(Boolean).join(' · ')}</small></div>` +
      `<span class="l-st${r ? ' sent' : ''}">${r ? STAGES[r.st][0] : 'Draft'}</span></li>`;
  }).join('');
  $('l-paper').innerHTML = letterHtml(letters[li]);
  $('l-n').textContent = `${li + 1} of ${letters.length}`;
  $('l-send').textContent = unsent ? `Send ${unsent === letters.length ? 'all ' : ''}${unsent} letter${unsent > 1 ? 's' : ''}` : 'All letters sent';
  $('l-send').disabled = !unsent;
}

function showLetter(i) {
  li = (i + letters.length) % letters.length;
  renderLetters();
  $('letter').hidden = false;
  $('l-list').children[li]?.scrollIntoView({ block: 'nearest' });
  fillAddrs();
}

// Street addresses fill in one by one (Nominatim allows ~1 request/s); each is kept with its record.
function fillAddrs() {
  clearTimeout(addrT);
  if ($('letter').hidden) return;
  const c = letters.find((x) => !offerRec(x).addr && !offerRec(x).noAddr);
  if (!c) return;
  const r = offerRec(c), at = mid(c.f.geometry.coordinates[0]);
  fetch(`https://nominatim.openstreetmap.org/reverse?format=json&zoom=18&lat=${at[1]}&lon=${at[0]}`).then((x) => x.json()).then((j) => {
    const a = j.address ?? {}, street = [a.house_number, a.road].filter(Boolean).join(' ');
    if (street) r.addr = [street, a.suburb || a.city_district || a.city].filter(Boolean).join(', ');
    else r.noAddr = true;
  }).catch(() => (r.noAddr = true)).finally(() => {
    if (prog[pk(c.f.id)]) saveProg();
    if (!$('letter').hidden) renderLetters();
    addrT = setTimeout(fillAddrs, 1100);
  });
}

$('o-send').onclick = sendOffers;
$('l-prev').onclick = () => showLetter(li - 1);
$('l-next').onclick = () => showLetter(li + 1);
const closeLetters = () => ($('letter').hidden = true);
$('l-close').onclick = closeLetters;
$('letter').onclick = (e) => { if (e.target === $('letter')) closeLetters(); };
$('l-list').onclick = (e) => { const i = e.target.closest('li')?.dataset.i; if (i) showLetter(+i); };
$('l-send').onclick = sendAll;
const printAs = (cls) => {
  document.body.classList.add(cls);
  window.print();
  document.body.classList.remove(cls);
};
$('l-print').onclick = () => printAs('printing-letter');
$('l-print-all').onclick = () => {
  $('l-all').innerHTML = letters.map((c) => `<article class="letter">${letterHtml(c)}</article>`).join('');
  printAs('printing-all');
};
document.addEventListener('keydown', (e) => {
  if ($('letter').hidden || e.target.closest('input')) return;
  if (e.key === 'Escape') closeLetters();
  if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') e.preventDefault(), showLetter(li - 1);
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') e.preventDefault(), showLetter(li + 1);
});

function setView(v) {
  view = v;
  document.body.classList.toggle('public', v === 'public');
  for (const b of document.querySelectorAll('#view button')) b.classList.toggle('on', b.dataset.v === v);
  if (v === 'public') closeScenario();
  popup.remove();
  $('letter').hidden = true;
  if (map.getLayer('program')) map.setLayoutProperty('program', 'visibility', v === 'council' ? 'visible' : 'none');
  // Back in the council view, new applications are the first thing to see.
  if (v === 'council' && buildings.some((f) => prog[pk(f.id)]?.st === 'applied')) open = 'applied', renderProgram();
}
document.querySelectorAll('#view button').forEach((b) => (b.onclick = () => setView(b.dataset.v)));

// Each slider's share of the three weights, next to its label.
function showWeights() {
  const t = W.nS + W.nP + W.nV || 1;
  for (const s of document.querySelectorAll('[data-w]')) s.previousElementSibling.textContent = `${Math.round((100 * W[s.dataset.w]) / t)}%`;
}
showWeights();
// Priority presets set the three weight sliders; moving a slider by hand makes it Custom.
function markPri(b) {
  for (const x of $('s-pri').children) x.classList.toggle('on', x === b);
  $('s-pri-d').textContent = b ? b.dataset.d : 'Your own mix of the three weights.';
}
$('s-pri').onclick = (e) => {
  const b = e.target.closest('button'), s = document.querySelectorAll('[data-w]');
  if (!b) return;
  b.dataset.v.split(',').forEach((v, i) => (s[i].value = v));
  s[0].dispatchEvent(new Event('input', { bubbles: true }));
  markPri(b);
};
document.querySelector('.scn').oninput = (e) => {
  $('s-bud-v').textContent = `A$${(+$('s-bud').value).toFixed(1)}M`;
  const w = e.target.dataset.w;
  if (w) { // weights changed: recolour the priority map
    if (e.isTrusted) markPri(null); // hand-tuned → Custom
    for (const s of document.querySelectorAll('[data-w]')) W[s.dataset.w] = +s.value;
    showWeights();
    if (on.has('prio')) map.setPaintProperty('bld-heat', 'fill-extrusion-color', wallColor()); else toggleLayer('prio', true);
  }
  optimize(); // any slider re-optimizes instantly; the button does the same
};

// ---- Street sensor: Arduino analog probe on A0 over Web Serial (arduino/sensor), one °C number per line ----
let sensorPin = null, sim = 0, base = null, port = null;
const SENSOR_AT = [151.2054, -33.8684]; // 104 Clarence St, Sydney CBD
const GAIN = 1; // on-screen change = GAIN x the change from the first reading (raise to exaggerate)
// Real board readings are sealed on the ledger in batches of 60 (~1 min): a tamper-evident log of the street sensor.
// Simulated fallback readings are never sealed.
let batch = [], sealed = null;
async function seal(t) {
  if (!port || !ledger) return;
  batch.push([Date.now(), +t.toFixed(2)]);
  if (batch.length < 60) return;
  const data = { sensor: 'street', at: SENSOR_AT, readings: batch };
  batch = [];
  try {
    const x = await ledgerApi('anchor', { hash: await sha(data), readings: data.readings.length, kind: 'street sensor (Arduino)' });
    sealed = { ...x, data };
    renderLedger();
  } catch {}
}
function sensorTemp(t) {
  seal(t);
  const html = `<b>${t.toFixed(1)}°C</b> <span class="pin-sub">street sensor</span>`;
  if (!sensorPin) {
    sensorPin = new maplibregl.Marker({ element: pin('sensor', html, ICON.sensor), anchor: 'bottom' }).setLngLat(SENSOR_AT).addTo(map);
    $('sensor-btn').classList.add('on');
  }
  sensorPin.getElement().querySelector('.pin-short').innerHTML = html;
  const el = $('sensor'), d = live ? t - live.t : 0;
  el.hidden = false;
  el.innerHTML = `<i></i>Street sensor <b>${t.toFixed(1)}°C</b>${live ? ` · ${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(1)}°C vs weather model` : ''}` +
    (sealed ? ` · sealed on ledger, block ${sealed.block}` : '');
}
$('sensor-btn').onclick = async () => {
  if (port) return; // already connected; a second open() would fail and start the fallback alongside
  clearInterval(sim);
  try {
    port = await navigator.serial.requestPort();
    await port.open({ baudRate: 9600 });
    const reader = port.readable.pipeThrough(new TextDecoderStream()).getReader();
    for (let buf = '', first = true; ;) {
      const { value, done } = await reader.read();
      if (done) break;
      const lines = (buf += value).split('\n');
      buf = lines.pop();
      // Skip the first line (the board resets on open, so it can be half a number); -127 = DS18B20 not found.
      for (const l of lines.slice(first ? 1 : 0)) {
        const t = parseFloat(l);
        if (t > -40 && t < 85) sensorTemp((base ??= t) + (t - base) * GAIN);
        console.log(`sensor raw ${l.trim()} °C · base ${base} · shown ${(base + (t - base) * GAIN).toFixed(1)} °C`);
      }
      if (lines.length) first = false;
    }
  } catch { // no Web Serial, no board, or picker cancelled: drift near the live air temp so the demo still runs
    port = null;
    sim = setInterval(() => sensorTemp((live?.t ?? 24) + 0.6 + Math.sin(Date.now() / 4000) * 0.3), 500);
  }
};

// ---- Live air temperature (city vs reference point) + air quality (Open-Meteo / CAMS) ----
async function liveTemp() {
  const c = CITY, [[lon, lat], [rlon, rlat]] = [c.center, c.ref];
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat},${rlat}&longitude=${lon},${rlon}&current=temperature_2m,apparent_temperature&timezone=auto`;
  fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=pm2_5,carbon_monoxide,aerosol_optical_depth,us_aqi&timezone=auto`)
    .then((r) => r.json()).then((j) => { if (c === CITY) aq = j.current, renderPanel(); }).catch(() => {});
  try {
    const [par, cbd] = await (await fetch(url)).json();
    if (c !== CITY) return;
    live = { t: par.current.temperature_2m, feels: par.current.apparent_temperature, ref: cbd.current.temperature_2m, time: par.current.time.slice(11) };
    renderPanel();
  } catch {
    $('delta').textContent = 'Live data unavailable';
  }
}
liveTemp();
setInterval(liveTemp, 10 * 60e3);

