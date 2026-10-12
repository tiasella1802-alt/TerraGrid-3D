# Changelog

One line per shipped TODO item. Newest first.

- 2026-10-12 — Blockchain verification (IEEE ClimateChain, climate data track): `RetrofitRegistry` smart contract records each funded building's evidence hash and releases the rebate only on measured improvement (roof heat vs neighbours for cool roofs and trees, annual energy for other measures); no double funding, separate council and verifier roles, sensor readings sealed in batches. Dev-server `/api/chain/*`, ledger in the Deliver panel, Check evidence in the popup. Local chain (`npm run chain`) or Sepolia; 14 rule checks in `npm run chain:test`.

- 2026-10-04 — docs: README rewritten for the current app (four steps, energy model, Gemini, sensor) with the required third-party & AI tools disclosure.
- 2026-10-04 — Sensor pin no longer inherits the Sensor button box (styles scoped to #sensor-btn).
- 2026-10-04 — Street sensor pin fixed at 104 Clarence St, Sydney CBD.
- 2026-10-04 — Rail: Assess renamed Explore, step numbers removed.
- 2026-10-04 — No camera move on area select or opening Compare; the view stays put.
- 2026-10-04 — Priority dropdown replaced with four styled preset buttons; Costs & assumptions removed.
- 2026-10-04 — Plan and results panels redesigned: numbered steps (budget, priority presets with fine-tune, AI upgrade checklist with Edit / Why / costs), results led by yearly savings with cost rows and benefit list; image loads no longer stall in hidden tabs.
- 2026-10-04 — Layers card docks left when no panel is open; AI suggestion card rebuilt: icon rows with what each measure does and its payback, separate Use this mix button with applied state.
- 2026-10-04 — Left panel hidden on load and after closing it; selecting an area recentres without zooming out.
- 2026-10-04 — Thermal-camera look: ironbow ramp (violet → magenta → red → amber → white-hot) on buildings, legend and the Landsat ground drape (recoloured in-browser from the greyscale scene, stronger opacity).
- 2026-10-04 — Cooler-than-median buildings now bright blue instead of near-black slate; site opens on the last-picked city (default Sydney CBD), not Parramatta.
- 2026-10-04 — Map UI pass: category-coloured pins with hover cards and far-zoom dots, boundaries on the ground under the 3D buildings (hover, selected casing, red compare ranks), popup priority bar, flat layer icons.
- 2026-10-04 — Item 16b: offer-letter review dialog (recipient list, print one or all, send all, keyboard), cleaner area header, aligned map controls, no rail lines.
- 2026-10-04 — Item 16: UI redesign — map-first layout, workflow rail (Assess / Compare / Plan / Deliver), floating light panels, layers card with inline legends.
- 2026-10-04 — Item 8: Arduino DS18B20 street sensor streams °C over Web Serial to a live map pin and a panel line vs the weather model.
- 2026-10-04 — Item 15: Now / 2030 / 2050 toggle warms roofs by each city's CMIP6 trend; heat colours, extra cooling cost, scenario payback and area ranking all follow the year.
- 2026-10-04 — Item 14: "Compare areas" tab ranks every precinct by extra cooling cost, roof heat or vulnerable residents, with best measure; row click selects the precinct.
- 2026-10-04 — Item 13b: optimizer fills by score per $ and compares against a uniform rollout over reachable buildings only, so "× per $ vs uniform" is never below 1× (Parramatta CBD AI mix 0.9× → 6.1×).
- 2026-10-04 — fix: Gemini model 2.5-flash-lite → 3.5-flash-lite (2.5 retired for new keys; live brief and ranking now work).
- 2026-10-04 — Item 13: "AI recommends" block in the scenario card. Gemini (`/api/rank`) orders the top 3 measures per suburb from computed totals with a short reason each; click applies the mix to the lever chips; the brief follows that order. Fallback ranks by saving per $.
- 2026-10-04 — Item 12b: teammate's program merged onto items 10–12 as the Retrofit program; offer letters and the owner popup quote each building's best fix, capex and saving from the energy model; Public view hides the priority score and confidence dots, and tells owners of offered buildings they qualify.
- 2026-10-04 — Item 7c: cool roof program. Public | Council toggle; council sends coded offer letters to the optimizer's funded roofs, owners apply from the public map with the code or a rates number, stages (Offered → Verified) show as roof caps and a pipeline card.
- 2026-10-04 — docs: item 12b, integration plan and blast radius for teammate PR #1 (cool roof program).
- 2026-10-04 — docs: round 2 TODO (energy model, retrofit measures, priority map, AI ranking, suburb ranking, projections).

- 2026-10-04 — Item 12: "Priority" layer chip colours buildings by retrofit priority (savings, payback, vulnerable people, heat); three weight sliders recolour live and re-rank the optimizer; top-5 list shows address, type, best measure, $/yr, payback; popup adds type, best fix, payback, priority ± band and measured/estimated/missing badges.
- 2026-10-04 — Item 11: six retrofit measure chips (cool roofs, trees, solar, insulation, HVAC, controls); scenario KPIs are now real sums over the precinct's buildings (saved/yr, payback, capex, MWh, CO₂, buildings reached); optimizer prices each building by the chosen measures.
- 2026-10-04 — Item 10: per-building energy model (OSM type, floor area, EUI, cooling share) and a red "$/yr extra cooling from local heat" line under the temperature delta, per precinct or city.
- 2026-10-04 — Trees in every city: OSM mapped trees + park/wood scatter (`scripts/fetch-green.mjs`, `data/green-*.geojson`); Sydney CBD no longer uses its cloudy NDVI, so no trees in the harbour.

- 2026-10-04 — Item 5d: trees get trunks and tiered crowns in three species shapes (round gum, tall narrow, wide spreading) with varied greens, plus shrub tufts on lightly vegetated pixels. No new dependency.
- 2026-10-04 — Docs: documented comprehensive Discord server learnings (submission fields, 30/30/20/20 rubric, video specs, AI disclosure, and mentor tips) in docs/hackathon/discord-learnings.md.
- 2026-10-04 — Preview tunnel (`preview.amsham.net`) runs only with the dev server; `/api/brief` refuses tunnelled requests so the Gemini key stays local-only.
- 2026-10-03 — Item 7b: "Export council brief" drafts a hazard / funded plan / ROI brief via Gemini (`POST /api/brief` Vite middleware, key from `GEMINI_API_KEY`), canned fallback offline; shows in the panel and prints as a clean one-pager.

- 2026-10-03 — Item 7a: budget optimizer in the scenario card ($0.5–5M slider + Optimize): greedy cool-roof fill by heat × area × school/aged-care proximity, funded roofs pulse teal, panel shows cooling-per-$ vs uniform rollout, vulnerable residents protected, top 5 targets (click to fly). Headline delta now vs each city's airport station.

- 2026-10-03 — Repo polish & docs: comprehensive README.md with architecture diagram and data attribution table, MIT License added, .gitignore updated for editor configs, ready for GitHub push.
- 2026-10-03 — Item 6d: roof row shows % of roofs running hot, solar row the roof count, both from the mapped buildings.

- 2026-10-03 — Item 6b: real OSM schools + aged care baked for every city; panel counts them per precinct/city, pins spread out (or all inside a selected precinct). Second real emission source per city sharing the wind.
- 2026-10-03 — Item 6c: address search (Photon suggestions); an address in a modelled city switches to it, selects its precinct and drops an address pin.
- 2026-10-03 — Click any building: popup with its name or street address, suburb, roof °C vs average, height, solar MWh/yr and coordinates.

- 2026-10-03 — City switch pulls back to the globe, loads there, then dives in flat and tilts on landing: worst frame 950 → 158 ms; TODO gains 6b–6d (POIs everywhere, address search, map-aware sidebar, building popup).

- 2026-10-03 — Multi-city: Melbourne CBD, Central London, Sydney CBD and Suva (Fiji) alongside Parramatta, each with baked OSM buildings, heat/solar/scenario, 4–5 precincts and live Open-Meteo; search box switches city with a globe fly; fixed OSM height parsing ("12;15" no longer becomes 1215 m).

- 2026-10-03 — Stat tile shows Residents per precinct instead of Days over 35°C; Sources & assumptions link removed; panel spacing grows with spare height (auto margins) and never overflows (fits down to ~760 px panel height).

- 2026-10-03 — Panel layer rows always coloured and static; Tree cover tile swapped for Days over 35°C per year; panel spacing tightened to fit 855 px-tall windows.

- 2026-10-03 — Item 5c: side panel keeps air temperature as the headline and always lists all four layer metrics for the selected area (active layers coloured, others greyed, click to toggle); panel trimmed to fit without scrolling.

- 2026-10-03 — Item 5b: layers are toggle chips (Heat / Smoke / Canopy / Solar) and mix freely; legend stacks per layer; solar is a roof cap only and counts building parts (Parramatta Square tower now coloured); PM2.5 differs per precinct via the plume model; canopy uses a 30 m Landsat NDVI drape plus 3D trees grown from it.

- 2026-10-03 — Item 5: layer dropdown switches Surface heat / Smoke & aerosol (GIBS AOD + live CAMS PM2.5/AQI + animated plume from Camellia) / Tree canopy (GIBS NDVI, parks brightened) / Solar potential (roof area × irradiance per building); legend and panel headline follow the layer. Location bits moved into one `CITY` config.

- 2026-10-03 — Map credits start collapsed to the (i) icon instead of an open bar.
- 2026-10-03 — POI pins show just School / Aged care; name and details appear on hover.
- 2026-10-03 — Item 3b: POI pins are 10 real OSM schools and aged-care homes (Overpass, curl); pins show the name, hover adds type, street and Landsat surface temp vs the local average.
- 2026-10-03 — Scenario card simulates on open (no Apply button); levers and slider update live; Export brief is the main button, Reset is a small button in the card header.
- 2026-10-03 — Item 4: scenario simulator. CTA swaps the stat tiles for a card (cool roofs / canopy / solar, coverage slider); Apply eases the precinct's buildings to cyan/green over 1.5 s while KPIs count up; slider updates live; Reset reverses; Export brief = window.print() of the panel.
- 2026-10-03 — Feat: clickable precincts (teal outline, name pill, camera ease, panel stats), school/aged-care pins, decluttered no-scroll side panel.
- 2026-10-03 — Fix: Landsat ground drape recoloured to the same thermal ramp as buildings (over ±5 °C), baked locally from the greyscale mosaic.
- 2026-10-03 — Fix: buildings use a thermal-camera ramp (slate blue → yellow → red); legend reduced to one minimal Cooler/Hotter bar.
- 2026-10-03 — Item 2c: buildings use a cool/hot diverging ramp vs the Parramatta average (towers damped); Landsat drape now covers Greater Sydney with feathered edges; OSM buildings widened to ~8×7 km.
- 2026-10-03 — Item 2b: 100 m Landsat surface temperature at city zoom; buildings coloured by real Landsat temp at their footprint; fixed grey roofs (tile/our building z-fight) and missing towers (OSM building parts).
- 2026-10-03 — Fix: MapLibre worker now loads under Vite (basemap and vector tiles were not rendering); LST switched to 8-day composite and faded out at street zoom; session rule to verify visually in Claude in Chrome.
- 2026-10-03 — Item 2: committed Parramatta OSM buildings (3,462) with derived per-building heat via feature-state, NASA GIBS MODIS LST drape (latest available date), live Open-Meteo temperature vs coastal Sydney in the panel.
- 2026-10-03 — Item 1: Vite + MapLibre scaffold, dark-recoloured liberty style on a spinning globe, auto fly-in to Parramatta 3D buildings, static light UI shell (nav, search, layer select, 2D/3D, legend, side panel).
- 2026-10-03 — Planning: session rules (CLAUDE.md/AGENTS.md), TODO build order, verified API notes, research docs moved to docs/hackathon, design reference saved.
- docs: README data wording tightened, one-line estimates note
- docs: README punchline under title
- feat: intro popup on load linking the pitch video (YouTube thumbnail)
