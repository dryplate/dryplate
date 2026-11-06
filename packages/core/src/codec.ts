import { decodeHeic, decodeNative } from "./heic";
import { jpegEnd, pngChunks, pngOrientation } from "./metadata";
import { rotateImage } from "./pixels";

export type Format = "jpeg" | "png" | "webp" | "avif";

export const MIME: Record<Format, string> = {
	jpeg: "image/jpeg",
	png: "image/png",
	webp: "image/webp",
	avif: "image/avif",
};

const ascii = (b: Uint8Array, start: number, end: number) =>
	String.fromCharCode(...b.subarray(start, end));

// Trust the bytes, not the file name or browser MIME type (often empty or wrong for HEIC/AVIF).
export function sniff(b: Uint8Array): Format | "heic" | undefined {
	if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
	if (b[0] === 0x89 && ascii(b, 1, 4) === "PNG") return "png";
	if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP") return "webp";
	if (ascii(b, 4, 8) === "ftyp") {
		// Many encoders write a generic "mif1" major brand and name the real codec in the compatible brands.
		const brands = [ascii(b, 8, 12)];
		const end = Math.min(
			b.length,
			new DataView(b.buffer, b.byteOffset).getUint32(0),
		);
		for (let i = 16; i + 4 <= end; i += 4) brands.push(ascii(b, i, i + 4));
		if (brands.includes("avif") || brands.includes("avis")) return "avif";
		if (
			brands.some((x) =>
				["heic", "heix", "hevc", "heim", "heis", "mif1", "msf1"].includes(x),
			)
		)
			return "heic";
	}
	return undefined;
}

// Ops that edit pixels keep the input format; HEIC has no browser-friendly encoder, so it becomes JPEG.
export function keepFormat(bytes: Uint8Array): Format {
	const src = sniff(bytes);
	return src === "heic" || !src ? "jpeg" : src;
}

export function parseFormat(s: string | undefined): Format {
	if (s === "jpeg" || s === "png" || s === "webp" || s === "avif") return s;
	throw new Error(`Unsupported output format: ${s}`);
}

// Node swaps these for Sharp; everything above them (op logic, profiles, errors) stays shared.
export type Engine = {
	decode(bytes: Uint8Array<ArrayBuffer>, format: Format): Promise<ImageData>;
	encode(
		img: ImageData,
		format: Format,
		quality: number,
	): Promise<Uint8Array<ArrayBuffer>>;
	resize(img: ImageData, width: number, height: number): Promise<ImageData>;
	// Must look like `blurImage`: three box passes of radius r, premultiplied alpha.
	blur(img: ImageData, radius: number): Promise<ImageData>;
	optimisePng(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>>;
	watermark(
		img: ImageData,
		opts: Record<string, string | undefined>,
	): Promise<{ img: ImageData; squeezed: boolean }>;
};

let active: Engine | undefined;
export const setEngine = (e: Engine | undefined) => {
	active = e;
};
export const engine = () => active;

// Each codec is imported on first use so its WASM only downloads when needed.
const decoders = {
	jpeg: () => import("@jsquash/jpeg/decode.js"),
	png: () => import("@jsquash/png/decode.js"),
	webp: () => import("@jsquash/webp/decode.js"),
	avif: () => import("@jsquash/avif/decode.js"),
};

const encoders = {
	jpeg: () => import("@jsquash/jpeg/encode.js"),
	png: () => import("@jsquash/png/encode.js"),
	webp: () => import("@jsquash/webp/encode.js"),
	avif: () => import("@jsquash/avif/encode.js"),
};

export async function decode(
	bytes: Uint8Array<ArrayBuffer>,
): Promise<ImageData> {
	const format = sniff(bytes);
	if (format === "heic") return decodeHeic(bytes);
	if (!format)
		throw new Error(
			"This isn't a supported image. Use JPG, PNG, WebP, AVIF or HEIC.",
		);
	if (isAnimated(bytes, format))
		throw new Error("Animated images aren't supported.");
	if (format === "jpeg" && jpegEnd(bytes) === undefined)
		throw new Error(
			"This JPG is incomplete: the file was cut off. Copy it again from the original.",
		);
	const img = await (
		active?.decode(bytes, format) ?? wasmDecode(bytes, format)
	).catch(() => undefined);
	if (img) return format === "png" ? uprightPng(img, bytes) : img;
	// The browser reads JPEGs mozjpeg can't, such as CMYK ones from print workflows.
	const native = format === "jpeg" && (await decodeNative(bytes, MIME.jpeg));
	if (native) return native;
	throw new Error(
		"Couldn't read this image. It may be damaged or too large for this device.",
	);
}

async function wasmDecode(bytes: Uint8Array<ArrayBuffer>, format: Format) {
	const { default: run } = await decoders[format]();
	const buf = bytes.buffer.slice(
		bytes.byteOffset,
		bytes.byteOffset + bytes.byteLength,
	);
	// jSquash names it oddly: preserveOrientation: true is what applies the EXIF rotation.
	return (run as (b: ArrayBuffer, o?: object) => Promise<ImageData>)(
		buf,
		format === "jpeg" ? { preserveOrientation: true } : undefined,
	);
}

function isAnimated(b: Uint8Array, format: Format): boolean {
	if (format === "webp")
		return ascii(b, 12, 16) === "VP8X" && !!((b[20] as number) & 2);
	if (format !== "png") return false;
	for (const c of pngChunks(b)) {
		if (c.type === "acTL") return true;
		if (c.type === "IDAT") break;
	}
	return false;
}

// EXIF orientation value → [clockwise degrees, flip H, flip V].
const ORIENT: Record<number, [number, boolean, boolean]> = {
	2: [0, true, false],
	3: [180, false, false],
	4: [0, false, true],
	5: [90, true, false],
	6: [90, false, false],
	7: [90, false, true],
	8: [270, false, false],
};

// mozjpeg applies EXIF rotation for JPEGs; PNG needs the same so edits match what the browser shows.
function uprightPng(img: ImageData, bytes: Uint8Array): ImageData {
	const o = ORIENT[pngOrientation(bytes)];
	return o ? rotateImage(img, ...o) : img;
}

// JPEG has no alpha; mozjpeg drops it, so transparent pixels would turn black. Composite onto white first.
export function flattenOnWhite(img: ImageData): ImageData {
	const d = img.data;
	for (let i = 0; i < d.length; i += 4) {
		const a = (d[i + 3] ?? 255) / 255;
		if (a === 1) continue;
		d[i] = Math.round((d[i] ?? 0) * a + 255 * (1 - a));
		d[i + 1] = Math.round((d[i + 1] ?? 0) * a + 255 * (1 - a));
		d[i + 2] = Math.round((d[i + 2] ?? 0) * a + 255 * (1 - a));
		d[i + 3] = 255;
	}
	return img;
}

export async function encode(
	img: ImageData,
	format: Format,
	quality = 80,
): Promise<Uint8Array<ArrayBuffer>> {
	const src = format === "jpeg" ? flattenOnWhite(img) : img;
	if (active) return active.encode(src, format, quality);
	const { default: run } = (await encoders[format]()) as {
		default: (
			img: ImageData,
			opts?: { quality?: number },
		) => Promise<ArrayBuffer>;
	};
	return new Uint8Array(
		await run(src, format === "png" ? undefined : { quality }),
	);
}

export async function scale(
	img: ImageData,
	size: { width: number; height: number },
): Promise<ImageData> {
	if (active) return active.resize(img, size.width, size.height);
	const { default: run } = await import("@jsquash/resize");
	return run(img, size);
}
