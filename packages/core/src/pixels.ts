// Pure pixel transforms on RGBA ImageData; no canvas, so they behave the same in Node and every browser.

function px32(img: ImageData): Uint32Array {
	const d = img.data;
	// One RGBA pixel per element; copy if the buffer offset isn't 4-byte aligned.
	const src = d.byteOffset % 4 === 0 ? d : new Uint8ClampedArray(d);
	return new Uint32Array(src.buffer, src.byteOffset, img.width * img.height);
}

// Clockwise turn by 0/90/180/270, then optional mirror. Matches how photo apps apply EXIF-style transforms.
export function rotateImage(
	img: ImageData,
	degrees: number,
	flipH = false,
	flipV = false,
): ImageData {
	const turn = (((Math.round(degrees / 90) * 90) % 360) + 360) % 360;
	const { width: w, height: h } = img;
	const [W, H] = turn % 180 === 0 ? [w, h] : [h, w];
	const out = new ImageData(W, H);
	const src = px32(img);
	const dst = px32(out);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			let nx = x;
			let ny = y;
			if (turn === 90) [nx, ny] = [h - 1 - y, x];
			else if (turn === 180) [nx, ny] = [w - 1 - x, h - 1 - y];
			else if (turn === 270) [nx, ny] = [y, w - 1 - x];
			if (flipH) nx = W - 1 - nx;
			if (flipV) ny = H - 1 - ny;
			dst[ny * W + nx] = src[y * w + x] as number;
		}
	}
	return out;
}

export type Box = { x: number; y: number; width: number; height: number };

// Largest centred box with the given aspect ratio ("16:9", "1:1"); "free" or junk keeps the whole image.
export function centerBox(
	w: number,
	h: number,
	ratio: string | undefined,
): Box {
	const [a, b] = (ratio ?? "").split(":").map(Number);
	if (!a || !b) return { x: 0, y: 0, width: w, height: h };
	const target = a / b;
	const [cw, ch] =
		w / h > target ? [Math.round(h * target), h] : [w, Math.round(w / target)];
	return {
		x: Math.floor((w - cw) / 2),
		y: Math.floor((h - ch) / 2),
		width: cw,
		height: ch,
	};
}

// A hand-picked crop as "x,y,width,height" fractions of the image, so it survives any preview scale.
export function fractionBox(w: number, h: number, spec: string): Box {
	const [fx, fy, fw, fh] = spec.split(",").map(Number) as [
		number,
		number,
		number,
		number,
	];
	if (![fx, fy, fw, fh].every(Number.isFinite))
		throw new Error("Choose a crop area first");
	const x = Math.min(w - 1, Math.max(0, Math.round(fx * w)));
	const y = Math.min(h - 1, Math.max(0, Math.round(fy * h)));
	return {
		x,
		y,
		width: Math.min(w - x, Math.max(1, Math.round(fw * w))),
		height: Math.min(h - y, Math.max(1, Math.round(fh * h))),
	};
}

export type Turn = { degrees: number; flip: boolean };

// Adds one more step to a turn, kept as rotateImage's "rotate, then mirror": a turn after a mirror runs the other way.
export function addTurn(
	{ degrees, flip }: Turn,
	step: "left" | "right" | "h" | "v",
): Turn {
	if (step === "h") return { degrees, flip: !flip };
	if (step === "v") return { degrees: (degrees + 180) % 360, flip: !flip };
	const by = (step === "right") === flip ? 270 : 90;
	return { degrees: (degrees + by) % 360, flip };
}

export function cropImage(img: ImageData, box: Box): ImageData {
	const out = new ImageData(box.width, box.height);
	for (let row = 0; row < box.height; row++) {
		const start = ((box.y + row) * img.width + box.x) * 4;
		out.data.set(
			img.data.subarray(start, start + box.width * 4),
			row * box.width * 4,
		);
	}
	return out;
}

// One box-blur pass along rows (dx=1) or columns, with clamped edges and a running sum: O(pixels), any radius.
function boxPass(
	src: Uint8ClampedArray,
	dst: Uint8ClampedArray,
	w: number,
	h: number,
	r: number,
	horizontal: boolean,
): void {
	const [lines, len] = horizontal ? [h, w] : [w, h];
	const step = horizontal ? 4 : w * 4;
	const span = r * 2 + 1;
	for (let line = 0; line < lines; line++) {
		const base = horizontal ? line * w * 4 : line * 4;
		for (let c = 0; c < 4; c++) {
			const at = (i: number) =>
				src[base + Math.min(len - 1, Math.max(0, i)) * step + c] as number;
			let sum = 0;
			for (let i = -r; i <= r; i++) sum += at(i);
			for (let i = 0; i < len; i++) {
				dst[base + i * step + c] = sum / span;
				sum += at(i + r + 1) - at(i - r);
			}
		}
	}
}

