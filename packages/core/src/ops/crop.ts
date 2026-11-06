import { decode, encode, keepFormat, MIME } from "../codec";
import { centerBox, cropImage, fractionBox } from "../pixels";
import { keepProfile } from "../profile";
import type { Op } from "../types";

// A batch gets a centred crop to the ratio; a single image can carry a hand-picked box.
const crop: Op = async (input, opts) => {
	const format = keepFormat(input);
	const img = await decode(input);
	const out = cropImage(
		img,
		opts.box
			? fractionBox(img.width, img.height, opts.box)
			: centerBox(img.width, img.height, opts.ratio),
	);
	return {
		bytes: await encode(out, format, Number(opts.quality ?? 92)),
		type: MIME[format],
	};
};

export default keepProfile(crop);
