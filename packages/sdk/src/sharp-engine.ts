import type { Engine } from "@dryplate/core";
import { drawWatermark } from "@dryplate/core/watermark-draw";
import sharp, { type Sharp } from "sharp";

// libheif and the shared pixel ops build ImageData, which Node doesn't have.
globalThis.ImageData ??= class {
	data: Uint8ClampedArray;
	width: number;
	height: number;
	constructor(a: Uint8ClampedArray | number, b: number, c?: number) {
		this.data = typeof a === "number" ? new Uint8ClampedArray(a * b * 4) : a;
		this.width = typeof a === "number" ? a : b;
		this.height = c ?? this.data.length / 4 / this.width;
	}
} as unknown as typeof ImageData;

const fromRaw = (img: ImageData) =>
	sharp(img.data, {
		raw: { width: img.width, height: img.height, channels: 4 },
	});

async function toImage(pipeline: Sharp): Promise<ImageData> {
	const { data, info } = await pipeline
		.toColourspace("srgb")
		.ensureAlpha()
		.raw({ depth: "uchar" })
		.toBuffer({ resolveWithObject: true });
	return new ImageData(
		new Uint8ClampedArray(data.buffer, data.byteOffset, data.length),
		info.width,
		info.height,
	);
}

const bytesOf = async (pipeline: Sharp) =>
	new Uint8Array(await pipeline.toBuffer()) as Uint8Array<ArrayBuffer>;

const escapeXml = (s: string) =>
	s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// drawWatermark only needs a small part of the canvas API, so this records it as SVG for Sharp to composite.
function svgContext() {
	const body: string[] = [];
	const open = [0];
	const group = (transform: string) => {
		body.push(`<g transform="${transform}">`);
		open[open.length - 1] = (open.at(-1) as number) + 1;
	};
	const ctx = {
		font: "",
		textAlign: "center",
		textBaseline: "middle",
		globalAlpha: 1,
		shadowColor: "",
		shadowBlur: 0,
		fillStyle: "#ffffff",
		// ponytail: average glyph width, no font metrics in Node. Long text can land a little off; use real metrics if it matters.
		measureText: (text: string) => ({
			width:
				text.length * Number.parseInt(ctx.font.split(" ")[1] ?? "", 10) * 0.55,
		}),
		save: () => open.push(0),
		restore: () => body.push("</g>".repeat(open.pop() ?? 0)),
		translate: (x: number, y: number) => group(`translate(${x} ${y})`),
		rotate: (radians: number) => group(`rotate(${(radians * 180) / Math.PI})`),
		fillText: (text: string, x: number, y: number) =>
			body.push(`<text x="${x}" y="${y}">${escapeXml(text)}</text>`),
	};
	return { ctx, body };
}

export const sharpEngine: Engine = {
	// keepIccProfile stops Sharp converting to sRGB: core re-attaches the input profile, as it does in the browser.
	// Only JPEG auto-rotates here: core straightens PNG itself, and leaves WebP as stored.
	decode: (bytes, format) => {
		const input = sharp(bytes).keepIccProfile();
		return toImage(format === "jpeg" ? input.autoOrient() : input);
	},

	encode: (img, format, quality) => {
		const input = fromRaw(img);
		if (format === "png") return bytesOf(input.png({ compressionLevel: 9 }));
		if (format === "jpeg")
			return bytesOf(input.jpeg({ quality, mozjpeg: true }));
		return bytesOf(input[format]({ quality }));
	},

	resize: (img, width, height) =>
		toImage(fromRaw(img).resize(width, height, { fit: "fill" })),

	// Three box passes of radius r have the variance of a Gaussian with sigma √(r(r+1)). Sharp premultiplies alpha itself.
	blur: async (img, r) =>
		r < 1
			? img
			: toImage(fromRaw(img).blur(Math.min(1000, Math.sqrt(r * (r + 1))))),

	// keepMetadata because a dropped orientation tag would turn the photo sideways.
	optimisePng: (bytes) =>
		bytesOf(
			sharp(bytes).keepMetadata().png({ compressionLevel: 9, effort: 10 }),
		),

	watermark: async (img, opts) => {
		const { ctx, body } = svgContext();
		const { squeezed } = drawWatermark(
			ctx as unknown as OffscreenCanvasRenderingContext2D,
			img.width,
			img.height,
			opts,
		);
		const [weight, size, ...family] = ctx.font.split(" ");
		const blur = ctx.shadowBlur;
		const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${img.width}" height="${img.height}">
<filter id="s" x="-20%" y="-50%" width="140%" height="200%"><feDropShadow dx="0" dy="0" stdDeviation="${blur / 2}" flood-color="#000" flood-opacity="0.5"/></filter>
<g filter="url(#s)" fill="${ctx.fillStyle}" opacity="${ctx.globalAlpha}" font-weight="${weight}" font-size="${size}" font-family="${escapeXml(family.join(" "))}" text-anchor="middle" dominant-baseline="central">${body.join("")}</g>
</svg>`;
		return {
			img: await toImage(fromRaw(img).composite([{ input: Buffer.from(svg) }])),
			squeezed,
		};
	},
};
