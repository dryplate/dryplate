import { decode, encode, MIME, parseFormat } from "../codec";
import { keepProfile } from "../profile";
import type { Op } from "../types";

const convert: Op = async (input, opts) => {
	const format = parseFormat(opts.format);
	const quality = Number(opts.quality ?? 80);
	const img = await decode(input);
	return { bytes: await encode(img, format, quality), type: MIME[format] };
};

export default keepProfile(convert);
