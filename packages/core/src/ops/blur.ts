import { decode, encode, engine, keepFormat, MIME } from "../codec";
import { blurImage, fractionBox, pasteBoxes } from "../pixels";
import { keepProfile } from "../profile";
import type { Op } from "../types";

// `areas` lists "x,y,w,h" fraction boxes joined by ";"; without it the whole image is blurred.
const blur: Op = async (input, opts) => {
	const format = keepFormat(input);
	const img = await decode(input);
	// Strength is relative to image size so 1 MP and 48 MP photos look equally blurred.
	const strength = Math.min(100, Math.max(1, Number(opts.strength ?? 20)));
	const radius = Math.round(
		(Math.min(img.width, img.height) * strength) / 1000,
	);
	const blurred = await (engine()?.blur(img, radius) ?? blurImage(img, radius));
	const boxes = opts.areas
		?.split(";")
		.map((spec) => fractionBox(img.width, img.height, spec));
	return {
		bytes: await encode(
			boxes ? pasteBoxes(img, blurred, boxes) : blurred,
			format,
			Number(opts.quality ?? 90),
		),
		type: MIME[format],
	};
};

export default keepProfile(blur);
