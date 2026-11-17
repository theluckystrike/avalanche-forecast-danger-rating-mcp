// Fixtures in test/fixtures/ were downloaded 2026-11-17T12:02Z: the avalanche.org national map layer (87 zones, 29 centers; polygon
// vertices rounded to 4 decimals and thinned to about 120 per ring to keep the file small), five zone products and two Open-Meteo
// geocoder answers. Expected values were computed independently in Python from the same files (~/mcp-servers-work/s1116w3/avalanche/expect.py):
// Alta, Utah (40.58884, -111.63798) is in UAC Salt Lake (1738); Snoqualmie Pass (47.39233, -121.40009) in NWAC 3028; Silverton, Colorado
// (37.81194, -107.66451) in CAIC area 2660; the map has 80 zones with no rating, 2 off season, 1 Moderate (UAC Moab) and 4 Low (CAIC).
// CAIC 2660 product: today Low at all elevations, tomorrow Moderate above treeline; Wet Loose, unlikely, size 1.0 to 1.5 on E, SE, S, SW, W upper.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import {
  parseMap, stripHtml, clip, parseTime, zonesAt, distanceKm, matchZones, locate, whereText, dangerDays, problems,
  avalancheForecast, avalancheDangerMap, avalancheCenters, InputError, UTM, MAP_URL,
} from '../dist/core.js';

const fx = (n) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');
const MAP = fx('map-layer.json');
const PRODUCTS = Object.fromEntries(readdirSync(new URL('./fixtures/', import.meta.url)).filter((n) => n.startsWith('product-'))
  .map((n) => { const m = /^product-([A-Z]+)-(\d+)\.json$/.exec(n); return [`${m[1]}:${m[2]}`, fx(n)]; }));
const NOW = new Date('2026-11-17T12:00:00Z');
const stub = () => {
  const seen = [];
  const f = async (u) => {
    seen.push(u);
    if (u === MAP_URL) return MAP;
    const p = /^https:\/\/api\.avalanche\.org\/v2\/public\/product\?type=forecast&center_id=([A-Z]+)&zone_id=(\d+)$/.exec(u);
    if (p) { if (PRODUCTS[`${p[1]}:${p[2]}`]) return PRODUCTS[`${p[1]}:${p[2]}`]; throw new Error('HTTP 404'); }
    const g = /^https:\/\/geocoding-api\.open-meteo\.com\/v1\/search\?name=([^&]+)&count=10&language=en&format=json&countryCode=US$/.exec(u);
    if (g) { const n = decodeURIComponent(g[1]).toLowerCase(); try { return fx(`geo-${n}.json`); } catch { return '{"generationtime_ms":0.1}'; } }
    throw new Error(`HTTP 404 (no fixture for ${u})`);
  };
  return { f, seen };
};
const zones = parseMap(MAP);

test('map layer parsing: 87 zones, Colorado merged areas named, UTC validity windows, no-rating as null', () => {
  assert.equal(zones.length, 87);
  const caic = zones.find((z) => z.id === 2660);
  assert.equal(caic.name, 'CAIC forecast area 2660');
  assert.equal(caic.danger_level, 1); assert.equal(caic.danger, 'Low');
  assert.equal(caic.valid_to, '2026-11-17T23:30:00.000Z');
  const sl = zones.find((z) => z.id === 1738);
  assert.equal(sl.danger_level, null); assert.equal(sl.danger, 'No rating'); assert.equal(sl.center_id, 'UAC');
  assert.equal(zones.find((z) => z.id === 2355).off_season, true);
  assert.throws(() => parseMap('<html>'), /not JSON/);
});

test('text helpers: HTML stripped and entities decoded, sentence clipping, map-layer times are UTC', () => {
  assert.equal(stripHtml('<p>Don&rsquo;t&nbsp;go <strong>there</strong>.</p><ul><li>High</li><li>Wind</li></ul>'), "Don't go there. - High - Wind");
  assert.equal(clip('One two three. Four five six seven eight.', 20), 'One two three.');
  assert.equal(clip('Alpha beta gamma delta epsilon zeta', 20), 'Alpha beta gamma...');
  assert.equal(parseTime('2026-11-16T23:30:00').toISOString(), '2026-11-16T23:30:00.000Z');
  assert.equal(parseTime('2026-11-16T23:30:00+00:00').toISOString(), '2026-11-16T23:30:00.000Z');
  assert.equal(parseTime(''), null);
});

