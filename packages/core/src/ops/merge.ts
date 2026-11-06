import { decode, encode, keepFormat, MIME, scale } from "../codec";
import { MAX_PIXELS, parseBackground, stackImages } from "../pixels";
import { keepProfile } from "../profile";
import type { Op } from "../types";

const merge: Op = async (input, opts, all = [input]) => {
	if (all.length < 2) throw new Error("Add at least one more image to merge");
	const vertical = opts.direction === "vertical";
	const imgs = await Promise.all(all.map((b) => decode(b)));
	// Scale everything to the smallest shared edge so nothing is upscaled.
	const edge = Math.min(...imgs.map((i) => (vertical ? i.width : i.height)));
	const size = (img: ImageData) => {
		const s = edge / (vertical ? img.width : img.height);
		return {
			width: Math.max(1, Math.round(img.width * s)),
			height: Math.max(1, Math.round(img.height * s)),
		};
	};
	const gap = Math.min(500, Math.max(0, Number(opts.gap ?? 0)));
	const total =
		imgs.reduce((n, i) => n + (vertical ? size(i).height : size(i).width), 0) +
		gap * (imgs.length - 1);
	if (total * edge > MAX_PIXELS)
		throw new Error(
			"Merged image would be over 100 megapixels; resize the images first",
		);
	const sized = await Promise.all(
		imgs.map((img) =>
			(vertical ? img.width : img.height) === edge
				? img
				: scale(img, size(img)),
		),
	);
	const out = stackImages(
		sized,
		vertical,
		gap,
		parseBackground(opts.background),
	);
	// JPEG can't hold transparency, so honour the choice with a format that can.
	const kept = keepFormat(input);
	const format =
		kept === "jpeg" && opts.background === "transparent" ? "png" : kept;
	const scaled = imgs.some((i, n) => i !== sized[n]);
	return {
		bytes: await encode(out, format, Number(opts.quality ?? 90)),
		type: MIME[format],
		note: scaled
			? `Scaled to the smallest image: ${edge} px ${vertical ? "wide" : "tall"}.`
			: undefined,
	};
};

export default keepProfile(merge);
