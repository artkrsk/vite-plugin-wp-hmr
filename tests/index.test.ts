import { describe, it, expect } from 'vitest'
import { buildPhp } from '../src/index.js'
import type { WpHmrOptions } from '../src/index.js'

function opts(overrides: Partial<WpHmrOptions> = {}): WpHmrOptions {
  return { outputDir: '/tmp/mu-plugins', ...overrides }
}

describe('buildPhp', () => {
  it('generates default PHP with http://localhost:5173', () => {
    const php = buildPhp('http://localhost:5173', opts())

    expect(php).toContain('Plugin Name: Vite HMR')
    expect(php).toContain('http://localhost:5173/@vite/client')
    expect(php).toContain("@fsockopen( 'localhost', 5173")
    expect(php).toContain("'local', 'test', 'dev'")
    expect(php).toContain('Content-Security-Policy')
  })

  it('uses custom origin in script src and fsockopen', () => {
    const php = buildPhp('https://mysite.local:3000', opts())

    expect(php).toContain('https://mysite.local:3000/@vite/client')
    expect(php).toContain("@fsockopen( 'mysite.local', 3000")
  })

  it('merges devPatterns with defaults', () => {
    const php = buildPhp('http://localhost:5173', opts({ devPatterns: ['ddev'] }))

    expect(php).toContain("'local', 'test', 'dev', 'ddev'")
  })

  it('generates createHotContext for a single cssReloadEvent', () => {
    const php = buildPhp('http://localhost:5173', opts({ cssReloadEvents: ['wp:css-update'] }))

    expect(php).toContain('createHotContext')
    expect(php).toContain('hot.on("wp:css-update"')
  })

  it('generates multiple listeners for multiple cssReloadEvents', () => {
    const php = buildPhp('http://localhost:5173', opts({ cssReloadEvents: ['evt1', 'evt2'] }))

    expect(php).toContain('hot.on("evt1"')
    expect(php).toContain('hot.on("evt2"')
  })

  it('omits createHotContext when no cssReloadEvents', () => {
    const php = buildPhp('http://localhost:5173', opts())

    expect(php).not.toContain('createHotContext')
  })

  it('omits CSP block when csp is false', () => {
    const php = buildPhp('http://localhost:5173', opts({ csp: false }))

    expect(php).not.toContain('Content-Security-Policy')
    expect(php).not.toContain('vite_hmr_csp')
  })

  it('uses custom CSP string', () => {
    const policy = "Content-Security-Policy: script-src 'self';"
    const php = buildPhp('http://localhost:5173', opts({ csp: policy }))

    expect(php).toContain(policy)
  })

  it('uses custom cacheTtl', () => {
    const php = buildPhp('http://localhost:5173', opts({ cacheTtl: 10 }))

    expect(php).toContain('set_transient( $key, (int) $result, 10 )')
  })

  it('wraps all functions in function_exists guards', () => {
    const php = buildPhp('http://localhost:5173', opts())
    const functions = ['vite_hmr_is_dev', 'vite_hmr_is_running', 'vite_hmr_inject', 'vite_hmr_csp']

    for (const fn of functions) {
      expect(php).toContain(`if ( ! function_exists( '${fn}' ) )`)
    }
  })
})
