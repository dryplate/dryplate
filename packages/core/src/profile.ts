import { type Format, sniff } from "./codec";
import { decodedAsSrgb } from "./heic";
import { concat, jpegSegments, pngChunk, pngChunks } from "./metadata";
import type { Op } from "./types";

// Colour profiles are carried across re-encodes: the codecs pass pixel values through untouched,
// so a Display P3 photo saved without its profile would be read as sRGB and look washed out.

const ascii = (b: Uint8Array, i: number, n: number) =>
	String.fromCharCode(...b.subarray(i, i + n));
const u32le = (n: number) => [
	n & 255,
	(n >> 8) & 255,
	(n >> 16) & 255,
	n >>> 24,
];

async function zlib(
	b: Uint8Array<ArrayBuffer>,
	stream: CompressionStream | DecompressionStream,
): Promise<Uint8Array<ArrayBuffer>> {
	const piped = new Blob([b]).stream().pipeThrough(stream);
	return new Uint8Array(await new Response(piped).arrayBuffer());
}

function jpegProfile(b: Uint8Array): Uint8Array | undefined {
	// A profile over 64 KB spans several APP2 segments, numbered from 1.
	const parts: Uint8Array[] = [];
	for (const { marker, payload } of jpegSegments(b))
		if (marker === 0xe2 && ascii(payload, 0, 11) === "ICC_PROFILE")
			parts[(payload[12] as number) - 1] = payload.subarray(14);
	return parts.length ? concat(parts.filter(Boolean)) : undefined;
}

async function pngProfile(b: Uint8Array): Promise<Uint8Array | undefined> {
	for (const { type, data } of pngChunks(b)) {
		if (type === "IDAT") break;
		if (type === "iCCP")
			return zlib(
				data.slice(data.indexOf(0) + 2),
				new DecompressionStream("deflate"),
			);
	}
	return undefined;
}

function webpProfile(b: Uint8Array): Uint8Array | undefined {
	const view = new DataView(b.buffer, b.byteOffset, b.length);
	for (let i = 12; i + 8 <= b.length; ) {
		const size = view.getUint32(i + 4, true);
		if (ascii(b, i, 4) === "ICCP") return b.subarray(i + 8, i + 8 + size);
		i += 8 + size + (size % 2);
	}
	return undefined;
}

// HEIC and AVIF keep it in a `colr` box; an nclx box there just names a colour space and has no profile.
function isoProfile(b: Uint8Array): Uint8Array | undefined {
	const text = new TextDecoder("latin1").decode(b);
	const at = Math.max(text.indexOf("colrprof"), text.indexOf("colrrICC"));
	if (at < 4) return undefined;
	const size = new DataView(b.buffer, b.byteOffset).getUint32(at - 4);
	return b.subarray(at + 8, at - 4 + size);
}

export async function readProfile(
	b: Uint8Array,
): Promise<Uint8Array | undefined> {
	const format = sniff(b);
	const icc =
		format === "jpeg"
			? jpegProfile(b)
			: format === "png"
				? await pngProfile(b)
				: format === "webp"
					? webpProfile(b)
					: isoProfile(b);
	// Our output is always RGB, so a CMYK or grey profile would be wrong on it.
	return icc && ascii(icc, 16, 4) === "RGB " ? icc : undefined;
}

function jpegWithProfile(b: Uint8Array, icc: Uint8Array) {
	const MAX = 65519; // segment limit minus the 16-byte header
	const count = Math.ceil(icc.length / MAX);
	const segs: Uint8Array[] = [];
	for (let n = 0; n < count; n++) {
		const part = icc.subarray(n * MAX, (n + 1) * MAX);
		const len = part.length + 16;
		segs.push(
			new Uint8Array([0xff, 0xe2, len >> 8, len & 255]),
			new TextEncoder().encode("ICC_PROFILE\0"),
			new Uint8Array([n + 1, count]),
			part,
		);
	}
	// After JFIF, which some readers need first.
	const at =
		b[3] === 0xe0 ? 4 + (((b[4] as number) << 8) | (b[5] as number)) : 2;
	return concat([b.subarray(0, at), ...segs, b.subarray(at)]);
}

