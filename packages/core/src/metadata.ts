// Lossless metadata removal: drop the blocks that carry EXIF/GPS/XMP/comments, keep everything that affects pixels or colour.

export const u16 = (b: Uint8Array, i: number, le = false) =>
	le
		? (b[i] as number) | ((b[i + 1] as number) << 8)
		: ((b[i] as number) << 8) | (b[i + 1] as number);
export const u32 = (b: Uint8Array, i: number, le = false) =>
	le
		? (u16(b, i, true) | (u16(b, i + 2, true) << 16)) >>> 0
		: ((u16(b, i) << 16) | u16(b, i + 2)) >>> 0;
export const ascii = (b: Uint8Array, i: number, n: number) =>
	String.fromCharCode(...b.subarray(i, i + n));

export function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let at = 0;
	for (const p of parts) {
		out.set(p, at);
		at += p.length;
	}
	return out;
}

// EXIF orientation (1–8) from an APP1 payload starting at "Exif\0\0"; 1 when absent or unreadable.
export function exifOrientation(app1: Uint8Array): number {
	if (ascii(app1, 0, 6) !== "Exif\0\0") return 1;
	return tiffOrientation(app1.subarray(6));
}

function tiffOrientation(t: Uint8Array): number {
	const le = ascii(t, 0, 2) === "II";
	const ifd = u32(t, 4, le);
	const count = u16(t, ifd, le);
	for (let k = 0; k < count; k++) {
		const e = ifd + 2 + k * 12;
		if (e + 12 > t.length) break;
		if (u16(t, e, le) === 0x0112) {
			const v = u16(t, e + 8, le);
			return v >= 1 && v <= 8 ? v : 1;
		}
	}
	return 1;
}

// A minimal APP1 holding only Orientation, so stripped photos still display upright.
export function orientationApp1(o: number): Uint8Array {
	return new Uint8Array([
		0xff,
		0xe1,
		0x00,
		0x22,
		0x45,
		0x78,
		0x69,
		0x66,
		0x00,
		0x00,
		0x4d,
		0x4d,
		0x00,
		0x2a,
		0x00,
		0x00,
		0x00,
		0x08,
		0x00,
		0x01,
		0x01,
		0x12,
		0x00,
		0x03,
		0x00,
		0x00,
		0x00,
		0x01,
		0x00,
		o,
		0x00,
		0x00,
		0x00,
		0x00,
		0x00,
		0x00,
	]);
}

// The marker segments before the image data; stops at start of scan, which it yields too.
export function* jpegSegments(b: Uint8Array) {
	let i = 2;
	while (i + 4 <= b.length && b[i] === 0xff) {
		const marker = b[i + 1] as number;
		if (marker === 0xff) {
			i++; // fill byte
			continue;
		}
		const end = i + 2 + u16(b, i + 2);
		yield { marker, start: i, end, payload: b.subarray(i + 4, end) };
		if (marker === 0xda) return;
		i = end;
	}
}

// Offset just past the EOI of the main image, or undefined if the file was cut off. Entropy data escapes 0xFF, so the first real marker is reliable.
export function jpegEnd(b: Uint8Array): number | undefined {
	let scan = b.length;
	for (const s of jpegSegments(b)) if (s.marker === 0xda) scan = s.end;
	// No scan found: not something we can judge, so leave it to the decoder.
	if (scan === b.length) return b.length;
	for (let i = scan; i + 1 < b.length; i++)
		if (b[i] === 0xff && b[i + 1] === 0xd9) return i + 2;
	return undefined;
}

export function jpegOrientation(b: Uint8Array): number {
	let o = 1;
	for (const s of jpegSegments(b))
		if (s.marker === 0xe1) o = Math.max(o, exifOrientation(s.payload));
	return o;
}

