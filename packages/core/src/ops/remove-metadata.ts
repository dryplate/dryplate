import { decode, encode, keepFormat, MIME, sniff } from "../codec";
import { stripJpeg, stripPng, stripWebp } from "../metadata";
import { keepProfile } from "../profile";
import type { Op } from "../types";

const removeMetadata: Op = async (input, opts) => {
	const src = sniff(input);
	// Lossless for the common formats: pixels are untouched, only metadata blocks are dropped.
	if (src === "jpeg") return { bytes: stripJpeg(input), type: MIME.jpeg };
	if (src === "png") return { bytes: stripPng(input), type: MIME.png };
	if (src === "webp") return { bytes: stripWebp(input), type: MIME.webp };
	// ponytail: HEIC/AVIF metadata lives in ISOBMFF item boxes; re-encoding (our encoders write none) is far simpler than box surgery.
	const format = keepFormat(input);
	return {
		bytes: await encode(
			await decode(input),
			format,
			Number(opts.quality ?? 92),
		),
		type: MIME[format],
	};
};

export default keepProfile(removeMetadata);
