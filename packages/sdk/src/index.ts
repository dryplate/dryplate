import type { Op } from "@dryplate/core";

// Declared here, not re-exported, so the published types don't point at the internal core package.
export type OpResult = {
	bytes: Uint8Array<ArrayBuffer>;
	/** MIME type of `bytes`, like "image/webp". */
	type: string;
	/** A plain warning, such as when resize had to enlarge or a PNG ignored `quality`. */
	note?: string;
};
export type Quality = { quality?: number };

// Same op names and options as the web tools. Options become strings because that is what core ops read.
type Opts = Record<string, string | number | boolean | undefined>;
const run =
	(load: () => Promise<{ default: Op }>) =>
	async (inputs: Uint8Array[], opts: Opts = {}): Promise<OpResult> => {
		const { default: op } = await load();
		const strings = Object.fromEntries(
			Object.entries(opts)
				.filter(([, v]) => v !== undefined && v !== false)
				.map(([k, v]) => [k, String(v)]),
		);
		// A copy, because Node Buffers can be views into a shared pool.
		const copies = inputs.map((b) => new Uint8Array(b));
		return op(copies[0] as Uint8Array<ArrayBuffer>, strings, copies);
	};
const one =
	<O extends object>(load: () => Promise<{ default: Op }>) =>
	(input: Uint8Array, opts?: O) =>
		run(load)([input], opts as Opts);

export const image = {
	convert: one<{ format: "jpeg" | "png" | "webp" | "avif" } & Quality>(
		() => import("@dryplate/core/ops/convert"),
	),
	compress: one<{ maxKb?: number } & Quality>(
		() => import("@dryplate/core/ops/compress"),
	),
	resize: one<{ width?: number; height?: number; percent?: number } & Quality>(
		() => import("@dryplate/core/ops/resize"),
	),
	/** `ratio` is "16:9"-style and centred; `box` is "x,y,w,h" in 0–1 fractions. */
	crop: one<{ ratio?: string; box?: string } & Quality>(
		() => import("@dryplate/core/ops/crop"),
	),
	rotate: one<{ degrees?: number; flip?: "h" | "v" } & Quality>(
		() => import("@dryplate/core/ops/rotate"),
	),
	/** `strength` is 1–100; `areas` is "x,y,w,h" fractions joined by ";". */
	blur: one<{ strength?: number; areas?: string } & Quality>(
		() => import("@dryplate/core/ops/blur"),
	),
	watermark: one<
		{
			text: string;
			size?: number;
			opacity?: number;
			angle?: number;
			x?: number;
			y?: number;
			color?: string;
			font?: "sans" | "serif" | "mono" | "script" | "impact";
			tile?: boolean;
		} & Quality
	>(() => import("@dryplate/core/ops/watermark")),
	removeMetadata: one<Quality>(
		() => import("@dryplate/core/ops/remove-metadata"),
	),
	merge: (
		inputs: Uint8Array[],
		opts?: {
			direction?: "horizontal" | "vertical";
			gap?: number;
			background?: string;
		} & Quality,
	) => run(() => import("@dryplate/core/ops/merge"))(inputs, opts),
};
