# Dryplate

Image tools that run on your machine: convert, compress, resize, crop, rotate, blur, watermark, merge and strip metadata. Reads iPhone HEIC. Nothing is uploaded.

The same tools power [dryplate.dev](https://dryplate.dev) in the browser.

| Package                          | What it is                                                                    |
| -------------------------------- | ----------------------------------------------------------------------------- |
| [`@dryplate/sdk`](packages/sdk)  | JavaScript SDK for Node (on sharp) and the browser (WASM codecs)              |
| [`@dryplate/mcp`](packages/mcp)  | MCP server: the same tools for agents in Claude, Cursor and other MCP clients |
| [`packages/core`](packages/core) | Shared image operations, bundled into both (not published on its own)         |

## Quick start

```sh
npm install @dryplate/sdk
```

```js
import { image } from "@dryplate/sdk"; // picks the Node build (sharp) or the browser build automatically
```

See each package's README for the full API and the MCP client setup.

## Develop

Node 24 and pnpm 10.

```sh
pnpm install
pnpm lint && pnpm typecheck && pnpm test && pnpm build
packages/sdk/smoke/smoke.sh   # packed SDK in plain Node and headless Chrome
packages/mcp/smoke/smoke.sh   # packed MCP server, every tool over stdio
```

## Licence

MIT, © The Dryplate Authors (see [AUTHORS](AUTHORS)). The SDK ships libheif as an unmodified WASM file under LGPL-3.0; see `packages/sdk/THIRD-PARTY-NOTICES.md`.
