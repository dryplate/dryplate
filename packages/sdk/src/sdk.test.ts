import { decode, readProfile, setEngine, sniff } from "@dryplate/core";
import { fixture, setupNode } from "@dryplate/core/test-node";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { image } from "./index";
import { sharpEngine } from "./sharp-engine";

const photo = () => fixture("photo.jpg");
const size = async (b: Uint8Array) => {
	const m = await sharp(b).metadata();
	return [m.width, m.height];
};
// Average per-channel difference, 0–255. Sizes must match.
async function diff(a: Uint8Array, b: Uint8Array) {
	const [x, y] = [
		await decode(a as Uint8Array<ArrayBuffer>),
		await decode(b as Uint8Array<ArrayBuffer>),
	];
	expect([x.width, x.height]).toEqual([y.width, y.height]);
	let sum = 0;
	for (let i = 0; i < x.data.length; i++)
		sum += Math.abs((x.data[i] ?? 0) - (y.data[i] ?? 0));
	return sum / x.data.length;
}

beforeAll(async () => {
	await setupNode();
	setEngine(sharpEngine);
});

describe("Sharp matches the browser codecs", () => {
	const both = async (
		fn: (input: Uint8Array) => Promise<{ bytes: Uint8Array }>,
		input: Uint8Array,
	) => {
		const node = await fn(input);
		setEngine(undefined);
		const browser = await fn(input).finally(() => setEngine(sharpEngine));
		setEngine(undefined);
		return diff(node.bytes, browser.bytes).finally(() =>
			setEngine(sharpEngine),
		);
	};
	const cases: [string, (b: Uint8Array) => Promise<{ bytes: Uint8Array }>][] = [
		["convert webp", (b) => image.convert(b, { format: "webp" })],
		["convert png", (b) => image.convert(b, { format: "png" })],
		["compress", (b) => image.compress(b, { quality: 60 })],
		["resize", (b) => image.resize(b, { width: 300 })],
		["crop", (b) => image.crop(b, { ratio: "1:1" })],
		["rotate", (b) => image.rotate(b, { degrees: 90, flip: "h" })],
		["blur", (b) => image.blur(b, { strength: 30 })],
	];
	for (const [name, fn] of cases)
		it(name, async () => {
			expect(await both(fn, await photo())).toBeLessThan(6);
		});
	it("blur with transparency", async () => {
		// Red on the left, clear black on the right: an unpremultiplied blur leaves a dark seam.
		const px = new Uint8Array(64 * 32 * 4);
		for (let i = 0; i < px.length; i += 4)
			if ((i / 4) % 64 < 32) px.set([255, 0, 0, 255], i);
		const half = await sharp(px, {
			raw: { width: 64, height: 32, channels: 4 },
		})
			.png()
			.toBuffer();
		const blur = (b: Uint8Array) => image.blur(b, { strength: 100 });
		expect(await both(blur, half)).toBeLessThan(6);
		const out = await decode((await blur(half)).bytes);
		const seam = out.data.subarray((16 * 64 + 33) * 4, (16 * 64 + 34) * 4);
		expect(seam[3]).toBeGreaterThan(0);
		expect(seam[3]).toBeLessThan(255);
		expect(seam[0]).toBeGreaterThan(240);
	});
	it("merge", async () => {
		const p = await photo();
		expect(await both((b) => image.merge([b, b], { gap: 10 }), p)).toBeLessThan(
			6,
		);
	});
});

describe("Node behaviour", () => {
	it("decodes iPhone HEIC to JPEG", async () => {
		const out = await image.convert(await fixture("photo.heic"), {
			format: "jpeg",
		});
		expect(sniff(out.bytes)).toBe("jpeg");
	});

	it("applies EXIF orientation", async () => {
		const sideways = await sharp({
			create: { width: 40, height: 20, channels: 3, background: "#f00" },
		})
			.withMetadata({ orientation: 6 })
			.jpeg()
			.toBuffer();
		const out = await image.resize(sideways, { percent: 100 });
		expect(await size(out.bytes)).toEqual([20, 40]);
	});

	it("keeps a wide-gamut profile and its pixels", async () => {
		const p3 = await sharp({
			create: { width: 8, height: 8, channels: 3, background: "#c04020" },
		})
			.withIccProfile("p3")
			.jpeg({ quality: 100 })
			.toBuffer();
		const out = await image.convert(p3, { format: "jpeg", quality: 100 });
		expect(await readProfile(out.bytes)).toEqual(await readProfile(p3));
		setEngine(undefined);
		const stored = await decode(new Uint8Array(p3));
		setEngine(sharpEngine);
		const kept = await decode(out.bytes);
		expect(Math.abs((kept.data[0] ?? 0) - (stored.data[0] ?? 0))).toBeLessThan(
			4,
		);
	});

	it("reads greyscale and flattens transparency for JPEG", async () => {
		const grey = await sharp({
			create: { width: 4, height: 4, channels: 3, background: "#808080" },
		})
			.greyscale()
			.png()
			.toBuffer();
		expect((await image.resize(grey, { width: 2 })).type).toBe("image/png");
		const clear = await sharp({
			create: {
				width: 4,
				height: 4,
				channels: 4,
				background: { r: 0, g: 0, b: 0, alpha: 0 },
			},
		})
			.png()
			.toBuffer();
		const jpg = await image.convert(clear, { format: "jpeg", quality: 100 });
		expect((await decode(jpg.bytes)).data[0]).toBeGreaterThan(250);
	});

	it("compress never grows a file and honours maxKb", async () => {
		const input = await photo();
		const out = await image.compress(input, { quality: 100 });
		expect(out.bytes.length).toBeLessThanOrEqual(input.length);
		const small = await image.compress(input, { maxKb: 5 });
		expect(small.bytes.length).toBeLessThanOrEqual(5000);
	});

	it("draws a watermark and treats text as text", async () => {
		const input = await image.resize(await photo(), { width: 400 });
		const out = await image.watermark(input.bytes, {
			text: `<script>&"'`,
			size: 12,
			opacity: 100,
		});
		expect(await size(out.bytes)).toEqual(await size(input.bytes));
		expect(await diff(out.bytes, input.bytes)).toBeGreaterThan(0.2);
		const tiled = await image.watermark(input.bytes, {
			text: "draft",
			tile: true,
			angle: 30,
		});
		expect(await diff(tiled.bytes, input.bytes)).toBeGreaterThan(0.5);
	});

	it("removes metadata without re-encoding", async () => {
		const tagged = await sharp(await photo())
			.withExif({ IFD0: { Copyright: "secret" } })
			.toBuffer();
		const out = await image.removeMetadata(tagged);
		expect((await sharp(out.bytes).metadata()).exif).toBeUndefined();
	});

	it("rejects files that aren't images", async () => {
		await expect(
			image.resize(new TextEncoder().encode("hello"), { width: 10 }),
		).rejects.toThrow("supported image");
	});
});
