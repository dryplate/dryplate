import { beforeAll, expect, test } from "vitest";
import { decode, sniff } from "./codec";
import convert from "./ops/convert";
import { fixture, setupNode } from "./test-node";

beforeAll(setupNode);

test("HEIC (Apple encoder) decodes", async () => {
	const input = await fixture("photo.heic");
	expect(sniff(input)).toBe("heic");
	const img = await decode(input);
	expect(Math.max(img.width, img.height)).toBe(200);
	expect(img.data.some((v) => v !== 0)).toBe(true);
});

test("convert: HEIC to JPEG", async () => {
	const out = await convert(await fixture("photo.heic"), {
		format: "jpeg",
		quality: "85",
	});
	expect(out.type).toBe("image/jpeg");
	expect(sniff(out.bytes)).toBe("jpeg");
});
