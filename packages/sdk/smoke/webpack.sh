#!/bin/sh
# Same browser smoke page as smoke.sh, bundled by webpack 5 instead of Vite. Not in CI: run by hand after bundling changes.
# Usage: packages/sdk/smoke/webpack.sh   (set CHROME if Chrome isn't at the macOS or Linux default path)
set -eu
here=$(cd "$(dirname "$0")" && pwd)
sdk=$here/..
fixtures=$sdk/../core/fixtures
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

(cd "$sdk" && pnpm build >/dev/null && pnpm pack --pack-destination "$tmp" >/dev/null)
cd "$tmp"
echo '{"name":"consumer","private":true,"type":"module"}' >package.json
npm install --silent ./dryplate-sdk-*.tgz webpack@5 webpack-cli@6
cp "$here/browser/main.js" .
cat >webpack.config.js <<'EOF'
export default {
	mode: "production",
	entry: "./main.js",
	experiments: { outputModule: true },
	output: { path: new URL("./dist", import.meta.url).pathname, module: true, clean: true, filename: "main.js", chunkFilename: "[id].js" },
	performance: { hints: false },
	// libheif's Emscripten glue names Node built-ins it never loads in a browser; oxipng's worker imports "../../../".
	resolve: { fallback: { fs: false, path: false } },
	module: { rules: [{ test: /\.m?js$/, resolve: { fullySpecified: false } }] },
};
EOF
npx webpack --stats errors-warnings
cp "$here/browser/index.html" "$fixtures/photo.jpg" "$fixtures/photo.heic" dist/
chrome=${CHROME:-}
[ -n "$chrome" ] || for c in "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" google-chrome chromium; do
	command -v "$c" >/dev/null 2>&1 && chrome=$c && break
done

node "$here/serve.mjs" dist "$chrome"
