import { beforeAll, expect, test } from "vitest";
import { decode, encode } from "./codec";
import {
	exifOrientation,
	orientationApp1,
	pngChunk,
	pngOrientation,
	stripJpeg,
	stripPng,
	stripWebp,
} from "./metadata";
import removeMetadata from "./ops/remove-metadata";
import { fixture, setupNode } from "./test-node";

beforeAll(setupNode);

const has = (b: Uint8Array, s: string) =>
	new TextDecoder("latin1").decode(b).includes(s);
const insertAfterSoi = (jpeg: Uint8Array, ...segs: Uint8Array[]) => {
	const extra = segs.reduce((n, s) => n + s.length, 0);
	const out = new Uint8Array(jpeg.length + extra);
	out.set(jpeg.subarray(0, 2));
	let at = 2;
	for (const s of segs) {
		out.set(s, at);
		at += s.length;
	}
	out.set(jpeg.subarray(2), at);
	return out;
};
const segment = (marker: number, payload: string) => {
	const p = new TextEncoder().encode(payload);
	return new Uint8Array([
		0xff,
		marker,
		(p.length + 2) >> 8,
		(p.length + 2) & 0xff,
		...p,
	]);
};

test("JPEG: GPS/XMP/comment gone, orientation kept, pixels identical", async () => {
	const img = new ImageData(40, 20);
	img.data.fill(180);
	const plain = await encode(img, "jpeg", 90);
	const gpsLike = segment(0xe1, "Exif\0\0GPSLatitude 22.2047 secret");
	const xmp = segment(0xe1, "http://ns.adobe.com/xap/1.0/ secret");
	const comment = segment(0xfe, "shot at home secret");
	const input = insertAfterSoi(
		plain,
		orientationApp1(6),
		gpsLike,
		xmp,
		comment,
	);
	expect(has(input, "secret")).toBe(true);

	const out = stripJpeg(input);
	expect(has(out, "secret")).toBe(false);
	expect(exifOrientation(out.subarray(6))).toBe(6);
	const before = await decode(input);
	const after = await decode(out);
	expect([after.width, after.height]).toEqual([20, 40]);
	expect([...after.data]).toEqual([...before.data]);
});

test("JPEG without metadata passes through unchanged", async () => {
	const jpeg = await fixture("photo.jpg");
	const out = stripJpeg(jpeg);
	expect([...(await decode(out)).data]).toEqual([...(await decode(jpeg)).data]);
	expect(out.length).toBeLessThanOrEqual(jpeg.length);
});

test("PNG: text chunks dropped, pixels identical", async () => {
	const img = new ImageData(8, 8);
	img.data.fill(90);
	const png = await encode(img, "png");
	// Insert a tEXt chunk after IHDR (CRC isn't checked by the decoder for ancillary chunks we drop anyway).
	const text = new TextEncoder().encode("Comment\0secret");
	const chunk = new Uint8Array(12 + text.length);
	new DataView(chunk.buffer).setUint32(0, text.length);
	chunk.set(new TextEncoder().encode("tEXt"), 4);
	chunk.set(text, 8);
	const ihdrEnd = 8 + 25;
	const input = new Uint8Array([
		...png.subarray(0, ihdrEnd),
		...chunk,
		...png.subarray(ihdrEnd),
	]);
	expect(has(input, "secret")).toBe(true);
	const out = stripPng(input);
	expect(has(out, "secret")).toBe(false);
	expect([...(await decode(out)).data]).toEqual([...img.data]);
});

test("WebP: EXIF chunk and VP8X flag removed, RIFF size fixed", async () => {
	const img = new ImageData(8, 8);
	img.data.fill(120);
	const simple = await encode(img, "webp", 80);
	const imageChunk = simple.subarray(12);
	const vp8x = new Uint8Array([
		0x56, 0x50, 0x38, 0x58, 10, 0, 0, 0, 0x08, 0, 0, 0, 7, 0, 0, 7, 0, 0,
	]);
	const exif = new TextEncoder().encode("EXIF\x06\0\0\0secret");
	const body = new Uint8Array([...vp8x, ...imageChunk, ...exif]);
	const input = new Uint8Array(12 + body.length);
	input.set(new TextEncoder().encode("RIFF"));
	new DataView(input.buffer).setUint32(4, body.length + 4, true);
	input.set(new TextEncoder().encode("WEBP"), 8);
	input.set(body, 12);

	const out = stripWebp(input);
	expect(has(out, "secret")).toBe(false);
	expect((out[20] ?? 0) & 0x08).toBe(0);
	expect(new DataView(out.buffer).getUint32(4, true)).toBe(out.length - 8);
	expect((await decode(out)).width).toBe(8);
});

test("removeMetadata: HEIC is re-encoded to JPEG", async () => {
	const out = await removeMetadata(await fixture("photo.heic"), {});
	expect(out.type).toBe("image/jpeg");
});

test("JPEG: data after the main image (MPF, gain maps) is removed", async () => {
	const plain = await fixture("photo.jpg");
	const second = insertAfterSoi(plain, segment(0xe1, "Exif\0\0secret GPS"));
	const input = new Uint8Array(plain.length + second.length);
	input.set(plain);
	input.set(second, plain.length);
	expect(has(input, "secret")).toBe(true);
	const out = stripJpeg(input);
	expect(has(out, "secret")).toBe(false);
	expect(out.length).toBeLessThanOrEqual(plain.length);
});

test("PNG: orientation survives the strip and decode applies it", async () => {
	const img = new ImageData(4, 2);
	const png = await encode(img, "png");
	const exif = orientationApp1(6).subarray(10);
	const ihdrEnd = 33;
	const input = new Uint8Array([
		...png.subarray(0, ihdrEnd),
		...pngChunk("eXIf", exif),
		...pngChunk("tEXt", new TextEncoder().encode("Comment\0secret")),
		...png.subarray(ihdrEnd),
	]);
	const out = stripPng(input);
	expect(has(out, "secret")).toBe(false);
	expect(pngOrientation(out)).toBe(6);
	const shown = await decode(out);
	expect([shown.width, shown.height]).toEqual([2, 4]);
});