test('point in zone: Alta UT in Salt Lake, Snoqualmie Pass in 3028, Silverton CO in CAIC 2660; Alta IA in none', () => {
  assert.deepEqual(zonesAt(zones, 40.58884, -111.63798).map((z) => z.id), [1738]);
  assert.deepEqual(zonesAt(zones, 47.39233, -121.40009).map((z) => z.id), [3028]);
  assert.deepEqual(zonesAt(zones, 37.81194, -107.66451).map((z) => z.id), [2660]);
  assert.deepEqual(zonesAt(zones, 42.67359, -95.29055), []);
  assert.equal(distanceKm(zones.find((z) => z.id === 1738), 40.58884, -111.63798), 0);
  assert.ok(distanceKm(zones.find((z) => z.id === 1738), 42.67359, -95.29055) > 1000);
  assert.deepEqual(matchZones(zones, 'Tetons').map((z) => z.id), [2855]);
  assert.deepEqual(matchZones(zones, 'Mt Hood').map((z) => z.id), [3032]);
  assert.deepEqual(matchZones(zones, 'sawtooth').map((z) => z.id), [2906]);
});

test('place lookup: state qualifier, first candidate inside a zone, exact zone names, far places refused', async () => {
  const { f } = stub();
  const a = await locate(f, zones, { place: 'Alta, UT' });
  assert.equal(a.zone.id, 1738); assert.equal(a.matched_by, 'place'); assert.equal(a.place.name, 'Alta, Utah'); assert.equal(a.inside, true);
  const b = await locate(f, zones, { place: 'Alta' });
  assert.equal(b.zone.id, 1738); assert.ok(b.other_places.includes('Alta, Iowa'));
  assert.equal((await locate(f, zones, { place: 'Silverton' })).zone.id, 2660);
  const t = await locate(f, zones, { place: 'Snoqualmie Pass' });
  assert.equal(t.zone.id, 3028); assert.equal(t.matched_by, 'zone name');
  assert.equal((await locate(f, zones, { zone: 'Tetons' })).zone.id, 2855);
  assert.equal((await locate(f, zones, { place: '47.39233, -121.40009' })).zone.id, 3028);
  await assert.rejects(locate(f, zones, { latitude: 25.77, longitude: -80.19 }), (e) => e instanceof InputError && /not inside any US avalanche forecast zone/.test(e.message));
  await assert.rejects(locate(f, zones, {}), InputError);
  await assert.rejects(locate(f, zones, { zone: 'Nowhere Range' }), InputError);
  await assert.rejects(locate(f, zones, { place: 'Qqqzzz' }), InputError);
  await assert.rejects(locate(f, zones, { latitude: 95, longitude: 0 }), InputError);
});

test('product parsing: danger by elevation, problem aspects and size', () => {
  const p = JSON.parse(PRODUCTS['CAIC:2660']);
  assert.deepEqual(dangerDays(p), [
    { day: 'today', above_treeline: 'Low (1)', near_treeline: 'Low (1)', below_treeline: 'Low (1)', highest: 'Low (1)', highest_level: 1 },
    { day: 'tomorrow', above_treeline: 'Moderate (2)', near_treeline: 'Low (1)', below_treeline: 'Low (1)', highest: 'Moderate (2)', highest_level: 2 },
  ]);
  const pr = problems(p);
  assert.equal(pr.length, 1);
  assert.equal(pr[0].name, 'Wet Loose'); assert.equal(pr[0].likelihood, 'unlikely'); assert.equal(pr[0].size, 'D1 to D1.5');
  assert.equal(pr[0].where, 'E, SE, S, SW, W above treeline');
  assert.equal(whereText(['north upper', 'northeast upper', 'east upper', 'southeast upper', 'south upper', 'southwest upper', 'west upper', 'northwest upper', 'north middle']), 'all aspects above treeline; N near treeline');
  assert.deepEqual(dangerDays({ danger: [] }), []);
});

test('avalanche_forecast: Colorado area with ratings, elevation bands, problem and zone names from the product', async () => {
  const { f } = stub();
  const r = await avalancheForecast(f, { place: 'Silverton, CO' }, NOW);
  assert.equal(r.zone.id, 2660);
  assert.equal(r.zone.name, 'CAIC area: Rico Mountains, Northern San Juan Mountains, La Plata Mountains, Southern San Juan Mountains');
  assert.equal(r.danger.level, 1); assert.equal(r.danger.rating, 'Low');
  assert.equal(r.danger_by_elevation[1].above_treeline, 'Moderate (2)');
  assert.equal(r.avalanche_problems[0].name, 'Wet Loose');
  assert.equal(r.product.type, 'forecast'); assert.equal(r.product.expired, false);
  assert.match(r.summary, /Avalanche danger: Low \(1 of 5\)/);
  assert.match(r.summary, /Tomorrow: above treeline Moderate \(2\)/);
  assert.match(r.summary, /Bottom line: Avalanche conditions are generally safe on Tuesday/);
  assert.match(r.more, new RegExp(UTM));
});

