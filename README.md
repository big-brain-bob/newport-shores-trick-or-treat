# Newport Shores Trick-or-Treat Map

A shared, password-protected house checklist map for Newport Shores in Bellevue, Washington.

## Features

- 346 mapped house addresses with building outlines and house numbers.
- Tap a house to mark it visited; hold to toggle a red no-candy X.
- Houses marked X cannot be checked until the X is removed.
- Shared marks update automatically using server-sent events, with reconnection and polling fallback.
- Password gate and signed, HTTP-only session cookies.
- Optional device-only GPS location, name prompt, north-up compass, and an "Out of map" status.
- Mobile layout, keyboard controls, zoom, and drag to pan.

## Build

Requires Node.js 22 or newer. No third-party packages are required.

```sh
npm run build
npm run check
```

The build writes a Cloudflare-compatible ES module to `dist/server/index.js` and copies the hosting manifest into `dist/.openai/hosting.json`.

## Hosting

The server requires an R2 bucket bound as `BUCKET`, plus two runtime secrets:

- `PASSWORD_HASH`: SHA-256 hex digest of your chosen shared password.
- `SESSION_SECRET`: a long, cryptographically random secret used to sign sessions.

Set these using your hosting provider's secret settings. Never add passwords, hashes, session secrets, or live house-mark data to Git. `.env.example` lists variable names only. The map and API remain unavailable when secrets are missing.

The supplied Sites manifest declares the logical R2 binding and deliberately omits the original hosted Site ID. Register or configure the target Site before publishing. This GitHub repository is a source snapshot; pushing here does not automatically deploy the existing hosted map. GitHub Pages alone cannot run its password gate or shared storage server.

## Source layout

- `worker/map.html`: interactive map, house addresses, device-only location, and live-update client.
- `worker/login.html`: password entry page.
- `worker/server.mjs`: password validation, sessions, shared marks API, and live event stream.
- `scripts/build-live.mjs`: embeds both HTML pages into the Worker module.
- `scripts/validate-artifact.mjs`: validates the generated Worker export and hosting manifest.

Precise GPS coordinates and entered names stay in the visitor's browser. Shared house marks are stored in the hosted R2 bucket. Existing live marks and authentication secrets are not included in this repository.

## Map data and limitations

Map data is from [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), retrieved October 30, 2026, under the Open Database License (ODbL). Preserve attribution when redistributing map data. Mapped addresses may be incomplete; candy availability is reported by map users and is not independently verified.

The GPS UI was checked using simulated coordinates. Real-device GPS accuracy and permission behavior depend on the browser and device.
