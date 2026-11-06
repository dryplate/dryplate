# Third-party notices

The SDK's own code is MIT (see `LICENSE`). The browser build ships one third-party file.

## dist/libheif.wasm

From [libheif-js](https://github.com/catdad-experiments/libheif-js) 1.23.5, unmodified. It contains:

- [libheif](https://github.com/strukturag/libheif), HEIF container, LGPL-3.0
- [libde265](https://github.com/strukturag/libde265), HEVC decoder, LGPL-3.0

The file is loaded separately at runtime, and you can replace it with your own build. The LGPL-3.0 text is in `licenses/LGPL-3.0.txt`; it builds on the GPL-3.0, at https://www.gnu.org/licenses/gpl-3.0.txt. Source for the exact versions is at the links above.

Other dependencies (jSquash codecs, sharp, libheif-js itself) are installed from npm under their own licences, not bundled.
