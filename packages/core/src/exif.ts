import { sniff } from "./codec";
import { ascii, jpegSegments, pngChunks, u16, u32 } from "./metadata";

type Value = string | number[];
type Ifd = Map<number, Value>;

const EXIF_HEADER = "Exif\0\0";
// Bytes per value, by TIFF type: BYTE, ASCII, SHORT, LONG, RATIONAL, then the signed RATIONAL.
const SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 10: 8 };
// Enough for any tag shown here; a hostile file can't make us read more.
const MAX_VALUES = 8;
const MAX_TEXT = 500;

function findTiff(b: Uint8Array): Uint8Array | undefined {
	const format = sniff(b);
	if (format === "jpeg") {
		for (const s of jpegSegments(b))
			if (s.marker === 0xe1 && ascii(s.payload, 0, 6) === EXIF_HEADER)
				return s.payload.subarray(6);
	}
	if (format === "png")
		for (const c of pngChunks(b)) if (c.type === "eXIf") return c.data;
	if (format === "webp")
		for (let i = 12; i + 8 <= b.length; ) {
			const size = u32(b, i + 4, true);
			if (ascii(b, i, 4) === "EXIF") {
				const data = b.subarray(i + 8, i + 8 + size);
				return ascii(data, 0, 6) === EXIF_HEADER ? data.subarray(6) : data;
			}
			i += 8 + size + (size % 2);
		}
	// ponytail: HEIC/AVIF store EXIF as an item in ISOBMFF boxes; scanning for its header avoids a box parser.
	if (format === "heic" || format === "avif")
		for (let i = 0; i + 8 < b.length; i++)
			if (b[i] === 0x45 && ascii(b, i, 6) === EXIF_HEADER) {
				const order = ascii(b, i + 6, 2);
				if (order === "II" || order === "MM") return b.subarray(i + 6);
			}
	return undefined;
}

function readIfd(t: Uint8Array, at: number, le: boolean): Ifd {
	const ifd: Ifd = new Map();
	if (at + 2 > t.length) return ifd;
	const count = u16(t, at, le);
	for (let k = 0; k < count; k++) {
		const e = at + 2 + k * 12;
		if (e + 12 > t.length) break;
		const type = u16(t, e + 2, le);
		const size = SIZE[type];
		if (!size) continue;
		const n = u32(t, e + 4, le);
		const bytes = n * size;
		const start = bytes <= 4 ? e + 8 : u32(t, e + 8, le);
		if (!n || start + bytes > t.length) continue;
		if (type === 2) {
			const text = new TextDecoder()
				.decode(t.subarray(start, start + Math.min(n, MAX_TEXT)))
				.split("\0")[0]
				?.trim();
			if (text) ifd.set(u16(t, e, le), text);
			continue;
		}
		const values: number[] = [];
		for (let i = 0; i < Math.min(n, MAX_VALUES); i++) {
			const p = start + i * size;
			if (type === 1) values.push(t[p] as number);
			else if (type === 3) values.push(u16(t, p, le));
			else if (type === 4) values.push(u32(t, p, le));
			else {
				const signed = type === 10 ? 0 : 1;
				const top = u32(t, p, le);
				const num = signed || top < 2 ** 31 ? top : top - 2 ** 32;
				values.push(num / u32(t, p + 4, le));
			}
		}
		ifd.set(u16(t, e, le), values);
	}
	return ifd;
}

const num = (v: Value | undefined) =>
	typeof v === "object" && Number.isFinite(v[0]) ? (v[0] as number) : undefined;
const text = (v: Value | undefined) => (typeof v === "string" ? v : undefined);
const round = (n: number) => String(Math.round(n * 100) / 100);

function degrees(v: Value | undefined, ref: Value | undefined, minus: string) {
	if (typeof v !== "object" || v.length < 3) return undefined;
	const [d, m, s] = v as [number, number, number];
	const value = d + m / 60 + s / 3600;
	if (!Number.isFinite(value)) return undefined;
	return (text(ref) === minus ? -value : value).toFixed(5);
}

const ORIENTATION: Record<number, string> = {
	1: "Upright",
	3: "Upside down",
	6: "Turned right",
	8: "Turned left",
};

// Plain-language EXIF rows, in reading order. Rows with no value are left out.
export function readExif(b: Uint8Array): [string, string][] {
	const t = findTiff(b);
	if (!t || t.length < 8) return [];
	const le = ascii(t, 0, 2) === "II";
	const main = readIfd(t, u32(t, 4, le), le);
	const sub = (tag: number) => {
		const at = num(main.get(tag));
		return at ? readIfd(t, at, le) : (new Map() as Ifd);
	};
	const exif = sub(0x8769);
	const gps = sub(0x8825);

	const exposure = num(exif.get(0x829a));
	const aperture = num(exif.get(0x829d));
	const iso = num(exif.get(0x8827));
	const focal = num(exif.get(0x920a));
	const width = num(exif.get(0xa002));
	const height = num(exif.get(0xa003));
	const altitude = num(gps.get(6));
	const lat = degrees(gps.get(2), gps.get(1), "S");
	const lon = degrees(gps.get(4), gps.get(3), "W");
	const orientation = num(main.get(0x0112));
	const date = (v: Value | undefined) =>
		text(v)?.replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3");

	const rows: [string, string | undefined][] = [
		["Location", lat && lon ? `${lat}, ${lon}` : undefined],
		["Altitude", altitude === undefined ? undefined : `${round(altitude)} m`],
		["Date taken", date(exif.get(0x9003))],
		["Last changed", date(main.get(0x0132))],
		["Camera make", text(main.get(0x010f))],
		["Camera model", text(main.get(0x0110))],
		["Lens", text(exif.get(0xa434))],
		[
			"Exposure",
			exposure === undefined
				? undefined
				: exposure < 1 && exposure > 0
					? `1/${Math.round(1 / exposure)} s`
					: `${round(exposure)} s`,
		],
		["Aperture", aperture === undefined ? undefined : `f/${round(aperture)}`],
		["ISO", iso === undefined ? undefined : String(iso)],
		["Focal length", focal === undefined ? undefined : `${round(focal)} mm`],
		["Size", width && height ? `${width} × ${height}` : undefined],
		["Orientation", orientation ? ORIENTATION[orientation] : undefined],
		["Software", text(main.get(0x0131))],
		["Author", text(main.get(0x013b))],
		["Copyright", text(main.get(0x8298))],
		["Description", text(main.get(0x010e))],
	];
	return rows.filter((r): r is [string, string] => r[1] !== undefined);
}
