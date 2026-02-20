import fs from 'fs-extra'
import path from 'node:path'
import type { Plugin } from 'vite'

export interface WpHmrOptions {
  /** Directory to write the mu-plugin PHP file */
  outputDir: string
  /** PHP filename (default: 'vite-hmr.php') */
  fileName?: string
  /** Additional TLD/host patterns for dev environment detection.
   *  Merged with defaults: localhost, 127.0.0.1, .local, .test, .dev */
  devPatterns?: string[]
  /** Vite HMR event names that trigger CSS stylesheet cache-busting.
   *  Omitted = no CSS reload listener injected. */
  cssReloadEvents?: string[]
  /** CSP header behavior: true = default permissive policy,
   *  false = disabled, string = custom policy (default: true) */
  csp?: boolean | string
  /** Remove the PHP file when dev server closes (default: true) */
  cleanup?: boolean
  /** Transient cache TTL in seconds for port-alive probe (default: 5) */
  cacheTtl?: number
  /** Full Vite dev server origin override (e.g. 'https://localhost:5173').
   *  Bypasses auto-detection from Vite config. */
  origin?: string
}

const DEFAULT_TLDS = ['local', 'test', 'dev']

export function buildPhp(origin: string, options: WpHmrOptions): string {
  const url = new URL(origin)
  const host = url.hostname
  const port = url.port || (url.protocol === 'https:' ? '443' : '80')
  const cacheTtl = options.cacheTtl ?? 5

  const extraTlds = options.devPatterns ?? []
  const allTlds = [...DEFAULT_TLDS, ...extraTlds]
  const tldList = allTlds.map((t) => `'${t}'`).join(', ')

  const lines: string[] = []

  // Header
  lines.push(`<?php`)
  lines.push(`/**`)
  lines.push(` * Plugin Name: Vite HMR`)
  lines.push(` * Description: Injects Vite dev client for live reload. Auto-generated — do not edit.`)
  lines.push(` */`)
  lines.push(``)

  // Dev detection
  lines.push(`if ( ! function_exists( 'vite_hmr_is_dev' ) ) {`)
  lines.push(`\tfunction vite_hmr_is_dev(): bool {`)
  lines.push(`\t\t$host = $_SERVER['HTTP_HOST'] ?? '';`)
  lines.push(`\t\tif ( $host === 'localhost' || $host === '127.0.0.1' ) { return true; }`)
  lines.push(`\t\tforeach ( [ ${tldList} ] as $tld ) {`)
  lines.push(`\t\t\tif ( preg_match( '/\\\\.' . $tld . '$/i', $host ) ) { return true; }`)
  lines.push(`\t\t}`)
  lines.push(`\t\treturn false;`)
  lines.push(`\t}`)
  lines.push(`}`)
  lines.push(``)

  // Port probe
  lines.push(`if ( ! function_exists( 'vite_hmr_is_running' ) ) {`)
  lines.push(`\tfunction vite_hmr_is_running(): bool {`)
  lines.push(`\t\t$key    = 'vite_hmr_${port}';`)
  lines.push(`\t\t$cached = get_transient( $key );`)
  lines.push(`\t\tif ( $cached !== false ) { return (bool) $cached; }`)
  lines.push(`\t\t$conn   = @fsockopen( '${host}', ${port}, $errno, $errstr, 1 );`)
  lines.push(`\t\t$result = is_resource( $conn );`)
  lines.push(`\t\tif ( $result ) { fclose( $conn ); }`)
  lines.push(`\t\tset_transient( $key, (int) $result, ${cacheTtl} );`)
  lines.push(`\t\treturn $result;`)
  lines.push(`\t}`)
  lines.push(`}`)
  lines.push(``)

  // Client injection
  lines.push(`if ( ! function_exists( 'vite_hmr_inject' ) ) {`)
  lines.push(`\tfunction vite_hmr_inject(): void {`)
  lines.push(`\t\tif ( ! vite_hmr_is_dev() || ! vite_hmr_is_running() ) { return; }`)
  lines.push(`\t\techo '<script type="module" src="${origin}/@vite/client"></script>' . "\\n";`)

  if (options.cssReloadEvents?.length) {
    lines.push(`\t\techo '<script type="module">' . "\\n";`)
    lines.push(`\t\techo 'import { createHotContext } from "${origin}/@vite/client";' . "\\n";`)
    lines.push(`\t\techo 'const hot = createHotContext("/wp-hmr");' . "\\n";`)
    for (const event of options.cssReloadEvents) {
      lines.push(`\t\techo 'hot.on("${event}", () => {' . "\\n";`)
      lines.push(`\t\techo '  document.querySelectorAll("link[rel=stylesheet]").forEach(l => {' . "\\n";`)
      lines.push(`\t\techo '    const u = new URL(l.href); u.searchParams.set("t", Date.now()); l.href = u.toString();' . "\\n";`)
      lines.push(`\t\techo '  });' . "\\n";`)
      lines.push(`\t\techo '});' . "\\n";`)
    }
    lines.push(`\t\techo '</script>' . "\\n";`)
  }

  lines.push(`\t}`)
  lines.push(`}`)
  lines.push(`add_action( 'wp_head', 'vite_hmr_inject', 1 );`)
  lines.push(``)

  // CSP
  if (options.csp !== false) {
    const policy =
      typeof options.csp === 'string'
        ? options.csp
        : "Content-Security-Policy: script-src * blob: 'unsafe-inline' 'unsafe-eval'; worker-src * blob:; connect-src * 'unsafe-inline';"

    lines.push(`if ( ! function_exists( 'vite_hmr_csp' ) ) {`)
    lines.push(`\tfunction vite_hmr_csp(): void {`)
    lines.push(`\t\tif ( ! vite_hmr_is_dev() ) { return; }`)
    lines.push(`\t\theader( "${policy}" );`)
    lines.push(`\t}`)
    lines.push(`}`)
    lines.push(`add_action( 'send_headers', 'vite_hmr_csp', 1 );`)
    lines.push(``)
  }

  return lines.join('\n')
}

export function wpHmr(options: WpHmrOptions): Plugin {
  let origin: string

  return {
    name: 'vite-plugin-wp-hmr',
    apply: 'serve',

    configResolved(config) {
      if (options.origin) {
        origin = options.origin
      } else {
        const protocol = config.server.https ? 'https' : 'http'
        const port = config.server.port ?? 5173
        origin = `${protocol}://localhost:${port}`
      }
    },

    configureServer(server) {
      const fileName = options.fileName ?? 'vite-hmr.php'
      const phpFile = path.join(options.outputDir, fileName)
      const php = buildPhp(origin, options)

      fs.mkdirpSync(options.outputDir)
      fs.writeFileSync(phpFile, php)

      if (options.cleanup !== false) {
        server.httpServer?.on('close', () => {
          try {
            fs.removeSync(phpFile)
          } catch {}
        })
      }
    },
  }
}
