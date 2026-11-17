// Pure core for avalanche-forecast-danger-rating-mcp. The only I/O is keyless reads done through an injected fetchText.
//
// Sources (public, no key):
//   avalanche.org (National Avalanche Center and the US avalanche centers) public API:
//     https://api.avalanche.org/v2/public/products/map-layer
//       GeoJSON of every US forecast zone with the current overall danger (danger_level 1-5, -1 = no rating), travel advice,
//       off_season, the forecast link and the validity window of the current product (start_date/end_date, UTC without a Z).
//     https://api.avalanche.org/v2/public/product?type=forecast&center_id=<CENTER>&zone_id=<feature id>
//       The current product for a zone: product_type forecast or summary, danger by elevation band for the current day and
//       tomorrow (upper/middle/lower = above/near/below treeline), avalanche problems, bottom line and hazard discussion (HTML).
//   Open-Meteo geocoding (place names to coordinates): https://geocoding-api.open-meteo.com/v1/search
//
// Colorado (CAIC) is published to the national map as a few merged forecast areas named "CAIC zone"; the zone names inside an
// area come from the product's forecast_zone list.
import type { FetchText } from './types.js';

export const REPO = 'avalanche-forecast-danger-rating-mcp';
export const SITE = 'https://www.mcpstamp.com';
export const UTM = `utm_source=mcp&utm_medium=${REPO}`;
export const more = () => `${SITE}/servers/?${UTM}`;
export const MAP_URL = 'https://api.avalanche.org/v2/public/products/map-layer';
export const SOURCE = 'avalanche.org public API (National Avalanche Center and the US avalanche centers). Forecasts apply to backcountry terrain, not ski areas or highways. Always read the full forecast on the center\'s site before travelling.';
export const SOURCE_GEO = 'Place names are located with the Open-Meteo geocoding API (GeoNames).';

export class InputError extends Error {}
export class UpstreamError extends Error {}

export const DANGER: Record<number, { rating: string; meaning: string }> = {
  1: { rating: 'Low', meaning: 'Generally safe avalanche conditions. Watch for unstable snow on isolated terrain features.' },
  2: { rating: 'Moderate', meaning: 'Heightened avalanche conditions on specific terrain features. Evaluate snow and terrain carefully; identify features of concern.' },
  3: { rating: 'Considerable', meaning: 'Dangerous avalanche conditions. Careful snowpack evaluation, cautious route-finding and conservative decision-making essential.' },
  4: { rating: 'High', meaning: 'Very dangerous avalanche conditions. Travel in avalanche terrain not recommended.' },
  5: { rating: 'Extreme', meaning: 'Avoid all avalanche terrain.' },
};
export const SCALE_NOTE = 'North American Public Avalanche Danger Scale: 1 Low, 2 Moderate, 3 Considerable, 4 High, 5 Extreme.';

export const STATES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida',
  GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine',
  MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska',
  NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio',
  OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas',
  UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};

export function stateCode(s: unknown): string | null {
  const q = String(s ?? '').trim();
  if (!q) return null;
  const up = q.toUpperCase();
  if (STATES[up]) return up;
  const hit = Object.entries(STATES).find(([, n]) => n.toLowerCase() === q.toLowerCase());
  return hit ? hit[0] : null;
}

// ---------- text helpers ----------

const ENT: Record<string, string> = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', ndash: '-', mdash: '-',
  hellip: '...', deg: ' deg', frac12: '1/2', frac14: '1/4', frac34: '3/4', rarr: '->', larr: '<-', bull: '-', middot: '-', times: 'x',
};

/** HTML to plain text: tags removed, block ends become spaces, entities decoded, whitespace collapsed. */
export function stripHtml(html: unknown): string {
  let s = String(html ?? '');
  s = s.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>/gi, ' ').replace(/<\/(p|li|div|h\d|tr)>/gi, ' ').replace(/<li[^>]*>/gi, ' - ');
  s = s.replace(/<[^>]+>/g, '');
  s = s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
  s = s.replace(/&([a-z0-9]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
  s = s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/ /g, ' ');
  return s.replace(/\s+/g, ' ').replace(/ - - /g, ' - ').trim();
}

