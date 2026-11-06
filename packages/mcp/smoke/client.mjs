// Minimal MCP client over stdio (newline-delimited JSON-RPC), so the smoke test needs nothing installed.
// Usage: node client.mjs <server-bin> <dir with photo.jpg and photo.heic>
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const [bin, dir] = process.argv.slice(2);
const jpg = join(dir, "photo.jpg");
const heic = join(dir, "photo.heic");
const server = spawn(bin, [], { stdio: ["pipe", "pipe", "inherit"] });

const pending = new Map();
let buf = "";
server.stdout.on("data", (d) => {
	buf += d;
	const lines = buf.split("\n");
	buf = lines.pop();
	for (const line of lines) {
		const msg = JSON.parse(line);
		pending.get(msg.id)?.(msg);
	}
});
let id = 0;
const send = (method, params) =>
	new Promise((res, rej) => {
		const n = ++id;
		const t = setTimeout(
			() => rej(new Error(`${method}: no reply in 30 s`)),
			30_000,
		);
		pending.set(n, (m) => {
			clearTimeout(t);
			m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result);
		});
		server.stdin.write(
			`${JSON.stringify({ jsonrpc: "2.0", id: n, method, params })}\n`,
		);
	});

const init = await send("initialize", {
	protocolVersion: "2025-06-18",
	capabilities: {},
	clientInfo: { name: "smoke", version: "0" },
});
server.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');

const { tools } = await send("tools/list", {});
const names = tools.map((t) => t.name).sort();
console.log(
	`${init.serverInfo.name} ${init.serverInfo.version}: ${names.length} tools`,
);

// One call per tool; HEIC goes through convert so the libheif path is covered.
const calls = {
	convert_image: { path: heic, format: "jpeg", output: join(dir, "heic.jpg") },
	resize_image: { path: jpg, width: 100 },
	compress_image: { path: jpg, quality: 60 },
	watermark_image: { path: jpg, text: "smoke" },
	generate_thumbnail: { path: jpg, size: 64, format: "webp" },
	crop_image: { path: jpg, ratio: "1:1" },
	rotate_image: { path: jpg, degrees: 90 },
	blur_image: { path: jpg, areas: [{ x: 0, y: 0, w: 0.5, h: 0.5 }] },
	remove_metadata: { path: jpg },
	merge_images: { paths: [jpg, heic], output: join(dir, "merged.jpg") },
};
const missing = names.filter((n) => !(n in calls));
if (missing.length) throw new Error(`no smoke call for: ${missing.join(", ")}`);

let failed = 0;
for (const name of names) {
	const r = await send("tools/call", { name, arguments: calls[name] });
	const text = r.content?.[0]?.text ?? "";
	const out = text.match(/^Wrote (.+?) \(/)?.[1];
	const ok = !r.isError && out && existsSync(out);
	if (!ok) failed++;
	console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${text}`);
}
server.kill();
if (failed) {
	console.error(`mcp smoke: ${failed} tool(s) failed`);
	process.exit(1);
}
console.log("mcp smoke: all tools passed");
