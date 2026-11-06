#!/bin/sh
# Packs the SDK, installs the tarball into an empty folder, and uses it from plain Node and from a Vite-built page in headless Chrome.
# Usage: packages/sdk/smoke/smoke.sh   (set CHROME if Chrome isn't at the macOS or Linux default path)
set -eu
here=$(cd "$(dirname "$0")" && pwd)
sdk=$here/..
fixtures=$sdk/../core/fixtures
vite=$sdk/node_modules/vite/bin/vite.js
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

(cd "$sdk" && pnpm build >/dev/null && pnpm pack --pack-destination "$tmp" >/dev/null)
cd "$tmp"
echo '{"name":"consumer","private":true,"type":"module"}' >package.json
pnpm add ./dryplate-sdk-*.tgz sharp >/dev/null

cp "$here/node.mjs" .
node node.mjs "$fixtures"

mkdir -p public
cp "$here/browser/index.html" "$here/browser/main.js" .
cp "$fixtures/photo.jpg" "$fixtures/photo.heic" public/
node "$vite" build --logLevel error
chrome=${CHROME:-}
[ -n "$chrome" ] || for c in "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" google-chrome chromium; do
	command -v "$c" >/dev/null 2>&1 && chrome=$c && break
done
node "$here/serve.mjs" dist "$chrome"