export function stripJpeg(b: Uint8Array): Uint8Array<ArrayBuffer> {
	const keep: Uint8Array[] = [b.subarray(0, 2)];
	const orientation = jpegOrientation(b);
	let scan = 2;
	for (const { marker, start, end, payload } of jpegSegments(b)) {
		scan = start;
		if (marker === 0xda) break; // start of scan: the rest is image data
		const isApp = marker >= 0xe0 && marker <= 0xef;
		// Keep JFIF (APP0), ICC colour profiles (APP2) and Adobe colour transform (APP14); drop other APPn and comments.
		const keepApp =
			marker === 0xe0 ||
			marker === 0xee ||
			(marker === 0xe2 && ascii(payload, 0, 11) === "ICC_PROFILE");
		if ((!isApp && marker !== 0xfe) || keepApp)
			keep.push(b.subarray(start, end));
		scan = end;
	}
	if (orientation !== 1) keep.splice(1, 0, orientationApp1(orientation));
	// Anything after EOI (MPF images, HDR gain maps) carries its own EXIF, so it goes too.
	keep.push(b.subarray(scan, jpegEnd(b) ?? b.length));
	return concat(keep);
}

// PNG text, time and EXIF chunks go; colour (iCCP, sRGB, gAMA, cHRM), transparency and layout chunks stay.
const PNG_DROP = new Set(["tEXt", "zTXt", "iTXt", "eXIf", "tIME"]);

const CRC = Array.from({ length: 256 }, (_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	return c >>> 0;
});

export function pngChunk(type: string, data: Uint8Array): Uint8Array {
	const out = new Uint8Array(12 + data.length);
	const view = new DataView(out.buffer);
	view.setUint32(0, data.length);
	out.set(new TextEncoder().encode(type), 4);
	out.set(data, 8);
	let c = 0xffffffff;
	for (const byte of out.subarray(4, 8 + data.length))
		c = (CRC[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
	view.setUint32(8 + data.length, (c ^ 0xffffffff) >>> 0);
	return out;
}

export function* pngChunks(b: Uint8Array) {
	for (let i = 8; i + 12 <= b.length; ) {
		const end = i + 12 + u32(b, i);
		yield {
			type: ascii(b, i + 4, 4),
			start: i,
			end,
			data: b.subarray(i + 8, end - 4),
		};
		i = end;
	}
}

export function pngOrientation(b: Uint8Array): number {
	for (const c of pngChunks(b))
		if (c.type === "eXIf") return tiffOrientation(c.data);
	return 1;
}

export function stripPng(b: Uint8Array): Uint8Array<ArrayBuffer> {
	const keep: Uint8Array[] = [b.subarray(0, 8)];
	const orientation = pngOrientation(b);
	for (const c of pngChunks(b)) {
		if (!PNG_DROP.has(c.type)) keep.push(b.subarray(c.start, c.end));
		// Only the orientation survives, so stripped photos still display upright.
		if (c.type === "IHDR" && orientation !== 1)
			keep.push(pngChunk("eXIf", orientationApp1(orientation).subarray(10)));
	}
	return concat(keep);
}

// WebP: drop EXIF and XMP chunks and clear their flags in VP8X; RIFF size is rewritten.
export function stripWebp(b: Uint8Array): Uint8Array<ArrayBuffer> {
	const keep: Uint8Array[] = [];
	for (let i = 12; i + 8 <= b.length; ) {
		const size = u32(b, i + 4, true);
		const end = i + 8 + size + (size % 2);
		const id = ascii(b, i, 4);
		if (id === "VP8X") {
			const chunk = b.slice(i, end);
			chunk[8] = (chunk[8] as number) & ~0x0c; // EXIF (0x08) and XMP (0x04) flags
			keep.push(chunk);
		} else if (id !== "EXIF" && id !== "XMP ") keep.push(b.subarray(i, end));
		i = end;
	}
	const body = concat(keep);
	const head = new Uint8Array(12);
	head.set(b.subarray(0, 4));
	new DataView(head.buffer).setUint32(4, body.length + 4, true);
	head.set(b.subarray(8, 12), 8);
	return concat([head, body]);
}
