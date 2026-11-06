// Browser half of the smoke test: bundled by Vite from the packed SDK, run in headless Chrome.
// The result is POSTed back to serve.mjs.
import { image } from "@dryplate/sdk";

const get = async (name) =>
	new Uint8Array(await (await fetch(`./${name}`)).arrayBuffer());
const check = (ok, what) => {
	if (!ok) throw new Error(what);
};
let result = "PASS";
try {
	const jpg = await get("photo.jpg");
	// Chrome can't decode HEIC itself, so this goes through the shipped libheif.wasm.
	const heic = await image.convert(await get("photo.heic"), { format: "jpeg" });
	check(heic.type === "image/jpeg", "heic");
	for (const format of ["webp", "png", "avif"])
		check(
			(await image.convert(jpg, { format })).type === `image/${format}`,
			format,
		);
	check(
		(await image.resize(jpg, { width: 50 })).bytes.length < jpg.length,
		"resize",
	);
	check(
		(await image.blur(jpg, { strength: 30 })).type === "image/jpeg",
		"blur",
	);
	check(
		(await image.watermark(jpg, { text: "smoke" })).type === "image/jpeg",
		"watermark",
	);
	check((await image.merge([jpg, jpg])).type === "image/jpeg", "merge");
} catch (e) {
	result = `FAIL ${e}`;
}
await fetch("/result", { method: "POST", body: result });
