import { expect, test } from "vitest";
import { readExif } from "./exif";
import { concat } from "./metadata";

const JPEG_END = [0xff, 0xda, 0, 2, 0xff, 0xd9];

// A little-endian TIFF: Make, GPS pointer and a GPS block with latitude only plus longitude.
function tiff(): Uint8Array {
	const t = new Uint8Array(200);
	const v = new DataView(t.buffer);
	t.set([0x49, 0x49, 0x2a, 0]);
	v.setUint32(4, 8, true);
	v.setUint16(8, 2, true);
	const entry = (
		at: number,
		tag: number,
		type: number,
		n: number,
		val: number,
	) => {
		v.setUint16(at, tag, true);
		v.setUint16(at + 2, type, true);
		v.setUint32(at + 4, n, true);
		v.setUint32(at + 8, val, true);
	};
	entry(10, 0x010f, 2, 6, 120); // Make, stored at 120
	t.set(new TextEncoder().encode("Apple\0"), 120);
	entry(22, 0x8825, 4, 1, 40); // GPS IFD
	v.setUint16(40, 4, true);
	entry(42, 1, 2, 2, 0x4e); // "N"
	entry(54, 2, 5, 3, 130);
	entry(66, 3, 2, 2, 0x57); // "W"
	entry(78, 4, 5, 3, 130);
	for (const [i, n] of [12, 30, 0].entries()) {
		v.setUint32(130 + i * 8, n, true);
		v.setUint32(134 + i * 8, 1, true);
	}
	return t;
}

const jpeg = (t: Uint8Array, extraLength = 0) => {
	const size = t.length + 8 + extraLength;
	return concat([
		new Uint8Array([0xff, 0xd8, 0xff, 0xe1, size >> 8, size & 0xff]),
		new TextEncoder().encode("Exif\0\0"),
		t,
		new Uint8Array(JPEG_END),
	]);
};

test("readExif: camera and signed GPS from a JPEG", () => {
	const rows = Object.fromEntries(readExif(jpeg(tiff())));
	expect(rows["Camera make"]).toBe("Apple");
	expect(rows.Location).toBe("12.50000, -12.50000");
});

test("readExif: no EXIF gives no rows", () => {
	expect(readExif(new Uint8Array([0xff, 0xd8, 0xff, ...JPEG_END]))).toEqual([]);
	expect(readExif(new Uint8Array(4))).toEqual([]);
});

test("readExif: offsets past the end are ignored, not read", () => {
	const t = tiff();
	new DataView(t.buffer).setUint32(4, 1_000_000, true);
	expect(readExif(jpeg(t))).toEqual([]);
	const u = tiff();
	new DataView(u.buffer).setUint32(10 + 8, 1_000_000, true);
	expect(Object.keys(Object.fromEntries(readExif(jpeg(u))))).not.toContain(
		"Camera make",
	);
});
