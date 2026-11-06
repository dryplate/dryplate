// Vite resolves `?url` imports to the emitted asset URL.
declare module "*?url" {
	const url: string;
	export default url;
}
