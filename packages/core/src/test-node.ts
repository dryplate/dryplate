import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { setHeifLoader } from "./heic";

export const fixture = async (name: string) =>
	new Uint8Array(
		await readFile(new URL(`../fixtures/${name}`, import.meta.url)),
	);

let ready: Promise<void> | undefined;

// Node has no ImageData and the codecs cannot fetch their WASM, so polyfill and hand each one its module.
export function setupNode(): Promise<void> {
	ready ??= (async () => {
		globalThis.ImageData ??= class {
			data: Uint8ClampedArray;
			width: number;
			height: number;
			constructor(a: Uint8ClampedArray | number, b: number, c?: number) {
				if (typeof a === "number") {
					this.width = a;
					this.height = b;
					this.data = new Uint8ClampedArray(a * b * 4);
				} else {
					this.data = a;
					this.width = b;
					this.height = c ?? a.length / 4 / b;
				}
			}
		} as unknown as typeof ImageData;

		setHeifLoader(async () => {
			const { default: factory } = await import(
				"libheif-js/libheif-wasm/libheif.js"
			);
			return (await factory()) as never;
		});

		const require = createRequire(import.meta.url);
		const wasm = async (p: string) =>
			WebAssembly.compile(await readFile(require.resolve(`@jsquash/${p}`)));
		await Promise.all([
			import("@jsquash/jpeg/decode.js").then(async (m) =>
				m.init(await wasm("jpeg/codec/dec/mozjpeg_dec.wasm")),
			),
			import("@jsquash/jpeg/encode.js").then(async (m) =>
				m.init(await wasm("jpeg/codec/enc/mozjpeg_enc.wasm")),
			),
			import("@jsquash/png/decode.js").then(async (m) =>
				m.init(await wasm("png/codec/pkg/squoosh_png_bg.wasm")),
			),
			import("@jsquash/png/encode.js").then(async (m) =>
				m.init(await wasm("png/codec/pkg/squoosh_png_bg.wasm")),
			),
			import("@jsquash/webp/decode.js").then(async (m) =>
				m.init(await wasm("webp/codec/dec/webp_dec.wasm")),
			),
			import("@jsquash/webp/encode.js").then(async (m) =>
				m.init(await wasm("webp/codec/enc/webp_enc_simd.wasm")),
			),
			import("@jsquash/avif/decode.js").then(async (m) =>
				m.init(await wasm("avif/codec/dec/avif_dec.wasm")),
			),
			import("@jsquash/avif/encode.js").then(async (m) =>
				m.init(await wasm("avif/codec/enc/avif_enc.wasm")),
			),
			import("@jsquash/oxipng/optimise.js").then(async (m) =>
				m.init(await wasm("oxipng/codec/pkg/squoosh_oxipng_bg.wasm")),
			),
			import("@jsquash/resize").then(async (m) =>
				m.initResize(
					await wasm("resize/lib/resize/pkg/squoosh_resize_bg.wasm"),
				),
			),
		]);
	})();
	return ready;
}
