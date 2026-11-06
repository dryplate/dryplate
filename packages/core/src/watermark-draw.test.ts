import { expect, test } from "vitest";
import { place } from "./watermark-draw";

test("place keeps the box inside the image", () => {
	expect(place(1000, 500, 200, 40, 0, 20, 1, 1)).toEqual([880, 460]);
	expect(place(1000, 500, 200, 40, 0, 20, 0, 0)).toEqual([120, 40]);
	expect(place(1000, 500, 200, 40, 0, 20, 0.5, 0.5)).toEqual([500, 250]);
	expect(place(1000, 500, 200, 40, 0, 20, 9, -9)).toEqual([880, 40]);
});

test("place allows for rotation, and never leaves a tiny image", () => {
	const [, y] = place(1000, 500, 200, 40, 90, 20, 0, 0);
	expect(y).toBeCloseTo(120);
	expect(place(100, 100, 400, 40, 0, 20, 0, 1)).toEqual([50, 60]);
});
