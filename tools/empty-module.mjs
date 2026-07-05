// Build-time stub for optional dependencies excluded from bundles
// (see tools/build-cli-dist.mjs). Ink imports react-devtools-core only when
// DEV=true; the standalone TUI bundle replaces it with this empty module so
// the import graph resolves without shipping devtools.
export default undefined;
