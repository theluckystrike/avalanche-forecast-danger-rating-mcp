// Tool registry shared by the stdio and Worker entries.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { InputError, REPO, SITE, avalancheCenters, avalancheDangerMap, avalancheForecast } from './core.js';
import type { FetchText } from './types.js';

export const VERSION = '1.0.0';

export const META = {
  alias: 'avalanche-forecast',
  metaDescription: 'MCP server for the avalanche forecast: today\'s avalanche danger rating by zone and elevation, avalanche problems and the bottom line from US avalanche centers, for any mountain place or forecast zone, from avalanche.org.',
  intro: 'Avalanche forecasts for AI assistants: the current danger rating, danger by elevation, avalanche problems and bottom line for every US avalanche forecast zone, read live from the avalanche.org public API.',
};

export const TOOL_INFO = [
  { name: 'avalanche_forecast', blurb: 'The avalanche forecast for a place, a forecast zone or latitude and longitude: danger rating, danger above, near and below treeline today and tomorrow, avalanche problems, bottom line and the link to the full forecast.' },
  { name: 'avalanche_danger_map', blurb: 'Current avalanche danger for every US forecast zone, or one state or center, highest first, with counts by danger level.' },
  { name: 'avalanche_centers', blurb: 'US avalanche centers with their zones, links and season status: issuing ratings, in season without a rating, or off season.' },
];

const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

function ok(data: Record<string, unknown> & { summary: string }) {
  return { content: [{ type: 'text' as const, text: `${data.summary}\n\n${JSON.stringify(data, null, 2)}` }], structuredContent: data };
}
function fail(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  return { isError: true, content: [{ type: 'text' as const, text: `${e instanceof InputError ? 'Error' : 'Upstream avalanche.org error'}: ${msg}` }] };
}
const wrap = <A>(fn: (a: A) => unknown) => async (a: A) => { try { return ok((await fn(a)) as any); } catch (e) { return fail(e); } };
const state = z.string().optional().describe('US state, 2-letter code or name, for example WA, UT or Colorado.');

export function createServer(fetchText: FetchText): McpServer {
  const server = new McpServer({ name: REPO, version: VERSION, websiteUrl: SITE } as any, {
    instructions:
      'US avalanche forecasts, read at call time from the avalanche.org public API (the National Avalanche Center and the regional avalanche centers). ' +
      'A model cannot know today\'s avalanche danger. Use avalanche_forecast for "avalanche danger near Alta" or "is it safe to ski Snoqualmie Pass backcountry", ' +
      'avalanche_danger_map for "where is the avalanche danger high right now" and avalanche_centers for which center covers a range and whether it is in season. ' +
      'Forecasts cover backcountry terrain, not ski areas or highways. Early and late in the season most zones have no danger rating; say so rather than guessing. ' +
      'Always point the user to the full forecast link.',
  });

  server.registerTool('avalanche_forecast', {
    title: 'Avalanche forecast',
    description:
      'The current avalanche forecast for a mountain place ("Alta, UT", "Snoqualmie Pass", "Mount Hood"), a forecast zone name ("Tetons", "Salt Lake") or latitude and longitude: ' +
      'the danger rating (1 Low to 5 Extreme) and travel advice, danger above, near and below treeline for today and tomorrow when the center issues them, ' +
      'avalanche problems (type, likelihood, size, aspects and elevations), the bottom line or early-season summary, issue and expiry times, and the full forecast link. ' +
      'Covers every zone on avalanche.org (AK, AZ, CA, CO, ID, MT, NH, NM, NY, OR, UT, WA, WY).',
    inputSchema: {
      place: z.string().optional().describe('A mountain town, pass, peak or "lat,lon", for example "Alta, UT" or "Girdwood, AK".'),
      zone: z.string().optional().describe('A forecast zone name instead of a place, for example "Stevens Pass", "Tetons" or "Bridger Range".'),
      latitude: z.number().optional().describe('Latitude, with longitude, instead of a place.'),
      longitude: z.number().optional().describe('Longitude, with latitude.'),
      center: z.string().optional().describe('Limit zone and place matching to one center id, for example NWAC, UAC, CAIC, SAC, GNFAC.'),
      include_discussion: z.boolean().optional().describe('Also return the forecaster\'s hazard discussion (plain text, up to 3,000 characters).'),
    },
    annotations: { title: 'Avalanche forecast', ...RO },
  }, wrap((a: any) => avalancheForecast(fetchText, a)));

  server.registerTool('avalanche_danger_map', {
    title: 'Avalanche danger map',
    description:
      'Current avalanche danger for every US avalanche forecast zone (about 90 zones from about 30 centers), or one state or center, sorted highest first, ' +
      'with counts by danger level, off-season zones, the validity window of each rating and avalanche warnings.',
    inputSchema: {
      state,
      center: z.string().optional().describe('One avalanche center id, for example NWAC, UAC, CAIC, SNFAC.'),
      min_level: z.number().int().min(1).max(5).optional().describe('Only zones at or above this danger level, 1 Low to 5 Extreme.'),
      rated_only: z.boolean().optional().describe('Only zones that have a danger rating right now.'),
    },
    annotations: { title: 'Avalanche danger map', ...RO },
  }, wrap((a: any) => avalancheDangerMap(fetchText, a)));

  server.registerTool('avalanche_centers', {
    title: 'Avalanche centers',
    description:
      'US avalanche centers (all, or in one state) with their forecast zones, website, time zone and season status: issuing danger ratings, ' +
      'in season without a rating today, or off season, plus the highest current danger.',
    inputSchema: { state },
    annotations: { title: 'Avalanche centers', ...RO },
  }, wrap((a: any) => avalancheCenters(fetchText, a)));

  return server;
}
