# Data sources

All data is read at call time. No key is needed.

| Endpoint | Used for |
| --- | --- |
| `https://api.avalanche.org/v2/public/products/map-layer` | every US forecast zone: boundary, center, current overall danger (1 to 5, or no rating), travel advice, off-season flag, forecast link and validity window |
| `https://api.avalanche.org/v2/public/product?type=forecast&center_id=<CENTER>&zone_id=<ZONE>` | the zone's current product: forecast or season summary, danger above, near and below treeline for today and tomorrow, avalanche problems, bottom line, hazard discussion, issue and expiry times |
| `https://geocoding-api.open-meteo.com/v1/search` | place name to latitude and longitude (US only) |

avalanche.org is run by the National Avalanche Center (USDA Forest Service) and the American Avalanche Association; each forecast is written by the regional avalanche center named in the answer. The danger levels follow the North American Public Avalanche Danger Scale.

The map layer is cached for 10 minutes at the edge, zone products for 10 minutes, and geocoder answers for 7 days.