/** Cut text at a sentence end at or before max characters (or a word end, with "..."). */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  if (end > max * 0.5) return cut.slice(0, end + 1);
  return cut.slice(0, cut.lastIndexOf(' ') > 0 ? cut.lastIndexOf(' ') : max).replace(/[,;:\s]+$/, '') + '...';
}

/** "2026-11-16T23:30:00" (UTC without a zone, as in the map layer) or an ISO time with an offset, to a Date. */
export function parseTime(s: unknown): Date | null {
  const t = String(s ?? '').trim();
  if (!t) return null;
  const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(t) ? t : `${t}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function localTime(d: Date | null, tz: string | null): string | null {
  if (!d) return null;
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: tz || 'UTC', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
    }).format(d).replace(',', '');
  } catch {
    return d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  }
}

const norm = (s: unknown) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/\bmt\b\.?/g, 'mount').replace(/\bmtns?\b\.?/g, 'mountains').replace(/[^a-z0-9]+/g, ' ').trim();

// ---------- the national map layer ----------

export interface Zone {
  id: number; name: string; center_id: string; center: string; center_link: string | null; state: string; timezone: string | null;
  off_season: boolean; danger_level: number | null; danger: string; travel_advice: string | null; link: string | null;
  valid_from: string | null; valid_to: string | null; warning: unknown; polygons: number[][][][];
}

export function dangerOf(n: unknown): { level: number | null; rating: string } {
  const v = Number(n);
  if (Number.isInteger(v) && v >= 1 && v <= 5) return { level: v, rating: DANGER[v].rating };
  return { level: null, rating: 'No rating' };
}

export function parseMap(body: string): Zone[] {
  let d: any;
  try { d = JSON.parse(body); } catch { throw new UpstreamError('the avalanche.org map layer is not JSON'); }
  const feats: any[] = Array.isArray(d?.features) ? d.features : [];
  if (!feats.length) throw new UpstreamError('the avalanche.org map layer has no forecast zones');
  const zones: Zone[] = [];
  for (const f of feats) {
    const p = f?.properties ?? {};
    const g = f?.geometry ?? {};
    const polys: number[][][][] = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    const dg = dangerOf(p.danger_level);
    const name = String(p.name ?? '').trim();
    zones.push({
      id: Number(f.id), name: name === 'CAIC zone' || !name ? `${p.center_id ?? ''} forecast area ${f.id}`.trim() : name,
      center_id: String(p.center_id ?? ''), center: String(p.center ?? ''), center_link: p.center_link || null, state: String(p.state ?? ''),
      timezone: p.timezone || null, off_season: p.off_season === true, danger_level: dg.level, danger: dg.rating,
      travel_advice: p.travel_advice ? String(p.travel_advice) : null, link: p.link || p.center_link || null,
      valid_from: parseTime(p.start_date)?.toISOString() ?? null, valid_to: parseTime(p.end_date)?.toISOString() ?? null,
      warning: p.warning?.product ?? null, polygons: Array.isArray(polys) ? polys : [],
    });
  }
  return zones;
}

export async function fetchMap(f: FetchText): Promise<Zone[]> {
  const body = await f(MAP_URL, { cacheTtl: 600, timeoutMs: 20000 });
  return parseMap(body);
}

function inRing(ring: number[][], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Even-odd test over every ring of every polygon (holes count once). */
export function containsPoint(z: Zone, lat: number, lon: number): boolean {
  for (const poly of z.polygons) {
    let inside = false;
    for (const ring of poly) if (Array.isArray(ring) && ring.length > 2 && inRing(ring, lon, lat)) inside = !inside;
    if (inside) return true;
  }
  return false;
}

/** Distance in km from a point to the zone boundary (0 when inside), equirectangular. */
export function distanceKm(z: Zone, lat: number, lon: number): number {
  if (containsPoint(z, lat, lon)) return 0;
  const kx = 111.32 * Math.cos((lat * Math.PI) / 180), ky = 110.57;
  let best = Infinity;
  for (const poly of z.polygons) for (const ring of poly) {
    for (let i = 1; i < ring.length; i++) {
      const ax = (ring[i - 1][0] - lon) * kx, ay = (ring[i - 1][1] - lat) * ky;
      const bx = (ring[i][0] - lon) * kx, by = (ring[i][1] - lat) * ky;
      const dx = bx - ax, dy = by - ay;
      const len = dx * dx + dy * dy;
      const t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
      const px = ax + t * dx, py = ay + t * dy;
      best = Math.min(best, Math.sqrt(px * px + py * py));
    }
  }
  return best;
}

export function zonesAt(zones: Zone[], lat: number, lon: number): Zone[] {
  return zones.filter((z) => containsPoint(z, lat, lon));
}

/** Zones whose name (or "<center id> <name>") matches the query; best matches first. */
export function matchZones(zones: Zone[], q: string): Zone[] {
  const n = norm(q);
  if (!n) return [];
  const scored: Array<[number, Zone]> = [];
  for (const z of zones) {
    const zn = norm(z.name);
    const full = norm(`${z.center_id} ${z.name}`);
    let s = 0;
    if (zn === n || full === n) s = 100;
    else if (zn.length > 3 && (` ${n} `).includes(` ${zn} `)) s = 80;
    else if (n.length > 3 && (` ${zn} `).includes(` ${n} `)) s = 60;
    else if (n.length > 3 && zn.startsWith(n)) s = 50;
    if (s) scored.push([s, z]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  const top = scored.length ? scored[0][0] : 0;
  return scored.filter(([s]) => s === top).map(([, z]) => z);
}

// ---------- place lookup ----------

export interface Located {
  zone: Zone; inside: boolean; distance_km: number; matched_by: 'zone name' | 'coordinates' | 'place';
  place: { query: string | null; name: string; admin1: string | null; latitude: number | null; longitude: number | null } | null;
  other_zones_here: string[]; other_places: string[];
}

export interface LocateInput { place?: string; zone?: string; latitude?: number; longitude?: number; center?: string }

const NEAR_KM = 25;

function nearest(zones: Zone[], lat: number, lon: number): { zone: Zone; km: number } {
  let best: { zone: Zone; km: number } | null = null;
  for (const z of zones) {
    const km = distanceKm(z, lat, lon);
    if (!best || km < best.km) best = { zone: z, km };
  }
  return best as { zone: Zone; km: number };
}

function checkLatLon(lat: number, lon: number) {
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) {
    throw new InputError('latitude must be -90 to 90 and longitude -180 to 180.');
  }
}

function byPoint(zones: Zone[], lat: number, lon: number, matched_by: Located['matched_by'], place: Located['place'], other_places: string[]): Located {
  const here = zonesAt(zones, lat, lon);
  if (here.length) {
    // Prefer an in-season zone with a rating when zones overlap.
    here.sort((a, b) => Number(a.off_season) - Number(b.off_season) || (b.danger_level ?? 0) - (a.danger_level ?? 0));
    return { zone: here[0], inside: true, distance_km: 0, matched_by, place, other_zones_here: here.slice(1).map((z) => `${z.name} (${z.center_id})`), other_places };
  }
  const n = nearest(zones, lat, lon);
  const km = Math.round(n.km * 10) / 10;
  if (km > NEAR_KM) {
    throw new InputError(`${place?.name ?? `${lat}, ${lon}`} is not inside any US avalanche forecast zone; the nearest is ${n.zone.name} (${n.zone.center}, ${n.zone.state}) about ${Math.round(km)} km away. ` +
      'Avalanche centers forecast for backcountry mountain terrain in AK, AZ, CA, CO, ID, MT, NH, NM, NY, OR, UT, WA and WY. Give a mountain place or a zone name.');
  }
  return { zone: n.zone, inside: false, distance_km: km, matched_by, place, other_zones_here: [], other_places };
}

export async function locate(f: FetchText, zones: Zone[], a: LocateInput): Promise<Located> {
  if (a.latitude !== undefined && a.latitude !== null && a.longitude !== undefined && a.longitude !== null) {
    const lat = Number(a.latitude), lon = Number(a.longitude);
    checkLatLon(lat, lon);
    return byPoint(zones, lat, lon, 'coordinates', { query: null, name: `${lat}, ${lon}`, admin1: null, latitude: lat, longitude: lon }, []);
  }
  const pool = a.center ? zones.filter((z) => z.center_id.toLowerCase() === String(a.center).trim().toLowerCase()) : zones;
  if (a.center && !pool.length) throw new InputError(`unknown avalanche center "${a.center}". Use avalanche_centers to list center ids such as NWAC, UAC, CAIC, SAC.`);
  const zq = String(a.zone ?? '').trim();
  if (zq) {
    const hits = matchZones(pool, zq);
    if (!hits.length) {
      const names = pool.slice(0, 40).map((z) => `${z.name} (${z.center_id})`).join(', ');
      throw new InputError(`no forecast zone named "${zq}"${a.center ? ` at ${a.center}` : ''}. Zones include: ${names}. Or pass a place or latitude and longitude.`);
    }
    return { zone: hits[0], inside: true, distance_km: 0, matched_by: 'zone name', place: null, other_zones_here: hits.slice(1).map((z) => `${z.name} (${z.center_id}, ${z.state})`), other_places: [] };
  }
  const loc = String(a.place ?? '').trim();
  if (!loc) throw new InputError('give a place (for example "Alta, UT" or "Snoqualmie Pass"), a forecast zone name, or latitude and longitude.');
  const ll = /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/.exec(loc);
  if (ll) return locate(f, zones, { latitude: Number(ll[1]), longitude: Number(ll[2]) });
  // An exact zone name ("Tetons", "Mt Hood", "Salt Lake") wins over a town of the same name.
  const exact = matchZones(pool, loc).filter((z) => norm(z.name) === norm(loc) || norm(`${z.center_id} ${z.name}`) === norm(loc));
  if (exact.length) return { zone: exact[0], inside: true, distance_km: 0, matched_by: 'zone name', place: null, other_zones_here: exact.slice(1).map((z) => `${z.name} (${z.center_id}, ${z.state})`), other_places: [] };

  const parts = loc.split(',').map((s) => s.trim()).filter(Boolean);
  const name = parts[0];
  const st = parts.slice(1).map(stateCode).find((x) => x) ?? null;
  const body = await f(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=10&language=en&format=json&countryCode=US`, { cacheTtl: 86400 * 7, timeoutMs: 15000 });
  let d: any;
  try { d = JSON.parse(body); } catch { throw new UpstreamError('the Open-Meteo geocoder returned something that is not JSON'); }
  let results: any[] = Array.isArray(d?.results) ? d.results : [];
  if (st) results = results.filter((r) => String(r.admin1 ?? '').toLowerCase() === STATES[st].toLowerCase());
  if (!results.length) {
    const fuzzy = matchZones(pool, loc);
    if (fuzzy.length) return { zone: fuzzy[0], inside: true, distance_km: 0, matched_by: 'zone name', place: null, other_zones_here: fuzzy.slice(1).map((z) => `${z.name} (${z.center_id}, ${z.state})`), other_places: [] };
    throw new InputError(`no US place called "${loc}" was found. Try "Town, ST" (for example "Alta, UT"), a forecast zone name, or latitude and longitude.`);
  }
  const label = (r: any) => [r.name, r.admin1].filter(Boolean).join(', ');
  // The first candidate that lies inside (or near) a forecast zone: "Alta" finds Alta, Utah, not Alta, Iowa.
  let pick = results[0];
  for (const r of results) {
    const lat = Number(r.latitude), lon = Number(r.longitude);
    if (zonesAt(pool, lat, lon).length) { pick = r; break; }
  }
  if (!zonesAt(pool, Number(pick.latitude), Number(pick.longitude)).length) {
    let bestKm = Infinity;
    for (const r of results) {
      const km = nearest(pool, Number(r.latitude), Number(r.longitude)).km;
      if (km < bestKm) { bestKm = km; pick = r; }
    }
  }
  const others = results.filter((r) => r !== pick).slice(0, 4).map(label);
  return byPoint(pool, Number(pick.latitude), Number(pick.longitude), 'place',
    { query: loc, name: label(pick), admin1: pick.admin1 ?? null, latitude: Number(pick.latitude), longitude: Number(pick.longitude) }, others);
}

