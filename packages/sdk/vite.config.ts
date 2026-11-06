import { copyFileSync } from "node:fs";
import { createRequire } from "node:module";
import { defineConfig, type Plugin } from "vite";

// Publish build. Core is TS source with extensionless imports, so it is bundled in; codecs stay real dependencies.
// `vite build` makes dist/index.js (browser), `vite build --mode node` makes dist/node.js.
const heifWasm = "libheif-js/libheif-wasm/libheif.wasm?url";

// Core loads libheif's WASM through Vite's `?url`, which other bundlers don't know.
// The browser build ships the file and uses `new URL(..., import.meta.url)`, which Vite, webpack 5 and plain ESM all follow.
// Node never fetches it (node.ts injects its own loader), so there it is an empty stub.
const heif = (node: boolean): Plugin => ({
	name: "heif-wasm",
	enforce: "pre",
	resolveId: (id) => (id === heifWasm ? "\0heif-wasm" : undefined),
	load: (id) =>
		id === "\0heif-wasm"
			? `export default ${node ? "''" : "__HEIF_WASM__"}`
			: undefined,
	// Swapped in after Vite's own transforms, which would otherwise inline the 1.4 MB file
	// or rewrite the URL into a form webpack doesn't detect.
	renderChunk: (code) =>
		code.includes("__HEIF_WASM__")
			? code.replace(
					"__HEIF_WASM__",
					'new URL("./libheif.wasm", import.meta.url).href',
				)
			: undefined,
	writeBundle: () => {
		if (!node)
			copyFileSync(
				createRequire(import.meta.url).resolve(
					"libheif-js/libheif-wasm/libheif.wasm",
				),
				"dist/libheif.wasm",
			);
	},
});

export default defineConfig(({ mode }) => {
	const node = mode === "node";
	return {
		plugins: [heif(node)],
		build: {
			outDir: "dist",
			emptyOutDir: !node,
			minify: false,
			target: node ? "node22" : "es2022",
			ssr: node ? "src/node.ts" : undefined,
			lib: node
				? undefined
				: { entry: "src/index.ts", formats: ["es"], fileName: "index" },
			rollupOptions: {
				external: (id) =>
					id === "sharp" ||
					id.startsWith("@jsquash/") ||
					(id.startsWith("libheif-js/") && id !== heifWasm),
				output: node
					? { entryFileNames: "node.js", chunkFileNames: "node-[name].js" }
					: { chunkFileNames: "[name].js" },
			},
		},
		ssr: { noExternal: node ? [/^@dryplate\/core/] : undefined },
	};
});
