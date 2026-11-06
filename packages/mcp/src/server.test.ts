import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decode } from "@dryplate/core";
import { fixture, setupNode } from "@dryplate/core/test-node";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeAll, expect, it } from "vitest";
import { createServer } from "./server";

let client: Client;
let dir: string;
let photo: string;
const call = async (name: string, args: Record<string, unknown>) => {
	const r = (await client.callTool({ name, arguments: args })) as {
		isError?: boolean;
		content: { text: string }[];
	};
	return { error: r.isError === true, text: r.content[0]?.text ?? "" };
};
const size = async (p: string) => {
	const img = await decode(new Uint8Array(await readFile(p)));
	return [img.width, img.height];
};

beforeAll(async () => {
	await setupNode();
	const [a, b] = InMemoryTransport.createLinkedPair();
	await createServer().connect(a);
	client = new Client({ name: "test", version: "0" });
	await client.connect(b);
	dir = await mkdtemp(join(tmpdir(), "dryplate-mcp-"));
	photo = join(dir, "photo.jpg");
	await writeFile(photo, await fixture("photo.jpg"));
});

it("lists all ten tools", async () => {
	const { tools } = await client.listTools();
	expect(tools.map((t) => t.name).sort()).toEqual([
		"blur_image",
		"compress_image",
		"convert_image",
		"crop_image",
		"generate_thumbnail",
		"merge_images",
		"remove_metadata",
		"resize_image",
		"rotate_image",
		"watermark_image",
	]);
});

it("writes next to the input and refuses to overwrite", async () => {
	const r = await call("convert_image", { path: photo, format: "webp" });
	expect(r.error).toBe(false);
	expect(r.text).toContain(join(dir, "photo-converted.webp"));
	expect(
		(await readFile(join(dir, "photo-converted.webp")))
			.subarray(8, 12)
			.toString(),
	).toBe("WEBP");
	const again = await call("convert_image", { path: photo, format: "webp" });
	expect(again).toMatchObject({
		error: true,
		text: expect.stringContaining("exists"),
	});
	expect(
		(
			await call("convert_image", {
				path: photo,
				format: "webp",
				overwrite: true,
			})
		).error,
	).toBe(false);
});

it("resizes, compresses and watermarks", async () => {
	const [w] = await size(photo);
	expect((await call("resize_image", { path: photo, width: 40 })).error).toBe(
		false,
	);
	expect((await size(join(dir, "photo-resized.jpg")))[0]).toBe(40);
	expect(w).toBeGreaterThan(40);
	const c = await call("compress_image", { path: photo, quality: 50 });
	expect(c.error).toBe(false);
	expect(
		(await readFile(join(dir, "photo-compressed.jpg"))).length,
	).toBeLessThanOrEqual((await readFile(photo)).length);
	const out = join(dir, "marked.jpg");
	expect(
		(
			await call("watermark_image", {
				path: photo,
				text: "Dryplate",
				output: out,
			})
		).error,
	).toBe(false);
	expect(await size(out)).toEqual(await size(photo));
});

it("fits thumbnails in the box and never enlarges", async () => {
	expect(
		(await call("generate_thumbnail", { path: photo, size: 32 })).error,
	).toBe(false);
	expect(Math.max(...(await size(join(dir, "photo-thumb.webp"))))).toBe(32);
	const big = join(dir, "big-thumb.png");
	expect(
		(
			await call("generate_thumbnail", {
				path: photo,
				size: 4096,
				format: "png",
				output: big,
			})
		).error,
	).toBe(false);
	expect(await size(big)).toEqual(await size(photo));
});

it("reports errors as tool errors", async () => {
	expect(
		(await call("resize_image", { path: join(dir, "nope.jpg"), width: 10 }))
			.error,
	).toBe(true);
	const r = await call("resize_image", { path: photo });
	expect(r).toMatchObject({
		error: true,
		text: "Set a width, height or percent",
	});
});

it("crops, rotates, blurs areas and removes metadata", async () => {
	const [w, h] = (await size(photo)) as [number, number];
	expect((await call("crop_image", { path: photo, ratio: "2:1" })).error).toBe(
		false,
	);
	const [cw, ch] = (await size(join(dir, "photo-cropped.jpg"))) as [
		number,
		number,
	];
	expect(Math.abs(cw / ch - 2)).toBeLessThan(0.05);
	const boxed = join(dir, "boxed.jpg");
	const half = { x: 0, y: 0, w: 0.5, h: 0.5 };
	expect(
		(await call("crop_image", { path: photo, box: half, output: boxed })).error,
	).toBe(false);
	expect(await size(boxed)).toEqual([Math.round(w / 2), Math.round(h / 2)]);
	const bad = await call("crop_image", { path: photo, box: { ...half, w: 2 } });
	expect(bad.error).toBe(true);

	const turned = join(dir, "turned.png");
	await call("convert_image", { path: boxed, format: "png", output: turned });
	expect(
		(await call("rotate_image", { path: turned, degrees: 90 })).error,
	).toBe(false);
	expect(await size(join(dir, "turned-rotated.png"))).toEqual([
		Math.round(h / 2),
		Math.round(w / 2),
	]);

	const b = await call("blur_image", {
		path: photo,
		areas: [half],
		strength: 30,
	});
	expect(b.error).toBe(false);
	expect(await size(join(dir, "photo-blurred.jpg"))).toEqual([w, h]);

	expect((await call("remove_metadata", { path: photo })).error).toBe(false);
	expect(await size(join(dir, "photo-clean.jpg"))).toEqual([w, h]);
});

it("merges several files into one", async () => {
	const [w, h] = (await size(photo)) as [number, number];
	const r = await call("merge_images", { paths: [photo, photo], gap: 10 });
	expect(r.error).toBe(false);
	expect(await size(join(dir, "photo-merged.jpg"))).toEqual([2 * w + 10, h]);
	const v = join(dir, "stack.jpg");
	await call("merge_images", {
		paths: [photo, photo],
		direction: "vertical",
		output: v,
	});
	expect(await size(v)).toEqual([w, 2 * h]);
	expect((await call("merge_images", { paths: [photo] })).error).toBe(true);
});

it("refuses an output name whose extension doesn't match the result", async () => {
	const png = join(dir, "merged.png");
	const r = await call("merge_images", { paths: [photo, photo], output: png });
	expect(r).toMatchObject({ error: true });
	expect(r.text).toContain("image/jpeg");
	await expect(readFile(png)).rejects.toThrow();
	const jpeg = join(dir, "merged.jpeg");
	expect(
		(await call("merge_images", { paths: [photo, photo], output: jpeg })).error,
	).toBe(false);
});

it("expands ~ and refuses relative or missing paths in plain words", async () => {
	const home = process.env.HOME;
	process.env.HOME = dir; // homedir() reads $HOME
	const r = await call("resize_image", {
		path: "~/photo.jpg",
		overwrite: true,
		width: 30,
	});
	process.env.HOME = home;
	expect(r).toMatchObject({
		error: false,
		text: expect.stringContaining(join(dir, "photo-resized.jpg")),
	});
	expect(await call("resize_image", { path: "photo.jpg", width: 30 })).toEqual({
		error: true,
		text: "photo.jpg is a relative path. Use an absolute path or ~/…",
	});
	expect(
		await call("resize_image", { path: join(dir, "nope.jpg"), width: 30 }),
	).toEqual({ error: true, text: `No file at ${join(dir, "nope.jpg")}.` });
});