// ---------- the zone product ----------

export const BANDS: Array<[string, string]> = [['upper', 'above treeline'], ['middle', 'near treeline'], ['lower', 'below treeline']];
const ASPECTS: Record<string, string> = {
  north: 'N', northeast: 'NE', east: 'E', southeast: 'SE', south: 'S', southwest: 'SW', west: 'W', northwest: 'NW',
};
const ELEV: Record<string, string> = { upper: 'above treeline', middle: 'near treeline', lower: 'below treeline' };

export interface DangerDay { day: string; above_treeline: string; near_treeline: string; below_treeline: string; highest: string; highest_level: number | null }
export interface Problem { rank: number | null; name: string; likelihood: string | null; size: string | null; where: string | null; description: string | null }

export function dangerDays(product: any): DangerDay[] {
  const rows: any[] = Array.isArray(product?.danger) ? product.danger : [];
  const out: DangerDay[] = [];
  for (const r of rows) {
    const vals = BANDS.map(([k]) => dangerOf(r?.[k]));
    if (vals.every((v) => v.level === null)) continue;
    const top = vals.reduce((m, v) => ((v.level ?? 0) > (m.level ?? 0) ? v : m), vals[0]);
    const lab = (v: { level: number | null; rating: string }) => (v.level ? `${v.rating} (${v.level})` : 'No rating');
    out.push({
      day: r?.valid_day === 'current' ? 'today' : String(r?.valid_day ?? ''),
      above_treeline: lab(vals[0]), near_treeline: lab(vals[1]), below_treeline: lab(vals[2]),
      highest: lab(top), highest_level: top.level,
    });
  }
  return out;
}