test('avalanche_forecast: early-season summary, out-of-season expired product, no product at all', async () => {
  const { f } = stub();
  const s = await avalancheForecast(f, { zone: 'Sawtooth' }, NOW);
  assert.equal(s.zone.name, 'Sawtooth & Western Smoky Mtns'); assert.equal(s.danger.level, null); assert.equal(s.product.type, 'summary');
  assert.match(s.bottom_line, /^A passing storm will bring ~7-11 inches of new snow by Thursday\./);
  assert.match(s.summary, /No danger rating is issued right now \(the center publishes an early or late season summary instead\)/);
  const m = await avalancheForecast(f, { zone: 'Presidential Range' }, NOW);
  assert.equal(m.off_season, true); assert.equal(m.product.expired, true); assert.equal(m.bottom_line, null);
  assert.match(m.summary, /out of season/); assert.match(m.summary, /expired/);
  const g = await avalancheForecast(f, { zone: 'Turnagain Pass and Girdwood' }, NOW);
  assert.equal(g.product, null); assert.equal(g.zone.center_id, 'CNFAIC');
  const u = await avalancheForecast(f, { place: 'Alta, UT' }, NOW);
  assert.equal(u.zone.name, 'Salt Lake'); assert.match(u.summary, /^Alta, Utah is in Salt Lake \(Utah Avalanche Center, UT\)\./);
});

test('avalanche_danger_map and avalanche_centers: counts, state and center filters', async () => {
  const { f } = stub();
  const all = await avalancheDangerMap(f, {}, NOW);
  assert.deepEqual(all.counts, { 'No rating': 80, 'Off season': 2, Moderate: 1, Low: 4 });
  assert.equal(all.zones.length, 87); assert.equal(all.zones[0].name, 'Moab');
  assert.equal((await avalancheDangerMap(f, { rated_only: true }, NOW)).zones.length, 5);
  assert.equal((await avalancheDangerMap(f, { min_level: 2 }, NOW)).zones.length, 1);
  const ut = await avalancheDangerMap(f, { state: 'Utah' }, NOW);
  assert.equal(ut.zones.length, 9); assert.match(ut.summary, /9 forecast zones, 1 Moderate, 8 No rating/);
  assert.equal((await avalancheDangerMap(f, { center: 'nwac' }, NOW)).zones.length, 10);
  await assert.rejects(avalancheDangerMap(f, { state: 'XX' }, NOW), InputError);
  await assert.rejects(avalancheDangerMap(f, { state: 'FL' }, NOW), InputError);
  const c = await avalancheCenters(f, {}, NOW);
  assert.equal(c.centers.length, 29);
  const utc = await avalancheCenters(f, { state: 'UT' }, NOW);
  assert.equal(utc.centers.length, 1); assert.equal(utc.centers[0].center_id, 'UAC'); assert.equal(utc.centers[0].zones.length, 9);
  assert.equal(utc.centers[0].status, 'issuing danger ratings'); assert.equal(utc.centers[0].highest_danger, 'Moderate (2)');
  assert.equal(c.centers.find((x) => x.center_id === 'MWAC').status, 'off season');
});

test('stdio: initialize, tools/list with annotations and a tools/call error over JSON-RPC (offline)', async () => {
  const child = spawn(process.execPath, [new URL('../dist/stdio.js', import.meta.url).pathname], { stdio: ['pipe', 'pipe', 'ignore'] });
  const lines = []; let buf = '';
  const got = (id) => new Promise((res) => { const iv = setInterval(() => { const m = lines.find((l) => l.id === id); if (m) { clearInterval(iv); res(m); } }, 10); });
  child.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { lines.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); } });
  const send = (m) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');
  send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
  assert.equal((await got(1)).result.serverInfo.name, 'avalanche-forecast-danger-rating-mcp');
  send({ method: 'notifications/initialized' });
  send({ id: 2, method: 'tools/list' });
  const tools = (await got(2)).result.tools;
  assert.deepEqual(tools.map((t) => t.name), ['avalanche_forecast', 'avalanche_danger_map', 'avalanche_centers']);
  for (const t of tools) { assert.ok(t.title); assert.equal(t.annotations.readOnlyHint, true); assert.equal(t.annotations.destructiveHint, false); assert.equal(t.annotations.openWorldHint, true); }
  send({ id: 3, method: 'tools/call', params: { name: 'avalanche_danger_map', arguments: { min_level: 9 } } });
  const r3 = await got(3);
  child.kill();
  assert.equal(r3.result?.isError ?? Boolean(r3.error), true);
});
