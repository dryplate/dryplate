import { decode, encode, keepFormat, MIME, sniff } from "../codec";
import { jpegOrientation, pngOrientation } from "../metadata";
import { rotateImage } from "../pixels";
import { keepProfile } from "../profile";
import type { Op } from "../types";

// True when the file needs no work: re-saving a JPEG without changing it would only lose quality.
function alreadyUpright(input: Uint8Array): boolean {
	const src = sniff(input);
	if (src === "jpeg") return jpegOrientation(input) === 1;
	if (src === "png") return pngOrientation(input) === 1;
	return src !== "heic";
}

const rotate: Op = async (input, opts) => {
	const format = keepFormat(input);
	const degrees = Number(opts.degrees ?? 90);
	if (degrees % 360 === 0 && !opts.flip && alreadyUpright(input))
		return {
			bytes: input,
			type: MIME[format],
			note: "Nothing to change, so this is your original file.",
		};
	const img = rotateImage(
		await decode(input),
		degrees,
		opts.flip === "h",
		opts.flip === "v",
	);
	return {
		bytes: await encode(img, format, Number(opts.quality ?? 92)),
		type: MIME[format],
	};
};

export default keepProfile(rotate);