export function whereText(location: unknown): string | null {
  const locs: string[] = Array.isArray(location) ? location.map(String) : [];
  if (!locs.length) return null;
  const by: Record<string, string[]> = {};
  for (const l of locs) {
    const m = /^\s*(north|northeast|east|southeast|south|southwest|west|northwest)\s+(upper|middle|lower)\s*$/i.exec(l);
    if (!m) continue;
    (by[m[2].toLowerCase()] ??= []).push(ASPECTS[m[1].toLowerCase()]);
  }
  const order = Object.values(ASPECTS);
  const parts = ['upper', 'middle', 'lower'].filter((e) => by[e]).map((e) => {
    const a = [...new Set(by[e])].sort((x, y) => order.indexOf(x) - order.indexOf(y));
    return `${a.length === 8 ? 'all aspects' : a.join(', ')} ${ELEV[e]}`;
  });
  return parts.length ? parts.join('; ') : locs.join(', ');
}

export function problems(product: any): Problem[] {
  const rows: any[] = Array.isArray(product?.forecast_avalanche_problems) ? product.forecast_avalanche_problems : [];
  return rows.map((p) => {
    const sz = (Array.isArray(p?.size) ? p.size : []).map((s: unknown) => Number(s)).filter((n: number) => Number.isFinite(n) && n > 0);
    const size = sz.length ? (sz.length > 1 && sz[0] !== sz[sz.length - 1] ? `D${sz[0]} to D${sz[sz.length - 1]}` : `D${sz[0]}`) : null;
    const desc = stripHtml(p?.discussion);
    return {
      rank: Number.isFinite(Number(p?.rank)) ? Number(p.rank) : null, name: String(p?.name ?? 'Avalanche problem'),
      likelihood: p?.likelihood ? String(p.likelihood) : null, size, where: whereText(p?.location), description: desc ? clip(desc, 300) : null,
    };
  }).sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
}

