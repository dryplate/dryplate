import { access, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, extname, isAbsolute, join } from "node:path";
import { image, type OpResult } from "@dryplate/sdk";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import pkg from "../package.json" with { type: "json" };

// Tools take and return file paths, not image bytes: base64 images would fill the agent's context.
const path = z
	.string()
	.describe(
		"Absolute path (or ~/…) of the image to read: JPEG, PNG, WebP, AVIF or HEIC. HEIC is written as JPEG unless a format is chosen.",
	);
const common = {
	output: z
		.string()
		.optional()
		.describe(
			"Where to write. Default: next to the input, like photo-resized.jpg",
		),
	overwrite: z
		.boolean()
		.optional()
		.describe("Replace an existing output file. Default false"),
	quality: z.number().int().min(1).max(100).optional().describe("1–100"),
};
type Common = {
	path?: string;
	paths?: string[];
	output?: string;
	overwrite?: boolean;
};

const ext = (type: string) =>
	type === "image/jpeg" ? ".jpg" : `.${type.split("/")[1]}`;
// The server's working directory is whatever the client chose (Claude Desktop uses /), so a relative path means nothing.
function place(p: string) {
	const full =
		p === "~" || p.startsWith("~/") ? join(homedir(), p.slice(1)) : p;
	if (!isAbsolute(full))
		throw new Error(`${p} is a relative path. Use an absolute path or ~/…`);
	return full;
}
async function read(f: string) {
	return readFile(f).catch((e: NodeJS.ErrnoException) => {
		throw e.code === "ENOENT" ? new Error(`No file at ${f}.`) : e;
	});
}
const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;

async function save(
	args: Common,
	src: string,
	suffix: string,
	inBytes: number,
	out: OpResult,
) {
	const dest = args.output
		? place(args.output)
		: join(
				dirname(src),
				`${basename(src, extname(src))}-${suffix}${ext(out.type)}`,
			);
	// A named output must not lie about its format: photo.png holding JPEG bytes breaks whatever opens it next.
	const want = extname(dest).toLowerCase();
	if (
		args.output &&
		want &&
		want !== ext(out.type) &&
		!(want === ".jpeg" && out.type === "image/jpeg")
	)
		throw new Error(
			`${basename(dest)} doesn't match the result, which is ${out.type}. Use a ${ext(out.type)} name, or convert_image for another format.`,
		);
	// Never destroy a file the caller did not name for replacement.
	if (
		!args.overwrite &&
		(await access(dest).then(
			() => true,
			() => false,
		))
	)
		throw new Error(
			`${dest} exists. Pass overwrite: true or a different output.`,
		);
	await writeFile(dest, out.bytes);
	// A 1.7 MB photo → 10 KB thumbnail is -99.4%; rounding would print -100%, which reads as empty.
	const pct = Math.max(-99, Math.round((out.bytes.length / inBytes - 1) * 100));
	const note = out.note ? ` ${out.note}` : "";
	return `Wrote ${dest} (${out.type}, ${kb(inBytes)} → ${kb(out.bytes.length)}, ${pct >= 0 ? "+" : ""}${pct}%).${note}`;
}

type Shape = Record<string, z.ZodType>;
function tool<S extends Shape>(
	server: McpServer,
	name: string,
	description: string,
	shape: S,
	suffix: string,
	// `all` holds every input when the shape has `paths` (merge); otherwise just the one.
	work: (
		input: Uint8Array,
		args: z.infer<z.ZodObject<S & typeof common>>,
		all: Uint8Array[],
	) => Promise<OpResult>,
) {
	server.registerTool(
		name,
		// Typed as the common part only: the SDK's types cannot follow a generic shape.
		{ description, inputSchema: { ...common, ...shape } as typeof common },
		async (args) => {
			try {
				const a = args as Common;
				const files = (a.paths ?? [a.path as string]).map(place);
				const inputs = await Promise.all(files.map(read));
				const out = await work(inputs[0] as Uint8Array, args as never, inputs);
				const total = inputs.reduce((n, b) => n + b.length, 0);
				const text = await save(a, files[0] as string, suffix, total, out);
				return { content: [{ type: "text" as const, text }] };
			} catch (e) {
				return {
					isError: true,
					content: [
						{ type: "text" as const, text: String((e as Error).message ?? e) },
					],
				};
			}
		},
	);
}

