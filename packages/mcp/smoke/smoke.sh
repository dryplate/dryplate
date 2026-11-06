#!/bin/sh
# Packs the MCP server, installs the tarball into an empty folder, and calls every tool over stdio.
# Usage: packages/mcp/smoke/smoke.sh
set -eu
here=$(cd "$(dirname "$0")" && pwd)
mcp=$here/..
fixtures=$mcp/../core/fixtures
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

(cd "$mcp" && pnpm build >/dev/null && pnpm pack --pack-destination "$tmp" >/dev/null)
cd "$tmp"
echo '{"name":"consumer","private":true,"type":"module"}' >package.json
npm install --silent ./dryplate-mcp-*.tgz
pkg=node_modules/@dryplate/mcp
# No source or tests, and the notices ship.
if [ -e "$pkg/src" ]; then echo "src/ shipped"; exit 1; fi
for f in LICENSE AUTHORS README.md dist/THIRD-PARTY-NOTICES.md; do
	[ -s "$pkg/$f" ] || { echo "missing $f"; exit 1; }
done

mkdir work
cp "$fixtures/photo.jpg" "$fixtures/photo.heic" work/
node "$here/client.mjs" node_modules/.bin/dryplate-mcp "$tmp/work"