export async function fetchProduct(f: FetchText, center: string, zoneId: number): Promise<any | null> {
  const url = `https://api.avalanche.org/v2/public/product?type=forecast&center_id=${encodeURIComponent(center)}&zone_id=${zoneId}`;
  let body: string;
  try { body = await f(url, { cacheTtl: 600, timeoutMs: 20000 }); } catch (e) {
    if (/HTTP 404/.test((e as Error).message)) return null;
    throw e;
  }
  if (!body.trim() || body.trim() === 'null' || body.trim() === '{}') return null;
  try { return JSON.parse(body); } catch { throw new UpstreamError('the avalanche.org product is not JSON'); }
}

/** Names of the zones a merged area (Colorado "CAIC zone") covers, from the product. */
export function areaZoneNames(product: any): string[] {
  const zs: any[] = Array.isArray(product?.forecast_zone) ? product.forecast_zone : [];
  return [...new Set(zs.map((z) => String(z?.name ?? '').trim()).filter(Boolean))];
}

// ---------- tools ----------

const dangerText = (z: Zone) => (z.danger_level ? `${z.danger} (${z.danger_level} of 5)` : 'no danger rating');

export async function avalancheForecast(f: FetchText, a: LocateInput & { include_discussion?: boolean }, now: Date = new Date()) {
  const zones = await fetchMap(f);
  const loc = await locate(f, zones, a);
  const z = loc.zone;
  const product = await fetchProduct(f, z.center_id, z.id);
  const merged = /forecast area \d+$/.test(z.name);
  const areaNames = merged ? areaZoneNames(product) : [];
  const zoneName = merged && areaNames.length ? `${z.center_id} area: ${areaNames.join(', ')}` : z.name;
  const published = parseTime(product?.published_time);
  const expires = parseTime(product?.expires_time);
  const expired = expires ? expires.getTime() < now.getTime() : null;
  const type = product?.product_type ? String(product.product_type) : null;
  const days = product && !expired ? dangerDays(product) : [];
  const probs = product && !expired ? problems(product) : [];
  // An expired product (a spring summary in November) is not today's advice: keep only its dates.
  const bottom = expired ? '' : stripHtml(product?.bottom_line);
  const discussion = expired ? '' : stripHtml(product?.hazard_discussion);
  const tz = z.timezone;

  const lines: string[] = [];
  const where = loc.matched_by === 'zone name' ? '' : loc.inside ? `${loc.place?.name} is in ` : `${loc.place?.name} is ${loc.distance_km} km outside the nearest zone, `;
  lines.push(`${where}${zoneName} (${z.center}, ${z.state}).`);
  if (z.off_season) {
    lines.push(`The center is out of season: no current forecast${z.travel_advice ? `. ${z.travel_advice}` : '.'}`);
  } else if (z.danger_level) {
    lines.push(`Avalanche danger: ${dangerText(z)}. ${DANGER[z.danger_level].meaning}`);
  } else {
    lines.push('No danger rating is issued right now' + (type === 'summary' ? ' (the center publishes an early or late season summary instead).' : '.'));
  }
  for (const d of days) lines.push(`${d.day === 'today' ? 'Today' : d.day === 'tomorrow' ? 'Tomorrow' : d.day}: above treeline ${d.above_treeline}, near treeline ${d.near_treeline}, below treeline ${d.below_treeline}.`);
  for (const p of probs) lines.push(`Problem ${p.rank ?? ''}: ${p.name}${p.likelihood ? `, ${p.likelihood}` : ''}${p.size ? `, size ${p.size}` : ''}${p.where ? `, on ${p.where}` : ''}.`.replace('Problem :', 'Problem:'));
  if (bottom) lines.push(`Bottom line: ${clip(bottom, 500)}`);
  else if (discussion) lines.push(`${type === 'summary' ? 'Summary' : 'Discussion'}: ${clip(discussion, 500)}`);
  if (expired) lines.push(`The latest ${type ?? 'product'} expired ${localTime(expires, tz)}; there is no newer one.`);
  else if (published) lines.push(`Issued ${localTime(published, tz)}${expires ? `, valid until ${localTime(expires, tz)}` : ''}.`);
  if (z.warning) lines.push('An avalanche warning is in effect for this zone: read it on the center\'s site.');
  lines.push(`Full forecast: ${z.link ?? z.center_link ?? 'https://avalanche.org'}`);

  return {
    summary: lines.join('\n'),
    zone: { id: z.id, name: zoneName, zones_in_area: areaNames.length ? areaNames : undefined, center_id: z.center_id, center: z.center, state: z.state, timezone: tz, forecast_url: z.link, center_url: z.center_link },
    location: { matched_by: loc.matched_by, inside_zone: loc.inside, distance_km: loc.distance_km, place: loc.place, other_zones_here: loc.other_zones_here, other_places_with_this_name: loc.other_places.length ? loc.other_places : undefined },
    off_season: z.off_season,
    danger: { level: z.danger_level, rating: z.danger, meaning: z.danger_level ? DANGER[z.danger_level].meaning : null, travel_advice: z.travel_advice },
    danger_by_elevation: days,
    avalanche_problems: probs,
    bottom_line: bottom ? clip(bottom, 1200) : null,
    discussion: a.include_discussion ? (discussion ? clip(discussion, 3000) : null) : (discussion && !bottom ? clip(discussion, 800) : undefined),
    product: product ? { type, author: product.author ?? null, published: published?.toISOString() ?? null, expires: expires?.toISOString() ?? null, expired } : null,
    warning_in_effect: Boolean(z.warning),
    scale: SCALE_NOTE,
    as_of: now.toISOString(),
    source: loc.matched_by === 'place' ? `${SOURCE} ${SOURCE_GEO}` : SOURCE,
    more: more(),
  };
}

