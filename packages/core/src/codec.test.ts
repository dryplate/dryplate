import { beforeAll, expect, test } from "vitest";
import {
	decode,
	encode,
	type Format,
	flattenOnWhite,
	MIME,
	sniff,
} from "./codec";
import convert from "./ops/convert";
import { fixture, setupNode } from "./test-node";

beforeAll(setupNode);

function gradient(w: number, h: number, alpha = 255): ImageData {
	const img = new ImageData(w, h);
	for (let i = 0; i < w * h; i++)
		img.data.set([(i * 7) % 256, (i * 3) % 256, 128, alpha], i * 4);
	return img;
}

test.each<Format>(["jpeg", "png", "webp", "avif"])(
	"%s round-trips",
	async (format) => {
		const bytes = await encode(gradient(32, 24), format, 80);
		expect(sniff(bytes)).toBe(format);
		const img = await decode(bytes);
		expect([img.width, img.height]).toEqual([32, 24]);
	},
);

test("convert: real JPEG photo to WebP", async () => {
	const input = await fixture("photo.jpg");
	expect(sniff(input)).toBe("jpeg");
	const out = await convert(input, { format: "webp", quality: "80" });
	expect(out.type).toBe(MIME.webp);
	expect(sniff(out.bytes)).toBe("webp");
	const img = await decode(out.bytes);
	expect(Math.max(img.width, img.height)).toBe(200);
});

test("flattenOnWhite: transparent becomes white, opaque untouched", () => {
	const img = new ImageData(
		new Uint8ClampedArray([10, 20, 30, 0, 10, 20, 30, 255, 0, 0, 0, 128]),
		3,
		1,
	);
	expect([...flattenOnWhite(img).data]).toEqual([
		255, 255, 255, 255, 10, 20, 30, 255, 127, 127, 127, 255,
	]);
});

test("sniff: HEIC and junk", () => {
	const heic = new Uint8Array([
		0,
		0,
		0,
		24,
		...new TextEncoder().encode("ftypheic"),
	]);
	expect(sniff(heic)).toBe("heic");
	expect(sniff(new Uint8Array([1, 2, 3, 4]))).toBeUndefined();
});

test("sniff finds AVIF behind a generic mif1 major brand", () => {
	const brands = "mif1\0\0\0\0mif1avif";
	const b = new Uint8Array(32);
	b.set([0, 0, 0, 8 + brands.length]);
	b.set(new TextEncoder().encode(`ftyp${brands}`), 4);
	expect(sniff(b)).toBe("avif");
});

test("decode rejects a JPEG that was cut off", async () => {
	const jpeg = await fixture("photo.jpg");
	await expect(decode(jpeg.slice(0, jpeg.length >> 1))).rejects.toThrow(
		"incomplete",
	);
});

test("decode rejects unknown bytes", async () => {
	await expect(decode(new Uint8Array(16))).rejects.toThrow("supported image");
});
