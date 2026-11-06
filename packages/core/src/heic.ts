type HeifImage = {
	get_width(): number;
	get_height(): number;
	is_primary(): boolean;
	display(img: ImageData, cb: (out: ImageData | null) => void): void;
	free(): void;
};
type Heif = { HeifDecoder: new () => { decode(b: Uint8Array): HeifImage[] } };

let heif: Promise<Heif> | undefined;
let loader = loadHeif;

// Node can't fetch the WASM, so it injects its own loader.
export function setHeifLoader(load: () => Promise<Heif>): void {
	loader = load;
	heif = undefined;
}

async function loadHeif(): Promise<Heif> {
	const [{ default: factory }, { default: wasmUrl }] = await Promise.all([
		import("libheif-js/libheif-wasm/libheif.js"),
		import("libheif-js/libheif-wasm/libheif.wasm?url"),
	]);
	const wasmBinary = await (await fetch(wasmUrl)).arrayBuffer();
	return (await factory({ wasmBinary })) as unknown as Heif;
}

// Inputs decoded by the browser: its canvas output is already sRGB, so their colour profile no longer applies.
const srgb = new WeakSet<Uint8Array>();
export const decodedAsSrgb = (bytes: Uint8Array) => srgb.has(bytes);

// Safari (iPhone, Mac) decodes HEIC natively, which skips a 1.5 MB WASM download for our main audience.
export async function decodeNative(
	bytes: Uint8Array<ArrayBuffer>,
	type: string,
): Promise<ImageData | undefined> {
	if (
		typeof createImageBitmap !== "function" ||
		typeof OffscreenCanvas !== "function"
	)
		return undefined;
	try {
		const bmp = await createImageBitmap(new Blob([bytes], { type }));
		const { width, height } = bmp;
		const ctx = new OffscreenCanvas(width, height).getContext("2d");
		if (!ctx) return undefined;
		ctx.drawImage(bmp, 0, 0);
		bmp.close(); // zeroes bmp.width and bmp.height
		srgb.add(bytes);
		return ctx.getImageData(0, 0, width, height);
	} catch {
		return undefined;
	}
}

export async function decodeHeic(
	bytes: Uint8Array<ArrayBuffer>,
): Promise<ImageData> {
	const native = await decodeNative(bytes, "image/heic");
	if (native) return native;

	heif ??= loader();
	const images = new (await heif).HeifDecoder().decode(bytes);
	// Bursts and Live Photos hold several images; the primary one is what the Photos app shows.
	const image = images.find((i) => i.is_primary()) ?? images[0];
	if (!image) throw new Error("Could not read HEIC file");
	try {
		const width = image.get_width();
		const height = image.get_height();
		return await new Promise<ImageData>((resolve, reject) =>
			image.display(new ImageData(width, height), (out) =>
				out ? resolve(out) : reject(new Error("Could not decode HEIC image")),
			),
		);
	} finally {
		for (const i of images) i.free();
	}
}