export function createServer() {
	const server = new McpServer({ name: "dryplate", version: pkg.version });
	const px = z.number().int().positive();

	tool(
		server,
		"convert_image",
		"Convert an image to JPEG, PNG, WebP or AVIF, on this machine.",
		{
			path,
			format: z.enum(["jpeg", "png", "webp", "avif"]),
		},
		"converted",
		(b, a) => image.convert(b, { format: a.format, quality: a.quality }),
	);

	tool(
		server,
		"resize_image",
		"Resize an image, keeping its aspect ratio. Width and height together fit the image inside that box.",
		{
			path,
			width: px.optional(),
			height: px.optional(),
			percent: z.number().positive().optional(),
		},
		"resized",
		(b, a) =>
			image.resize(b, {
				width: a.width,
				height: a.height,
				percent: a.percent,
				quality: a.quality,
			}),
	);

	tool(
		server,
		"compress_image",
		"Make an image file smaller in its own format. Never returns a bigger file.",
		{
			path,
			maxKb: z.number().positive().optional().describe("Target size in KB"),
		},
		"compressed",
		(b, a) => image.compress(b, { maxKb: a.maxKb, quality: a.quality }),
	);

	tool(
		server,
		"watermark_image",
		"Draw a text watermark on an image.",
		{
			path,
			text: z.string().min(1),
			size: z
				.number()
				.positive()
				.optional()
				.describe("Text height as % of the short side. Default 5"),
			opacity: z
				.number()
				.min(5)
				.max(100)
				.optional()
				.describe("Percent. Default 60"),
			x: z
				.number()
				.min(0)
				.max(1)
				.optional()
				.describe("0 left … 1 right. Default 1"),
			y: z
				.number()
				.min(0)
				.max(1)
				.optional()
				.describe("0 top … 1 bottom. Default 1"),
			tile: z.boolean().optional().describe("Repeat across the image"),
		},
		"watermarked",
		(b, a) =>
			image.watermark(b, {
				text: a.text,
				size: a.size,
				opacity: a.opacity,
				x: a.x,
				y: a.y,
				tile: a.tile,
				quality: a.quality,
			}),
	);

	tool(
		server,
		"generate_thumbnail",
		"Make a small preview that fits inside a square box. Default 256 px WebP.",
		{
			path,
			size: px.max(4096).optional().describe("Box edge in px. Default 256"),
			format: z.enum(["jpeg", "png", "webp", "avif"]).optional(),
		},
		"thumb",
		async (b, a) => {
			const box = a.size ?? 256;
			const small = await image.resize(b, { width: box, height: box });
			// ponytail: resize only sets a note when it enlarges; then keep the original size. Breaks if resize adds other notes.
			return image.convert(small.note ? b : small.bytes, {
				format: a.format ?? "webp",
				quality: a.quality,
			});
		},
	);

	const box = z
		.object({
			x: z.number().min(0).max(1),
			y: z.number().min(0).max(1),
			w: z.number().gt(0).max(1),
			h: z.number().gt(0).max(1),
		})
		.describe("Fractions of the image, 0–1, from the top left");
	const boxText = (b: z.infer<typeof box>) => `${b.x},${b.y},${b.w},${b.h}`;

	tool(
		server,
		"crop_image",
		"Crop an image to a centred aspect ratio, or to a box.",
		{
			path,
			ratio: z
				.string()
				.regex(/^\d+:\d+$/)
				.optional()
				.describe('Centred crop, like "1:1" or "16:9"'),
			box: box.optional(),
		},
		"cropped",
		(b, a) =>
			image.crop(b, {
				ratio: a.ratio,
				box: a.box && boxText(a.box),
				quality: a.quality,
			}),
	);

	tool(
		server,
		"rotate_image",
		"Rotate an image clockwise, and or flip it.",
		{
			path,
			degrees: z
				.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)])
				.optional()
				.describe("Clockwise. Default 90"),
			flip: z
				.enum(["h", "v"])
				.optional()
				.describe("h mirrors left-right, v top-bottom"),
		},
		"rotated",
		(b, a) =>
			image.rotate(b, { degrees: a.degrees, flip: a.flip, quality: a.quality }),
	);

	tool(
		server,
		"blur_image",
		"Blur a whole image, or only some areas of it (faces, plates, text).",
		{
			path,
			strength: z.number().min(1).max(100).optional().describe("Default 20"),
			areas: z.array(box).min(1).optional().describe("Blur only these boxes"),
		},
		"blurred",
		(b, a) =>
			image.blur(b, {
				strength: a.strength,
				areas: a.areas?.map(boxText).join(";"),
				quality: a.quality,
			}),
	);

	tool(
		server,
		"remove_metadata",
		"Remove location, camera and other hidden data. Lossless for JPEG, PNG and WebP; orientation is kept. HEIC and AVIF are re-encoded as JPEG, which can be bigger than the original.",
		{ path },
		"clean",
		(b, a) => image.removeMetadata(b, { quality: a.quality }),
	);

	tool(
		server,
		"merge_images",
		"Combine images side by side or stacked, scaled to the smallest shared edge.",
		{
			paths: z.array(z.string()).min(2).describe("Image files, in order"),
			direction: z
				.enum(["horizontal", "vertical"])
				.optional()
				.describe("Default horizontal"),
			gap: z
				.number()
				.int()
				.min(0)
				.max(500)
				.optional()
				.describe("Pixels between images"),
			background: z.enum(["white", "black", "transparent"]).optional(),
		},
		"merged",
		(_, a, all) =>
			image.merge(all, {
				direction: a.direction,
				gap: a.gap,
				background: a.background,
				quality: a.quality,
			}),
	);

	return server;
}
