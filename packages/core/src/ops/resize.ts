import { decode, encode, keepFormat, MIME, scale } from "../codec";
import { MAX_PIXELS, targetSize } from "../pixels";
import { keepProfile } from "../profile";
import type { Op } from "../types";

const resize: Op = async (input, opts) => {
	const format = keepFormat(input);
	const img = await decode(input);
	const [width, height] = targetSize(img.width, img.height, opts);
	if (width * height > MAX_PIXELS)
		throw new Error("That size is over 100 megapixels. Choose a smaller one.");
	const out = await scale(img, { width, height });
	return {
		bytes: await encode(out, format, Number(opts.quality ?? 90)),
		type: MIME[format],
		note:
			width > img.width
				? "Larger than the original, so it will look softer."
				: undefined,
	};
};

export default keepProfile(resize);
