// Serves the built smoke page and waits for it to POST its result. Exits 0 on PASS.
// Usage: node serve.mjs <dist dir> <chrome binary>
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const [dir, chrome] = process.argv.slice(2);
const types = {
	".html": "text/html",
	".js": "text/javascript",
	".wasm": "application/wasm",
	".jpg": "image/jpeg",
	".heic": "image/heic",
};
let browser;
const finish = (result) => {
	console.log(`browser smoke: ${result}`);
	browser?.kill();
	process.exit(result === "PASS" ? 0 : 1);
};

const server = createServer(async (req, res) => {
	if (req.method === "POST") {
		let body = "";
		for await (const chunk of req) body += chunk;
		res.end();
		return finish(body);
	}
	const path =
		normalize(new URL(req.url, "http://x").pathname).replace(/^\/+/, "") ||
		"index.html";
	try {
		const bytes = await readFile(join(dir, path));
		res.writeHead(200, {
			"content-type": types[extname(path)] ?? "application/octet-stream",
		});
		res.end(bytes);
	} catch {
		res.writeHead(404).end();
	}
});
server.listen(0, () => {
	const url = `http://localhost:${server.address().port}/`;
	browser = spawn(
		chrome,
		["--headless", "--disable-gpu", "--no-sandbox", url],
		{ stdio: "ignore" },
	);
});
setTimeout(() => finish("timed out after 120 s"), 120_000);
