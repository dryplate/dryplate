import { expect, test } from "vitest";
import {
	addTurn,
	blurImage,
	centerBox,
	cropImage,
	fractionBox,
	parseBackground,
	pasteBoxes,
	rotateImage,
	stackImages,
	type Turn,
} from "./pixels";
import { setupNode } from "./test-node";

await setupNode();

// 3×2 image whose red channel is the pixel index: 0 1 2 / 3 4 5
function grid(): ImageData {
	const img = new ImageData(3, 2);
	for (let i = 0; i < 6; i++) img.data.set([i, 0, 0, 255], i * 4);
	return img;
}
const reds = (img: ImageData) => [
	img.width,
	img.height,
	...[...img.data].filter((_, i) => i % 4 === 0),
];

test("rotateImage", () => {
	expect(reds(rotateImage(grid(), 0))).toEqual([3, 2, 0, 1, 2, 3, 4, 5]);
	expect(reds(rotateImage(grid(), 90))).toEqual([2, 3, 3, 0, 4, 1, 5, 2]);
	expect(reds(rotateImage(grid(), 180))).toEqual([3, 2, 5, 4, 3, 2, 1, 0]);
	expect(reds(rotateImage(grid(), 270))).toEqual([2, 3, 2, 5, 1, 4, 0, 3]);
	expect(reds(rotateImage(grid(), -90))).toEqual(
		reds(rotateImage(grid(), 270)),
	);
	expect(reds(rotateImage(grid(), 0, true))).toEqual([3, 2, 2, 1, 0, 5, 4, 3]);
	expect(reds(rotateImage(grid(), 0, false, true))).toEqual([
		3, 2, 3, 4, 5, 0, 1, 2,
	]);
});

test("centerBox", () => {
	expect(centerBox(4032, 3024, "1:1")).toEqual({
		x: 504,
		y: 0,
		width: 3024,
		height: 3024,
	});
	expect(centerBox(4032, 3024, "16:9")).toEqual({
		x: 0,
		y: 378,
		width: 4032,
		height: 2268,
	});
	expect(centerBox(1000, 2000, "4:5")).toEqual({
		x: 0,
		y: 375,
		width: 1000,
		height: 1250,
	});
	expect(centerBox(100, 50, "free")).toEqual({
		x: 0,
		y: 0,
		width: 100,
		height: 50,
	});
});

test("cropImage", () => {
	expect(reds(cropImage(grid(), { x: 1, y: 0, width: 2, height: 2 }))).toEqual([
		2, 2, 1, 2, 4, 5,
	]);
});

test("blurImage: flat stays flat, an impulse spreads, size kept", () => {
	const flat = new ImageData(8, 8);
	for (let i = 0; i < flat.data.length; i += 4)
		flat.data.set([100, 100, 100, 255], i);
	expect(
		[...blurImage(flat, 3).data].every(
			(v, i) => v === (i % 4 === 3 ? 255 : 100),
		),
	).toBe(true);

	const dot = new ImageData(9, 9);
	for (let i = 0; i < dot.data.length; i += 4) dot.data.set([0, 0, 0, 255], i);
	dot.data.set([255, 255, 255, 255], (4 * 9 + 4) * 4);
	const out = blurImage(dot, 1);
	expect([out.width, out.height]).toEqual([9, 9]);
	const at = (x: number, y: number) => out.data[(y * 9 + x) * 4] as number;
	expect(at(4, 4)).toBeLessThan(255);
	expect(at(5, 4)).toBeGreaterThan(0);
	expect(at(0, 0)).toBe(0);
	expect([...blurImage(dot, 0).data]).toEqual([...dot.data]);
});

test("stackImages: row and column with gap and background", () => {
	const a = new ImageData(2, 2);
	for (let i = 0; i < a.data.length; i += 4) a.data.set([10, 10, 10, 255], i);
	const b = new ImageData(1, 1);
	b.data.set([20, 20, 20, 255]);
	const row = stackImages([a, b], false, 1, [0, 0, 0, 255]);
	expect([row.width, row.height]).toEqual([4, 2]);
	const red = (img: ImageData, x: number, y: number) =>
		img.data[(y * img.width + x) * 4];
	expect([
		red(row, 0, 0),
		red(row, 2, 0),
		red(row, 3, 0),
		red(row, 3, 1),
	]).toEqual([10, 0, 20, 0]);
	const col = stackImages([a, b], true, 0, parseBackground("white"));
	expect([col.width, col.height]).toEqual([2, 3]);
	expect([red(col, 0, 2), red(col, 1, 2)]).toEqual([20, 255]);
});

test("blurImage: transparent neighbours don't darken the edge", () => {
	const img = new ImageData(20, 1);
	for (let x = 10; x < 20; x++) img.data.set([255, 0, 0, 255], x * 4);
	const out = blurImage(img, 3);
	const edge = 10 * 4;
	expect(out.data[edge + 3]).toBeGreaterThan(0);
	expect(out.data[edge + 3]).toBeLessThan(255);
	expect(out.data[edge]).toBeGreaterThanOrEqual(254);
});

test("stackImages: solid background shows through transparency", () => {
	const clear = new ImageData(1, 1);
	const half = new ImageData(1, 1);
	half.data.set([255, 255, 255, 128]);
	const out = stackImages([clear, half], false, 0, [0, 0, 0, 255]);
	expect([...out.data.subarray(0, 4)]).toEqual([0, 0, 0, 255]);
	expect(out.data[4]).toBeCloseTo(128, -1);
	expect(out.data[7]).toBe(255);
	const keep = stackImages([clear], false, 0, [0, 0, 0, 0]);
	expect(keep.data[3]).toBe(0);
});

test("fractionBox maps to pixels and stays inside", () => {
	expect(fractionBox(100, 50, "0.5,0.2,0.25,0.5")).toEqual({
		x: 50,
		y: 10,
		width: 25,
		height: 25,
	});
	expect(fractionBox(100, 50, "0.9,0.9,1,1")).toEqual({
		x: 90,
		y: 45,
		width: 10,
		height: 5,
	});
	expect(() => fractionBox(100, 50, "junk")).toThrow();
});

test("addTurn matches applying each step in order", () => {
	const once = (img: ImageData, step: "left" | "right" | "h" | "v") =>
		step === "left"
			? rotateImage(img, 270)
			: step === "right"
				? rotateImage(img, 90)
				: rotateImage(img, 0, step === "h", step === "v");
	const steps = ["left", "right", "h", "v"] as const;
	for (const a of steps)
		for (const b of steps)
			for (const c of steps) {
				let img = grid();
				let turn: Turn = { degrees: 0, flip: false };
				for (const step of [a, b, c]) {
					img = once(img, step);
					turn = addTurn(turn, step);
				}
				const direct = rotateImage(grid(), turn.degrees, turn.flip);
				expect(reds(direct), `${a} ${b} ${c}`).toEqual(reds(img));
			}
});

test("pasteBoxes changes only the boxes", () => {
	const a = new ImageData(new Uint8ClampedArray(16).fill(10), 2);
	const b = new ImageData(new Uint8ClampedArray(16).fill(99), 2);
	const out = pasteBoxes(a, b, [{ x: 1, y: 1, width: 1, height: 1 }]);
	expect([...out.data.subarray(0, 12)]).toEqual(Array(12).fill(10));
	expect([...out.data.subarray(12)]).toEqual([99, 99, 99, 99]);
	expect(a.data[12]).toBe(10);
});
