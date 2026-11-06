import { setEngine } from "@dryplate/core";
import { setHeifLoader } from "@dryplate/core/heic";
import { sharpEngine } from "./sharp-engine";

export * from "./index";

setEngine(sharpEngine);

// Sharp's prebuilt binaries read AVIF but not HEVC, so iPhone HEIC still decodes through libheif.
setHeifLoader(async () => {
	const { default: factory } = await import(
		"libheif-js/libheif-wasm/libheif.js"
	);
	return (await factory()) as never;
});
