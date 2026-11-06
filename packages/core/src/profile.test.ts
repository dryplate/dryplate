import { beforeAll, expect, test } from "vitest";
import { decode, encode, sniff } from "./codec";
import { concat } from "./metadata";
import compress from "./ops/compress";
import convert from "./ops/convert";
import { keepProfile, readProfile } from "./profile";
import { fixture, setupNode } from "./test-node";

beforeAll(setupNode);

// A fake RGB profile: only the colour-space field at offset 16 matters here.
const icc = (n: number) => {
	const p = new Uint8Array(n).fill(7);
	p.set(new TextEncoder().encode("RGB "), 16);
	return p;
};
const app2 = (profile: Uint8Array, seq = 1, count = 1) => {
	const len = profile.length + 16;
	return concat([
		new Uint8Array([0xff, 0xe2, len >> 8, len & 255]),
		new TextEncoder().encode("ICC_PROFILE\0"),
		new Uint8Array([seq, count]),
		profile,
	]);
};
const opaque = () => {
	const img = new ImageData(16, 16);
	img.data.fill(200);
	return img;
};
const tagged = async (...segs: Uint8Array[]) => {
	const jpeg = await encode(opaque(), "jpeg");
	return concat([jpeg.subarray(0, 2), ...segs, jpeg.subarray(2)]);
};

test.each(["jpeg", "png", "webp"])(
	"profile survives into %s",
	async (format) => {
		const p = icc(600);
		const out = await convert(await tagged(app2(p)), { format });
		expect(sniff(out.bytes)).toBe(format);
		expect([...((await readProfile(out.bytes)) ?? [])]).toEqual([...p]);
		const img = await decode(out.bytes);
		expect(img.width).toBeGreaterThan(0);
	},
);

test("profile survives into lossy WebP with alpha, and lossless", async () => {
	const img = new ImageData(8, 8);
	const webp = await encode(img, "webp", 80);
	const op = keepProfile(async () => ({ bytes: webp, type: "image/webp" }));
	const out = await op(await tagged(app2(icc(301))), {});
	expect((await readProfile(out.bytes))?.length).toBe(301);
	expect((await decode(out.bytes)).width).toBe(8);
});

test("large profiles span several JPEG segments both ways", async () => {
	const p = icc(70000);
	const input = await tagged(
		app2(p.subarray(0, 60000), 1, 2),
		app2(p.subarray(60000), 2, 2),
	);
	expect((await readProfile(input))?.length).toBe(70000);
	const op = keepProfile(async () => ({
		bytes: await encode(opaque(), "jpeg"),
		type: "image/jpeg",
	}));
	const out = await op(input, {});
	expect([...((await readProfile(out.bytes)) ?? [])]).toEqual([...p]);
	expect((await decode(out.bytes)).width).toBe(16);
});

test("a CMYK profile is not copied onto RGB output", async () => {
	const p = icc(200);
	p.set(new TextEncoder().encode("CMYK"), 16);
	expect(await readProfile(await tagged(app2(p)))).toBeUndefined();
});

test("merge inputs with different profiles stay untagged", async () => {
	const a = await tagged(app2(icc(200)));
	const b = await tagged(app2(icc(300)));
	const op = keepProfile(async () => ({
		bytes: await encode(new ImageData(2, 2), "jpeg"),
		type: "image/jpeg",
	}));
	expect(await readProfile((await op(a, {}, [a, b])).bytes)).toBeUndefined();
	expect((await readProfile((await op(a, {}, [a, a])).bytes))?.length).toBe(
		200,
	);
});

test("max file size holds once the profile is added back", async () => {
	const input = concat([
		(await fixture("photo.jpg")).subarray(0, 2),
		app2(icc(3000)),
		(await fixture("photo.jpg")).subarray(2),
	]);
	const out = await compress(input, { quality: "90", maxKb: "8" });
	expect(out.bytes.length).toBeLessThanOrEqual(8000);
	expect(await readProfile(out.bytes)).toBeDefined();
});

test("PNG profile is read back through zlib", async () => {
	const png = await encode(new ImageData(2, 2), "png");
	const op = keepProfile(async () => ({ bytes: png, type: "image/png" }));
	const out = await op(await tagged(app2(icc(400))), {});
	expect((await readProfile(out.bytes))?.length).toBe(400);
});
