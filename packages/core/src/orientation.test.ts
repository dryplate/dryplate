import { beforeAll, expect, test } from "vitest";
import { decode, encode } from "./codec";
import { setupNode } from "./test-node";

beforeAll(setupNode);

// Minimal EXIF APP1 segment: big-endian TIFF, one IFD entry, Orientation (0x0112) = 6 (rotate 90° CW).
const exifOrientation6 = new Uint8Array([
	0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x4d, 0x4d, 0x00,
	0x2a, 0x00, 0x00, 0x00, 0x08, 0x00, 0x01, 0x01, 0x12, 0x00, 0x03, 0x00, 0x00,
	0x00, 0x01, 0x00, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

test("JPEG EXIF orientation is applied on decode (phone photos come out upright)", async () => {
	const img = new ImageData(40, 20);
	img.data.fill(200);
	const plain = await encode(img, "jpeg", 90);
	const tagged = new Uint8Array(plain.length + exifOrientation6.length);
	tagged.set(plain.subarray(0, 2));
	tagged.set(exifOrientation6, 2);
	tagged.set(plain.subarray(2), 2 + exifOrientation6.length);
	const out = await decode(tagged);
	expect([out.width, out.height]).toEqual([20, 40]);
});