export async function avalancheDangerMap(f: FetchText, a: { state?: string; center?: string; min_level?: number; rated_only?: boolean }, now: Date = new Date()) {
  let zones = await fetchMap(f);
  const all = zones.length;
  if (a.state) {
    const st = stateCode(a.state);
    if (!st) throw new InputError(`"${a.state}" is not a US state. Use a 2-letter code such as WA, UT or CO.`);
    zones = zones.filter((z) => z.state === st);
    if (!zones.length) throw new InputError(`no avalanche forecast zones in ${STATES[st]}. States with zones: ${[...new Set((await fetchMap(f)).map((z) => z.state))].sort().join(', ')}.`);
  }
  if (a.center) {
    const c = String(a.center).trim().toUpperCase();
    zones = zones.filter((z) => z.center_id.toUpperCase() === c);
    if (!zones.length) throw new InputError(`no zones for center "${a.center}". Use avalanche_centers to list center ids.`);
  }
  const min = a.min_level ?? (a.rated_only ? 1 : 0);
  const shown = zones.filter((z) => (min ? (z.danger_level ?? 0) >= min : true))
    .sort((x, y) => (y.danger_level ?? 0) - (x.danger_level ?? 0) || x.state.localeCompare(y.state) || x.center_id.localeCompare(y.center_id) || x.name.localeCompare(y.name));
  const counts: Record<string, number> = {};
  for (const z of zones) {
    const k = z.off_season ? 'Off season' : z.danger;
    counts[k] = (counts[k] ?? 0) + 1;
  }
  const order = ['Extreme', 'High', 'Considerable', 'Moderate', 'Low', 'No rating', 'Off season'];
  const countText = order.filter((k) => counts[k]).map((k) => `${counts[k]} ${k}`).join(', ');
  const scope = a.center ? `${zones[0].center} (${zones[0].center_id})` : a.state ? STATES[stateCode(a.state) as string] : 'the US';
  const rated = shown.filter((z) => z.danger_level);
  const lines = [`Avalanche danger right now in ${scope}: ${zones.length} forecast zones, ${countText}.`];
  for (const z of rated.slice(0, 25)) lines.push(`${z.danger} (${z.danger_level}): ${z.name}, ${z.center_id}, ${z.state}${z.valid_to ? `, until ${localTime(new Date(z.valid_to), z.timezone)}` : ''}`);
  if (!rated.length) lines.push('No zone in this selection has a danger rating right now (early or late season, or between forecasts).');
  return {
    summary: lines.join('\n'),
    counts,
    zones_total_us: all,
    zones: shown.map((z) => ({
      id: z.id, name: z.name, center_id: z.center_id, center: z.center, state: z.state, danger_level: z.danger_level, danger: z.danger,
      off_season: z.off_season, valid_from: z.valid_from, valid_to: z.valid_to, warning_in_effect: Boolean(z.warning), forecast_url: z.link,
    })),
    scale: SCALE_NOTE,
    as_of: now.toISOString(),
    source: SOURCE,
    more: more(),
  };
}

