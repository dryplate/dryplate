// Runs the packed SDK under plain Node, as a user would. Usage: node node.mjs <fixtures dir>
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { image } from "@dryplate/sdk";
import sharp from "sharp";

const dir = process.argv[2];
const jpg = await readFile(join(dir, "photo.jpg"));
const heic = await readFile(join(dir, "photo.heic"));
const size = async (r) => {
	const m = await sharp(r.bytes).metadata();
	return [m.format, m.width, m.height];
};

assert.deepEqual(await size(await image.resize(jpg, { width: 50 })), [
	"jpeg",
	50,
	50,
]);
for (const format of ["webp", "png", "avif"])
	assert.equal((await image.convert(jpg, { format })).type, `image/${format}`);
assert.equal(
	(await image.convert(heic, { format: "jpeg" })).type,
	"image/jpeg",
);
assert.ok(
	(await image.compress(jpg, { quality: 50 })).bytes.length < jpg.length,
);
assert.deepEqual(
	(await size(await image.crop(jpg, { ratio: "2:1" }))).slice(1),
	[200, 100],
);
assert.equal((await image.rotate(jpg, { degrees: 90 })).type, "image/jpeg");
assert.equal((await image.blur(jpg, { strength: 30 })).type, "image/jpeg");
assert.equal(
	(await image.watermark(jpg, { text: "smoke" })).type,
	"image/jpeg",
);
assert.equal((await image.removeMetadata(jpg)).type, "image/jpeg");
assert.deepEqual(
	(await size(await image.merge([jpg, jpg], { gap: 10 }))).slice(1),
	[410, 200],
);
await assert.rejects(
	image.resize(Buffer.from("hello"), { width: 10 }),
	/supported image/,
);
console.log("node smoke: all 9 ops passed");
