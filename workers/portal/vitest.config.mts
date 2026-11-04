import { cloudflareTest } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.toml' },
      miniflare: {
        // The Durable Object tests call /admin/training with this token.
        bindings: { ADMIN_TOKEN: 'admin-token' },
        // wrangler.toml binds PRICES to the eBay price Worker; tests get a stub that never prices anything.
        workers: [
          {
            name: 'ygo-ebay-prices',
            modules: true,
            script:
              'export default { fetch() { return new Response("not in tests", { status: 503 }) } }'
          }
        ]
      }
    })
  ],
  test: {
    include: ['test/**/*.test.ts']
  }
})
