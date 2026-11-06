// Shared by the worker (OffscreenCanvas) and the page preview (canvas), so the preview is the output.
type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

// System fonts only: the worker's canvas can't see web fonts, and shipping font files would add page weight.
const FONTS: Record<string, string> = {
	sans: "system-ui, sans-serif",
	serif: 'Georgia, "Times New Roman", serif',
	mono: "ui-monospace, Menlo, Consolas, monospace",
	script: '"Brush Script MT", "Segoe Script", cursive',
	impact: 'Impact, "Arial Black", sans-serif',
};

// Centre of a rotated box, kept inside the image. x and y are 0–1, so 0 and 1 mean flush against that edge.
export function place(
	w: number,
	h: number,
	boxW: number,
	boxH: number,
	degrees: number,
	margin: number,
	x: number,
	y: number,
): [number, number] {
	const a = (degrees * Math.PI) / 180;
	const c = Math.abs(Math.cos(a));
	const s = Math.abs(Math.sin(a));
	const halfW = Math.min(w / 2, (boxW * c + boxH * s) / 2 + margin);
	const halfH = Math.min(h / 2, (boxW * s + boxH * c) / 2 + margin);
	return [
		halfW + (w - 2 * halfW) * Math.min(1, Math.max(0, x)),
		halfH + (h - 2 * halfH) * Math.min(1, Math.max(0, y)),
	];
}

export type Mark = {
	x: number;
	y: number;
	width: number;
	height: number;
	squeezed: boolean;
};

// Draws at the image's own size in pixels; `scale` is only how much smaller the ctx is, for shadow blur, which ignores transforms.
export function drawWatermark(
	ctx: Ctx,
	w: number,
	h: number,
	opts: Record<string, string | undefined>,
	scale = 1,
): Mark {
	const text = (opts.text ?? "").trim();
	const family = FONTS[opts.font ?? ""] ?? FONTS.sans;
	const short = Math.min(w, h);
	let size = Math.max(12, Math.round((short * Number(opts.size ?? 5)) / 100));
	const room = w - size * 1.6;
	ctx.font = `600 ${size}px ${family}`;
	const wide = ctx.measureText(text).width;
	// Long text gets a smaller font first; fillText's maxWidth would squash the letters.
	if (wide > room) size = Math.max(12, Math.floor((size * room) / wide));
	ctx.font = `600 ${size}px ${family}`;
	const measured = ctx.measureText(text).width;
	const degrees = Number(opts.angle ?? 0);
	const [x, y] = place(
		w,
		h,
		Math.min(measured, room),
		size,
		degrees,
		Math.round(size * 0.8),
		Number(opts.x ?? 1),
		Number(opts.y ?? 1),
	);

	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.globalAlpha =
		Math.min(100, Math.max(5, Number(opts.opacity ?? 60))) / 100;
	// A soft dark shadow keeps light text readable on light photos.
	ctx.shadowColor = "rgba(0,0,0,0.5)";
	ctx.shadowBlur = (size / 6) * scale;
	ctx.fillStyle = /^#[0-9a-f]{6}$/i.test(opts.color ?? "")
		? (opts.color as string)
		: "#ffffff";

	const stamp = (at: [number, number]) => {
		ctx.save();
		ctx.translate(at[0], at[1]);
		ctx.rotate((degrees * Math.PI) / 180);
		ctx.fillText(text, 0, 0, room);
		ctx.restore();
	};
	if (opts.tile) {
		const stepX = measured + size * 3;
		const stepY = size * 5;
		// Every other row is offset, and the extra rows cover the corners a rotated grid leaves bare.
		const reach = Math.hypot(w, h);
		ctx.save();
		ctx.translate(w / 2, h / 2);
		ctx.rotate((degrees * Math.PI) / 180);
		for (let row = -reach; row < reach; row += stepY) {
			const shift = Math.round(row / stepY) % 2 ? stepX / 2 : 0;
			for (let col = -reach - shift; col < reach; col += stepX)
				ctx.fillText(text, col, row);
		}
		ctx.restore();
	} else stamp([x, y]);
	return {
		x,
		y,
		width: Math.min(measured, room),
		height: size,
		squeezed: !opts.tile && measured > room,
	};
}