// Blur must average premultiplied colour, or the invisible RGB of transparent pixels bleeds in as a dark fringe.
function premultiply(d: Uint8ClampedArray): void {
	for (let i = 0; i < d.length; i += 4) {
		const a = (d[i + 3] as number) / 255;
		if (a === 1) continue;
		d[i] = (d[i] as number) * a;
		d[i + 1] = (d[i + 1] as number) * a;
		d[i + 2] = (d[i + 2] as number) * a;
	}
}

function unpremultiply(d: Uint8ClampedArray): void {
	for (let i = 0; i < d.length; i += 4) {
		const a = (d[i + 3] as number) / 255;
		if (a === 1 || a === 0) continue;
		d[i] = (d[i] as number) / a;
		d[i + 1] = (d[i + 1] as number) / a;
		d[i + 2] = (d[i + 2] as number) / a;
	}
}

// Three box passes per axis approximate a Gaussian blur closely enough to be indistinguishable by eye.
export function blurImage(img: ImageData, radius: number): ImageData {
	const r = Math.max(0, Math.round(radius));
	const { width: w, height: h } = img;
	const a = new Uint8ClampedArray(img.data);
	const b = new Uint8ClampedArray(a.length);
	premultiply(a);
	for (let pass = 0; pass < 3 && r > 0; pass++) {
		boxPass(a, b, w, h, r, true);
		boxPass(b, a, w, h, r, false);
	}
	unpremultiply(a);
	const out = new ImageData(w, h);
	out.data.set(a);
	return out;
}

// Copies `from` over `onto` inside each box, so only those areas change.
export function pasteBoxes(
	onto: ImageData,
	from: ImageData,
	boxes: Box[],
): ImageData {
	const out = new ImageData(new Uint8ClampedArray(onto.data), onto.width);
	for (const b of boxes)
		for (let row = 0; row < b.height; row++) {
			const start = ((b.y + row) * onto.width + b.x) * 4;
			out.data.set(from.data.subarray(start, start + b.width * 4), start);
		}
	return out;
}

const px = (n: number) => Math.max(1, Math.round(n));

// Aspect ratio is always kept. Percent wins; width + height means "fit inside this box".
export function targetSize(
	w: number,
	h: number,
	opts: Record<string, string | undefined>,
): [number, number] {
	const pct = Number(opts.percent);
	if (pct > 0) return [px((w * pct) / 100), px((h * pct) / 100)];
	const W = Number(opts.width) || 0;
	const H = Number(opts.height) || 0;
	if (W > 0 && H > 0) {
		const s = Math.min(W / w, H / h);
		return [px(w * s), px(h * s)];
	}
	if (W > 0) return [px(W), px((h * W) / w)];
	if (H > 0) return [px((w * H) / h), px(H)];
	throw new Error("Set a width, height or percent");
}

export type Rgba = [number, number, number, number];

// Largest output we'll build: 100 MP of RGBA is 400 MB of memory before encoding, which keeps the tab alive.
export const MAX_PIXELS = 100_000_000;

export function parseBackground(s: string | undefined): Rgba {
	if (s === "transparent") return [0, 0, 0, 0];
	if (s === "black") return [0, 0, 0, 255];
	return [255, 255, 255, 255];
}

// Show a solid background through transparent pixels.
function overColour(d: Uint8ClampedArray, bg: Rgba): Uint8ClampedArray {
	const out = new Uint8ClampedArray(d);
	for (let i = 0; i < d.length; i += 4) {
		const a = (d[i + 3] as number) / 255;
		if (a === 1) continue;
		for (let c = 0; c < 3; c++)
			out[i + c] = (d[i + c] as number) * a + bg[c as 0 | 1 | 2] * (1 - a);
		out[i + 3] = 255;
	}
	return out;
}

// Lay images in a row (all same height) or a column (all same width), centred on the cross axis, with gaps.
export function stackImages(
	imgs: ImageData[],
	vertical: boolean,
	gap: number,
	bg: Rgba,
): ImageData {
	const g = Math.max(0, Math.round(gap));
	const along =
		imgs.reduce((n, i) => n + (vertical ? i.height : i.width), 0) +
		g * (imgs.length - 1);
	const across = Math.max(...imgs.map((i) => (vertical ? i.width : i.height)));
	const [W, H] = vertical ? [across, along] : [along, across];
	const out = new ImageData(W, H);
	for (let p = 0; p < out.data.length; p += 4) out.data.set(bg, p);
	let at = 0;
	for (const img of imgs) {
		const offX = vertical ? Math.floor((W - img.width) / 2) : at;
		const offY = vertical ? at : Math.floor((H - img.height) / 2);
		const data = bg[3] === 255 ? overColour(img.data, bg) : img.data;
		for (let y = 0; y < img.height; y++) {
			const row = data.subarray(y * img.width * 4, (y + 1) * img.width * 4);
			out.data.set(row, ((offY + y) * W + offX) * 4);
		}
		at += (vertical ? img.height : img.width) + g;
	}
	return out;
}