export async function avalancheCenters(f: FetchText, a: { state?: string }, now: Date = new Date()) {
  let zones = await fetchMap(f);
  if (a.state) {
    const st = stateCode(a.state);
    if (!st) throw new InputError(`"${a.state}" is not a US state. Use a 2-letter code such as WA, UT or CO.`);
    zones = zones.filter((z) => z.state === st);
    if (!zones.length) throw new InputError(`no avalanche center forecasts zones in ${STATES[st]}.`);
  }
  const by = new Map<string, Zone[]>();
  for (const z of zones) by.set(z.center_id, [...(by.get(z.center_id) ?? []), z]);
  const centers = [...by.entries()].map(([id, zs]) => {
    const top = zs.reduce((m, z) => ((z.danger_level ?? 0) > (m.danger_level ?? 0) ? z : m), zs[0]);
    const offAll = zs.every((z) => z.off_season);
    const rated = zs.filter((z) => z.danger_level).length;
    return {
      center_id: id, name: zs[0].center, url: zs[0].center_link, states: [...new Set(zs.map((z) => z.state))].sort(), timezone: zs[0].timezone,
      status: offAll ? 'off season' : rated ? 'issuing danger ratings' : 'in season, no danger rating right now',
      zones: zs.map((z) => z.name).sort(), zones_rated: rated, highest_danger: top.danger_level ? `${top.danger} (${top.danger_level})` : null,
    };
  }).sort((x, y) => x.states[0].localeCompare(y.states[0]) || x.name.localeCompare(y.name));
  const issuing = centers.filter((c) => c.status === 'issuing danger ratings').length;
  const off = centers.filter((c) => c.status === 'off season').length;
  const lines = [`${centers.length} avalanche centers${a.state ? ` in ${STATES[stateCode(a.state) as string]}` : ''} with ${zones.length} forecast zones: ${issuing} issuing danger ratings now, ${off} off season, ${centers.length - issuing - off} in season without a rating today.`];
  for (const c of centers) lines.push(`${c.center_id} ${c.name} (${c.states.join('/')}): ${c.zones.length} zones, ${c.status}${c.highest_danger ? `, highest ${c.highest_danger}` : ''}`);
  return { summary: lines.join('\n'), centers, as_of: now.toISOString(), source: SOURCE, more: more() };
}
