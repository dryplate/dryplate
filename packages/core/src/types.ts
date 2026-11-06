export type Options = Record<string, string>;
// `note` tells the person about something the result does differently from what they might expect.
export type OpResult = {
	bytes: Uint8Array<ArrayBuffer>;
	type: string;
	note?: string;
};
export type Op = (
	input: Uint8Array<ArrayBuffer>,
	opts: Options,
	// Every dropped file, for ops that combine them (merge); single-file ops ignore it.
	all?: Uint8Array<ArrayBuffer>[],
) => Promise<OpResult>;
