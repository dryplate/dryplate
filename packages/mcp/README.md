# Dryplate MCP server

Image tools for AI agents. Convert, resize, compress, crop, rotate, blur, watermark, strip metadata, merge and make thumbnails, all on your machine. Files are read from and written to disk, and nothing is uploaded.

Works with any MCP client that runs stdio servers. Tested with Claude Code and Claude Desktop.

## Quick start

You need Node 24 or newer. There is nothing to install by hand: your client runs the server with `npx`.

**1. Add it to your client.**

Claude Code:

```sh
claude mcp add dryplate -- npx -y @dryplate/mcp
```

Claude Desktop (`claude_desktop_config.json`), Cursor (`~/.cursor/mcp.json`) and most other clients take the same JSON:

```json
{
	"mcpServers": {
		"dryplate": {
			"command": "npx",
			"args": ["-y", "@dryplate/mcp"]
		}
	}
}
```

Restart the client after editing its config. If the server fails with `spawn npx ENOENT` or `env: node: No such file or directory` (common when Node comes from nvm or fnm), add the folder that `dirname "$(which node)"` prints to the server's PATH:

```json
"env": { "PATH": "/Users/you/.nvm/versions/node/v24.13.0/bin:/usr/bin:/bin" }
```

**2. Ask for something.** Type the file path in your message; an attached image goes to the client, not to the server.

> Remove the location data from ~/Pictures/IMG_0042.HEIC, then make a 256 px thumbnail of it.

The agent calls `remove_metadata`, then `generate_thumbnail`, and reports each file it wrote.

## How files are handled

- Every tool takes `path` (merge takes `paths`): an absolute path or one starting with `~/`. Each writes a new file. Image bytes never pass through the agent's context.
- The output goes next to the input with a suffix for what was done: `IMG_0042-resized.jpg`, `IMG_0042-thumb.webp`, `IMG_0042-clean.jpg`. Merge names it after the first file. Pass `output` to choose another path; its extension must match the result (a JPEG merge can't be saved as `.png`; use `convert_image` for that).
- An existing file is never replaced unless you pass `overwrite: true`.
- Input formats: JPEG, PNG, WebP, AVIF and HEIC. HEIC is decoded but not written, so HEIC input comes out as JPEG unless you pick a format.
- Every tool takes `quality` (1–100) for lossy output.

## Tools

| Tool                 | Does                                                  | Options                                                                                                            |
| -------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `convert_image`      | Change format                                         | `format`: `jpeg`, `png`, `webp`, `avif`                                                                            |
| `resize_image`       | Resize, keeping aspect ratio                          | `width`, `height` (both together fit inside that box), `percent`                                                   |
| `compress_image`     | Make the file smaller in its own format; never bigger | `maxKb`                                                                                                            |
| `crop_image`         | Centred ratio crop, or a box                          | `ratio` like `"16:9"`, or `box`                                                                                    |
| `rotate_image`       | Rotate clockwise and/or flip                          | `degrees`: 0, 90, 180, 270 (default 90); `flip`: `h`, `v`                                                          |
| `blur_image`         | Blur the whole image or some areas                    | `strength` 1–100 (default 20); `areas`: list of boxes                                                              |
| `watermark_image`    | Draw text                                             | `text`; `size` (% of short side), `opacity` 5–100, `x`, `y` (0–1), `tile`                                          |
| `remove_metadata`    | Strip GPS, camera and other hidden data               | none. Lossless for JPEG, PNG and WebP; orientation kept                                                            |
| `merge_images`       | Combine images in a row or a stack                    | `paths` (2+); `direction`: `horizontal`, `vertical`; `gap` 0–500 px; `background`: `white`, `black`, `transparent` |
| `generate_thumbnail` | Small preview inside a square box; never enlarges     | `size` (default 256), `format` (default `webp`)                                                                    |

A box is `{ "x": 0, "y": 0, "w": 0.5, "h": 0.5 }`: fractions of the image from the top left. That example is the top-left quarter.

## Errors

A failed call returns a tool error with a plain message, such as `Set a width, height or percent` or `… exists. Pass overwrite: true or a different output.` The server keeps running.
