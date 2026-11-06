import { decode, encode, engine, keepFormat, MIME } from "../codec";
import { keepProfile } from "../profile";
import type { Op, Options } from "../types";
import { drawWatermark } from "../watermark-draw";

function drawOnCanvas(img: ImageData, opts: Options) {
	const canvas = new OffscreenCanvas(img.width, img.height);
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("Could not draw watermark");
	ctx.putImageData(img, 0, 0);
	const { squeezed } = drawWatermark(ctx, img.width, img.height, opts);
	return { img: ctx.getImageData(0, 0, img.width, img.height), squeezed };
}

// Text needs a canvas; OffscreenCanvas works in workers on current Chrome, Safari (16.4+) and Firefox.
const watermark: Op = async (input, opts) => {
	const text = (opts.text ?? "").trim();
	if (!text) throw new Error("Type the watermark text");
	const nodeDraw = engine()?.watermark;
	if (!nodeDraw && typeof OffscreenCanvas !== "function")
		throw new Error("This browser can't draw text in the background");
	const format = keepFormat(input);
	const img = await decode(input);
	const { img: out, squeezed } = nodeDraw
		? await nodeDraw(img, opts)
		: drawOnCanvas(img, opts);
	return {
		bytes: await encode(out, format, Number(opts.quality ?? 92)),
		type: MIME[format],
		note: squeezed
			? "Text is too long for this image. Try something shorter."
			: undefined,
	};
};

export default keepProfile(watermark);
