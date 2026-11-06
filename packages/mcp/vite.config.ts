import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig, type Plugin } from "vite";

// One Node file. Core is TS source with extensionless imports, so plain `node` cannot run it unbundled.
// Sharp (native binary per platform) and libheif-js (CJS that reads __dirname) stay external.

// Inlined packages keep their licences: list every node_modules package in the bundle with its licence text.
const notices = (): Plugin => ({
	name: "third-party-notices",
	generateBundle(_, bundle) {
		const roots = new Set<string>();
		for (const chunk of Object.values(bundle))
			if (chunk.type === "chunk")
				for (const id of Object.keys(chunk.modules)) {
					const m = id.match(/^.*\/node_modules\/(?:@[^/]+\/)?[^/]+/);
					if (m) roots.add(m[0].replace(/^\0/, ""));
				}
		const seen = new Set<string>();
		const parts = [...roots]
			.map((root) => {
				const pkg = JSON.parse(
					readFileSync(join(root, "package.json"), "utf8"),
				);
				const file = existsSync(root)
					? readdirSync(root).find((f) => /^(licen[cs]e|copying)/i.test(f))
					: undefined;
				return { pkg, text: file && readFileSync(join(root, file), "utf8") };
			})
			.filter(({ pkg }) => !seen.has(pkg.name) && seen.add(pkg.name))
			.sort((a, b) => a.pkg.name.localeCompare(b.pkg.name))
			.map(
				({ pkg, text }) =>
					`## ${pkg.name} ${pkg.version} (${pkg.license ?? "see package"})\n\n${
						text
							? `\`\`\`\n${text.trim()}\n\`\`\``
							: "No licence file in the package."
					}`,
			);
		this.emitFile({
			type: "asset",
			fileName: "THIRD-PARTY-NOTICES.md",
			source: `# Third-party notices\n\nThis bundle includes the packages below. Sharp and libheif-js are installed from npm, not bundled.\n\n${parts.join("\n\n")}\n`,
		});
	},
});

export default defineConfig({
	plugins: [notices()],
	build: {
		ssr: "src/main.ts",
		outDir: "dist",
		target: "node24",
		rollupOptions: { external: ["sharp", /^libheif-js/] },
	},
	ssr: { noExternal: true },
});
