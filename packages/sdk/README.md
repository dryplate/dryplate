# @dryplate/sdk

Image tools for Node and the browser: convert, compress, resize, crop, rotate, blur, watermark, remove metadata and merge. Reads JPEG, PNG, WebP, AVIF and iPhone HEIC. Everything runs locally. Nothing is uploaded.

## Quick start

**1. Install** (Node 24 or newer):

```sh
npm install @dryplate/sdk
```

**2. Use it in Node:**

```js
import { readFile, writeFile } from "node:fs/promises";
import { image } from "@dryplate/sdk";

const photo = await readFile("IMG_0042.HEIC");
const out = await image.resize(photo, { width: 1200 });
await writeFile("IMG_0042.jpg", out.bytes); // HEIC comes out as JPEG
console.log(out.type); // "image/jpeg"
```

**Or in the browser**, through a bundler such as Vite or webpack 5:

```js
import { image } from "@dryplate/sdk";

input.onchange = async () => {
	const file = input.files[0];
	const out = await image.convert(new Uint8Array(await file.arrayBuffer()), {
		format: "webp",
	});
	img.src = URL.createObjectURL(new Blob([out.bytes], { type: out.type }));
};
```

Vite needs no config. **webpack 5** needs two lines, for code inside two codec packages: libheif names Node built-ins it never loads in a browser, and the oxipng worker imports a path without a file extension.

```js
// webpack.config.js
export default {
	resolve: { fallback: { fs: false, path: false } },
	module: { rules: [{ test: /\.m?js$/, resolve: { fullySpecified: false } }] },
};
```

## How it works

- Every op takes bytes (`Uint8Array` or a Node `Buffer`) and resolves to `{ bytes, type, note? }`. `type` is the output MIME type. `note` is a plain warning, such as when resize had to enlarge or a PNG ignored `quality`.
- Output keeps the input format unless you pick one. HEIC is read but not written, so HEIC input comes out as JPEG.
- Colour profiles and orientation are kept. Other metadata is dropped on re-encode; `removeMetadata` strips it without re-encoding where it can.
- Node uses Sharp. The browser uses WebAssembly codecs, each downloaded the first time it is needed. Bundlers pick the right build on their own.
- A bad file rejects with a plain message, like `This isn't a supported image. Use JPG, PNG, WebP, AVIF or HEIC.`

## Ops

Every op also takes `quality` (1–100) for lossy output.

| Op                             | Options                                                                                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `image.convert(input, opts)`   | `format`: `"jpeg"`, `"png"`, `"webp"`, `"avif"`                                                                                             |
| `image.compress(input, opts?)` | `maxKb`: target size. Never returns a bigger file                                                                                           |
| `image.resize(input, opts)`    | `width`, `height` (both: fit inside that box), `percent`. Keeps the aspect ratio                                                            |
| `image.crop(input, opts)`      | `ratio` like `"16:9"` (centred), or `box`: `"x,y,w,h"` as 0–1 fractions from the top left                                                   |
| `image.rotate(input, opts)`    | `degrees`: 0, 90, 180, 270 clockwise; `flip`: `"h"` or `"v"`                                                                                |
| `image.blur(input, opts?)`     | `strength` 1–100 (default 20); `areas`: boxes joined by `;`, like `"0,0,0.5,0.5;0.6,0.6,0.2,0.2"`                                           |
| `image.watermark(input, opts)` | `text`; `size` (% of short side), `opacity`, `angle`, `x`, `y` (0–1), `color`, `font` (`sans`, `serif`, `mono`, `script`, `impact`), `tile` |
| `image.removeMetadata(input)`  | none. Lossless for JPEG, PNG and WebP                                                                                                       |
| `image.merge(inputs, opts?)`   | `direction`: `"horizontal"` or `"vertical"`; `gap` in px; `background`                                                                      |
