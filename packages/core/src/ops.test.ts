import { beforeAll, expect, test } from "vitest";
import { decode, encode, sniff } from "./codec";
import compress from "./ops/compress";
import merge from "./ops/merge";
import resize from "./ops/resize";
import rotate from "./ops/rotate";
import { targetSize } from "./pixels";
import { fixture, setupNode } from "./test-node";

beforeAll(setupNode);

test("targetSize keeps aspect ratio", () => {
	expect(targetSize(4032, 3024, { width: "1200" })).toEqual([1200, 900]);
	expect(targetSize(4032, 3024, { height: "300" })).toEqual([400, 300]);
	expect(targetSize(4032, 3024, { width: "1000", height: "1000" })).toEqual([
		1000, 750,
	]);
	expect(targetSize(4032, 3024, { percent: "50", width: "10" })).toEqual([
		2016, 1512,
	]);
	expect(targetSize(3, 1, { percent: "1" })).toEqual([1, 1]);
	expect(() => targetSize(10, 10, {})).toThrow("width, height or percent");
});

test("resize: JPEG photo to 100 px wide, stays JPEG", async () => {
	const out = await resize(await fixture("photo.jpg"), { width: "100" });
	expect(out.type).toBe("image/jpeg");
	const img = await decode(out.bytes);
	expect(img.width).toBe(100);
});

test("resize: HEIC comes out as JPEG", async () => {
	const out = await resize(await fixture("photo.heic"), { percent: "50" });
	expect(sniff(out.bytes)).toBe("jpeg");
	expect((await decode(out.bytes)).width).toBe(100);
});

test("compress: JPEG at quality 40 is smaller", async () => {
	const input = await fixture("photo.jpg");
	const out = await compress(input, { quality: "40" });
	expect(out.type).toBe("image/jpeg");
	expect(out.bytes.length).toBeLessThan(input.length);
});

test("compress: never returns a bigger file", async () => {
	const input = await encode(
		await decode(await fixture("photo.jpg")),
		"jpeg",
		10,
	);
	const out = await compress(input, { quality: "100" });
	expect(out.bytes).toBe(input);
});

test("compress: PNG stays lossless", async () => {
	const img = new ImageData(64, 64);
	for (let i = 0; i < img.data.length; i += 4)
		img.data.set([i % 256, 0, 0, 255], i);
	const png = await encode(img, "png");
	const out = await compress(png, {});
	expect(out.type).toBe("image/png");
	expect(out.bytes.length).toBeLessThanOrEqual(png.length);
	expect([...(await decode(out.bytes)).data]).toEqual([...img.data]);
});

test("compress: max size lowers quality until the file fits", async () => {
	const input = await fixture("photo.jpg");
	const full = await compress(input, { quality: "90" });
	const maxKb = Math.ceil(full.bytes.length / 1000 / 2);
	const out = await compress(input, { quality: "90", maxKb: String(maxKb) });
	expect(out.type).toBe("image/jpeg");
	expect(out.bytes.length).toBeLessThanOrEqual(maxKb * 1000);
	// Not just the lowest quality: the search keeps as much as fits.
	const lowest = await compress(input, { quality: "1" });
	expect(out.bytes.length).toBeGreaterThan(lowest.bytes.length);
});

test("compress: max size it can't reach fails instead of overshooting", async () => {
	const noise = new ImageData(256, 256);
	for (let i = 0; i < noise.data.length; i++)
		noise.data[i] = (i * 2654435761) >>> 24;
	const jpeg = await encode(noise, "jpeg", 95);
	const png = await encode(noise, "png");
	await expect(compress(jpeg, { maxKb: "0.01" })).rejects.toThrow(
		"lowest quality",
	);
	await expect(compress(png, { maxKb: "1" })).rejects.toThrow("lossless");
});

test("merge: two photos side by side at the smaller height", async () => {
	const small = await encode(new ImageData(50, 100), "png");
	const big = await encode(new ImageData(400, 200), "png");
	const out = await merge(small, { gap: "10" }, [small, big]);
	const img = await decode(out.bytes);
	expect([img.width, img.height]).toEqual([50 + 10 + 200, 100]);
});

test("merge: needs 2+ images, and refuses giant output", async () => {
	const one = await encode(new ImageData(4, 4), "png");
	await expect(merge(one, {}, [one])).rejects.toThrow("one more image");
	const tall = await encode(new ImageData(1, 20000), "png");
	await expect(
		merge(tall, { gap: "500" }, Array(12).fill(tall)),
	).rejects.toThrow("100 megapixels");
});

test("merge: transparent background never falls back to JPEG", async () => {
	const jpeg = await fixture("photo.jpg");
	const out = await merge(jpeg, { background: "transparent" }, [jpeg, jpeg]);
	expect(sniff(out.bytes)).toBe("png");
});

test("merge: says when images were scaled down", async () => {
	const big = await encode(new ImageData(40, 40), "png");
	const small = await encode(new ImageData(10, 10), "png");
	const out = await merge(big, {}, [big, small]);
	expect(out.note).toContain("10 px tall");
	expect((await merge(big, {}, [big, big])).note).toBeUndefined();
});

test("resize: refuses giant output and warns when enlarging", async () => {
	const png = await encode(new ImageData(10, 10), "png");
	await expect(resize(png, { width: "20000" })).rejects.toThrow(
		"100 megapixels",
	);
	expect((await resize(png, { width: "20" })).note).toContain("softer");
	expect((await resize(png, { width: "5" })).note).toBeUndefined();
});

test("rotate: no turn and no flip returns the original file", async () => {
	const jpeg = await fixture("photo.jpg");
	const out = await rotate(jpeg, { degrees: "0", flip: "" });
	expect(out.bytes).toBe(jpeg);
	const turned = await rotate(jpeg, { degrees: "90", flip: "" });
	expect(turned.bytes).not.toBe(jpeg);
});
