# avalanche-forecast-danger-rating-mcp

The avalanche forecast for AI assistants: today's avalanche danger rating for any US backcountry forecast zone, danger above, near and below treeline for today and tomorrow, the avalanche problems, the bottom line and the link to the full forecast, read live from the US avalanche centers through avalanche.org. Ask what the avalanche danger is near Alta, whether Snoqualmie Pass has a rating yet, or where the danger is highest right now.

This is a Model Context Protocol (MCP) server. It reads the avalanche.org public API (the National Avalanche Center map layer and each center's current zone product) at call time, and locates place names with the Open-Meteo geocoder. It needs no API key.

## Tools

| Tool | What it returns |
| --- | --- |
| `avalanche_forecast` | The forecast for a mountain place, a forecast zone name or latitude and longitude: danger rating (1 Low to 5 Extreme) and travel advice, danger by elevation band for today and tomorrow, avalanche problems (type, likelihood, size, aspects and elevations), bottom line or early-season summary, issue and expiry times, and the full forecast link. |
| `avalanche_danger_map` | Current danger for every US forecast zone, or one state or center, highest first, with counts by danger level, off-season zones, validity windows and warnings. |
| `avalanche_centers` | The US avalanche centers with their zones, websites and season status: issuing danger ratings, in season without a rating today, or off season. |

Every result has structured JSON, a plain-text summary, `as_of`, `source` and `more` (a page on [mcpstamp.com](https://www.mcpstamp.com/servers/?utm_source=mcp&utm_medium=avalanche-forecast-danger-rating-mcp)). Every tool is marked read-only.

## What it knows that your model does not

- Today's danger rating for each of the roughly 90 US avalanche forecast zones, which changes every morning and which no model can know.
- Which zone a ski town, pass or peak falls in (Alta is in the Utah Avalanche Center's Salt Lake zone), worked out from the zone boundaries.
- Whether a center is issuing ratings yet: early and late in the season most zones publish only a summary, and the server says so instead of inventing a number.

## Install

### Hosted (custom connector, ChatGPT developer mode, any remote MCP client)

Paste this URL. No token, no sign-up.

```
https://avalanche-forecast-danger-rating-mcp.lipmichal.workers.dev/mcp
```

### Cursor

Add to `~/.cursor/mcp.json`.

```json
{
  "mcpServers": {
    "avalanche-forecast": { "url": "https://avalanche-forecast-danger-rating-mcp.lipmichal.workers.dev/mcp" }
  }
}
```

### VS Code

Add to `.vscode/mcp.json`.

```json
{
  "servers": {
    "avalanche-forecast": { "type": "http", "url": "https://avalanche-forecast-danger-rating-mcp.lipmichal.workers.dev/mcp" }
  }
}
```

### Local stdio

The npm package is not published. Build it from this repository with Node 20 or newer, then point your MCP client at `node /path/to/avalanche-forecast-danger-rating-mcp/dist/stdio.js`.

```
git clone https://github.com/theluckystrike/avalanche-forecast-danger-rating-mcp && cd avalanche-forecast-danger-rating-mcp
npm install && npm run build
node dist/stdio.js
```

## Example prompts

- "What is the avalanche danger near Alta, Utah today?"
- "Is there an avalanche forecast for Snoqualmie Pass yet this season?"
- "Where in the US is the avalanche danger highest right now?"
- "Which avalanche center covers the Tetons, and what are today's avalanche problems?"

## Data sources

Full list in [DATA_SOURCES.md](DATA_SOURCES.md).

- avalanche.org public API (National Avalanche Center and the US avalanche centers): https://api.avalanche.org/v2/public/products/map-layer
- Open-Meteo geocoding API for place names: https://open-meteo.com/en/docs/geocoding-api

## Limitations

- US zones published on avalanche.org only (AK, AZ, CA, CO, ID, MT, NH, NM, NY, OR, UT, WA, WY). Canada (Avalanche Canada) and Europe are not covered.
- Forecasts are for backcountry terrain. They do not describe open ski area runs or highway avalanche control.
- Some centers (Utah, for example) publish only the overall rating to avalanche.org; elevation bands and problems then come back empty and the full forecast link has the detail.
- Colorado (CAIC) is published to the national map as a few merged forecast areas; the answer names the zones each area covers.
- This is not a substitute for reading the full forecast, avalanche training and rescue gear.

## More

More MCP servers that answer questions your assistant cannot answer alone are on [mcpstamp.com](https://www.mcpstamp.com/servers/?utm_source=mcp&utm_medium=avalanche-forecast-danger-rating-mcp).

Part of the Zovo MCP collection at https://mcp.zovo.one

Built by [theluckystrike](https://github.com/theluckystrike).

## Development

```
npm install
npm test                              # builds, then runs the fixture tests and an offline stdio test
node scripts/stdio-transcript.mjs     # live stdio round trip, writes .live/stdio-transcript.jsonl
```

CI (`.github/workflows/bundle.yml`) runs the tests, the type check and `wrangler deploy --dry-run --outdir out`, and uploads the Worker bundle as an artifact.

## License

MIT
