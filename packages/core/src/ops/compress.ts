import {
	decode,
	encode,
	engine,
	type Format,
	keepFormat,
	MIME,
	sniff,
} from "../codec";
import { decodedAsSrgb } from "../heic";
import { keepProfile, readProfile } from "../profile";
import type { Op } from "../types";

// Highest quality below `start` that fits, or null. About 7 encodes.
// ponytail: each try is a full encode, so AVIF with a limit is slow; narrow the range if it hurts.
async function fitQuality(
	img: ImageData,
	format: Format,
	start: number,
	max: number,
): Promise<Uint8Array<ArrayBuffer> | null> {
	let best: Uint8Array<ArrayBuffer> | null = null;
	let lo = 1;
	let hi = start - 1;
	while (lo <= hi) {
		const mid = Math.floor((lo + hi) / 2);
		const out = await encode(img, format, mid);
		if (out.length <= max) {
			best = out;
			lo = mid + 1;
		} else hi = mid - 1;
	}
	return best;
}

async function optimisePng(input: Uint8Array<ArrayBuffer>) {
	const sharp = engine();
	if (sharp) return sharp.optimisePng(input);
	const { default: optimise } = await import("@jsquash/oxipng/optimise.js");
	return new Uint8Array(await optimise(input.slice().buffer, { level: 2 }));
}

const compress: Op = async (input, opts) => {
	const src = sniff(input);
	const maxKb = Number(opts.maxKb);
	const max = maxKb > 0 ? maxKb * 1000 : Number.POSITIVE_INFINITY;
	if (src === "png") {
		// Lossless: PNG users usually want identical pixels (screenshots, logos), just smaller.
		const out = await optimisePng(input);
		const best = out.length < input.length ? out : input;
		if (best.length > max)
			throw new Error(
				`PNGs stay lossless, so this one can't reach ${maxKb} KB. Convert it to JPG or resize it first.`,
			);
		return {
			bytes: best,
			type: MIME.png,
			note: "PNGs stay lossless, so the quality setting doesn't change them.",
		};
	}
	const format = keepFormat(input);
	const img = await decode(input);
	const quality = Number(opts.quality ?? 75);
	const out = await encode(img, format, quality);
	// keepProfile adds the colour profile back afterwards, so leave room for it.
	const icc = decodedAsSrgb(input)
		? 0
		: ((await readProfile(input).catch(() => undefined))?.length ?? 0);
	const fits = max - icc;
	// A compress tool must never hand back a bigger file. HEIC has to change format, so it can't fall back to the original.
	if (src !== "heic" && out.length + icc >= input.length && input.length <= max)
		return { bytes: input, type: MIME[format] };
	if (out.length <= fits) return { bytes: out, type: MIME[format] };
	const fitted = await fitQuality(img, format, quality, fits);
	if (!fitted)
		throw new Error(
			`Can't reach ${maxKb} KB even at the lowest quality. Resize it first.`,
		);
	return { bytes: fitted, type: MIME[format] };
};

export default keepProfile(compress);
