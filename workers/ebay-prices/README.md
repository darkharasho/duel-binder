# ygo-ebay-prices

Cloudflare Worker that returns eBay asking prices for non-English Yu-Gi-Oh! cards, so the
desktop app never ships an eBay key.

```
GET /v1/price?code=<set code or ''>&name=<English card name>&set=<English set name>&rarity=<rarity>&lang=<language code>
Header: X-Client: ygo-collection-tracker
200 { "price": number | null, "listingCount": number, "rarityFallback": boolean, "currency": "USD", "checkedAt": "<ISO>" }
400 bad params or header, 405 non-GET, 502 { "error": "upstream" }
```

Prices are the median of matching active USD listings (outliers beyond 3x the median are
dropped; fewer than 2 listings gives `price: null`). Graded slabs, lots and proxies are skipped.
If fewer than 2 listings match the rarity, it searches again without it, skipping listings that
name a different rarity, and sets `rarityFallback: true`. Results are cached in KV for 7 days.

## Deploy (owner only)

Run from this directory. The eBay keys live only as Worker secrets.

```
npm install -g wrangler        # or npx wrangler
wrangler kv namespace create PRICES   # paste the printed id into wrangler.toml
wrangler secret put EBAY_APP_ID
wrangler secret put EBAY_CERT_ID
wrangler deploy
```

Then point the app at the Worker URL (`PRICE_WORKER_URL`, or env `YGO_PRICE_WORKER_URL`).

Tests run from the repo root with `npm test`.