async function pngWithProfile(b: Uint8Array, icc: Uint8Array<ArrayBuffer>) {
	const packed = await zlib(icc, new CompressionStream("deflate"));
	const name = new TextEncoder().encode("ICC\0\0");
	const chunk = pngChunk("iCCP", concat([name, packed]));
	const ihdrEnd = 8 + 12 + 13;
	return concat([b.subarray(0, ihdrEnd), chunk, b.subarray(ihdrEnd)]);
}

function webpWithProfile(b: Uint8Array, icc: Uint8Array) {
	const tag = (s: string) => new TextEncoder().encode(s);
	const iccp = concat([
		tag("ICCP"),
		new Uint8Array(u32le(icc.length)),
		icc,
		new Uint8Array(icc.length % 2),
	]);
	let head: Uint8Array;
	let rest: Uint8Array;
	if (ascii(b, 12, 4) === "VP8X") {
		head = b.slice(12, 30);
		head[8] = (head[8] as number) | 0x20;
		rest = b.subarray(30);
	} else {
		// A simple WebP has to become the extended form to hold a profile.
		const view = new DataView(b.buffer, b.byteOffset, b.length);
		const lossless = ascii(b, 12, 4) === "VP8L";
		const bits = lossless ? view.getUint32(21, true) : 0;
		const w = lossless
			? (bits & 0x3fff) + 1
			: view.getUint16(26, true) & 0x3fff;
		const h = lossless
			? ((bits >>> 14) & 0x3fff) + 1
			: view.getUint16(28, true) & 0x3fff;
		const alpha = lossless && (bits >>> 28) & 1 ? 0x10 : 0;
		head = concat([
			tag("VP8X"),
			new Uint8Array(u32le(10)),
			new Uint8Array([0x20 | alpha, 0, 0, 0]),
			new Uint8Array(u32le(w - 1)).subarray(0, 3),
			new Uint8Array(u32le(h - 1)).subarray(0, 3),
		]);
		rest = b.subarray(12);
	}
	const size = 4 + head.length + iccp.length + rest.length;
	return concat([
		tag("RIFF"),
		new Uint8Array(u32le(size)),
		tag("WEBP"),
		head,
		iccp,
		rest,
	]);
}

// ponytail: no AVIF output path; the profile sits in nested boxes indexed by iloc offsets, so AVIF output stays untagged until the encoder takes one.
const writers: Partial<
	Record<
		Format,
		(
			b: Uint8Array,
			icc: Uint8Array<ArrayBuffer>,
		) => Uint8Array | Promise<Uint8Array>
	>
> = { jpeg: jpegWithProfile, png: pngWithProfile, webp: webpWithProfile };

const same = (a: Uint8Array, b?: Uint8Array) =>
	!!b && a.length === b.length && a.every((v, i) => v === b[i]);

// Wraps an op so its output carries the input's colour profile. Merge inputs must all agree.
export const keepProfile =
	(op: Op): Op =>
	async (input, opts, all = [input]) => {
		const out = await op(input, opts, all);
		const write = writers[sniff(out.bytes) as Format];
		if (!write || out.bytes === input || all.some(decodedAsSrgb)) return out;
		// The image is already good, so a browser missing CompressionStream or an odd profile must not fail it.
		try {
			const [icc, ...others] = await Promise.all(all.map(readProfile));
			if (!icc || !others.every((p) => same(icc, p))) return out;
			if (await readProfile(out.bytes)) return out;
			const bytes = await write(out.bytes, icc.slice());
			return { ...out, bytes: bytes as Uint8Array<ArrayBuffer> };
		} catch {
			return out;
		}
	};
