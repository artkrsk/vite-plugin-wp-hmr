# vite-plugin-wp-hmr

Vite plugin that writes a self-contained WordPress mu-plugin PHP file at dev-server start, so a
WordPress site loads Vite's HMR client during local development. Published to npm as
`@artemsemkin/vite-plugin-wp-hmr`.

## How it works

Two runtimes meet here:

- **Node / Vite side** (`wpHmr`) — a `serve`-only plugin. On `configResolved` it resolves the dev
  origin (from `options.origin`, else `http(s)://localhost:{port}`); on `configureServer` it
  generates the PHP, writes it to `outputDir/fileName`, and removes it on server close (unless
  `cleanup: false`).
- **Generated PHP side** (`buildPhp`) — a pure `(origin, options) => string` function that emits
  the mu-plugin source. Kept pure and separately exported precisely so the entire output is
  unit-testable without a running server (that is what `tests/` exercises).

Client-script injection and `<script>` rewriting only fire when BOTH gates pass at request time:
`vite_hmr_is_dev()` (host match) AND `vite_hmr_is_running()` (TCP probe of the Vite port). So the
file does nothing in production or when Vite is down, and is safe to leave in place. Optional
extras layered on top: rewrite registered script tags to the dev server (`entries`), cache-bust
stylesheets on named HMR events (`cssReloadEvents`), and send a permissive dev CSP header (`csp`).

## Commands

- `pnpm install` — pnpm is the package manager (`pnpm-lock.yaml`, pinned via `packageManager`).
- `pnpm test` — Vitest (`vitest run`); the suite asserts against `buildPhp`'s string output.
- `pnpm build` — `tsc -p tsconfig.build.json`; emits `dist/index.js` + `index.d.ts`, the only
  published files.
- Typecheck without emit: `tsc --noEmit` uses `tsconfig.json` (src only, `noEmit`).
  `tsconfig.build.json` is the separate emit config.

## Layout

- `src/index.ts` — the whole implementation: `wpHmr()`, `buildPhp()`, `WpHmrOptions`.
- `tests/index.test.ts` — Vitest suite over `buildPhp`.
- `dist/` — build output; gitignored, published.

## Public API

- `wpHmr(options: WpHmrOptions): Plugin` — the Vite plugin. `name: 'vite-plugin-wp-hmr'`,
  `apply: 'serve'`.
- `buildPhp(origin: string, options: WpHmrOptions): string` — pure PHP generator, exported for
  testing and advanced use.
- `WpHmrOptions` — only `outputDir` is required; every other field is optional, with its default
  documented on the field's own JSDoc.

## Frozen identifiers (in the generated PHP)

Changing any of these breaks WordPress-side code that relies on them:

- PHP functions, each behind a `function_exists` guard: `vite_hmr_is_dev`, `vite_hmr_is_running`,
  `vite_hmr_inject`, `vite_hmr_rewrite_entry`, `vite_hmr_csp`.
- WP hooks: `wp_head` (inject, prio 1), `script_loader_tag` (entry rewrite, prio 10 / 3 args),
  `send_headers` (CSP, prio 1).
- Transient key `vite_hmr_{port}`; HMR channel `/wp-hmr` (via `createHotContext`); default
  filename `vite-hmr.php`.
- Default dev hosts: exact `localhost` and `127.0.0.1`, plus TLD suffixes `local`, `test`, `dev`.

## Gotchas

- The port probe is cached in a WP transient for `cacheTtl` seconds (default 5), so WordPress can
  lag up to that long behind the real dev-server state.
- The CSP header (`send_headers`) is gated on `vite_hmr_is_dev()` ONLY — it is sent on any matched
  dev host even while Vite is down; injection and entry rewriting additionally require
  `vite_hmr_is_running()`.
- `devPatterns` entries are TLD *suffixes* (matched `/\.pattern$/i`), not exact hosts; only the
  built-in `localhost`/`127.0.0.1` match exactly.
- `probeOrigin` exists for Docker: the browser reaches Vite at `origin`, but PHP inside a
  container may need a different host (e.g. `host.docker.internal`) for `fsockopen`. Falls back to
  `origin`.
- Tests import from `../src/index.js` (ESM `.js` specifier from a `.ts` source) — keep the `.js`.

## Dependencies

Runtime: `fs-extra`. Peer: `vite >=5`. Dev: `typescript`, `vitest`, `@types/node`,
`@types/fs-extra`.

## Release

Publishing is automated: bump `version` in `package.json` and push to `main`.
`.github/workflows/publish.yml` (triggered only by `package.json` changes) delegates to the
reusable `artkrsk/github-actions/.github/workflows/npm-publish.yml@v1`, which publishes to npm via
OIDC trusted publishing — no manual `npm publish`, no token. `prepublishOnly` rebuilds `dist`
first.
