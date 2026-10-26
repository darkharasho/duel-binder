## Project Context

**Duel Binder** (formerly yugioh-collection-tracker; the appId `com.darkharasho.yugiohcollectiontracker` is kept on purpose so signed macOS auto-updates keep working): a local, offline-first Electron desktop app for cataloging a personal Yu-Gi-Oh! card collection. Users add cards with quantity, set, rarity, and condition, then search and filter them. Card details and images are fetched automatically from the YGOPRODeck API and cached locally. A modern, easy-to-use UI shows collection stats such as total cards and estimated value.

## Goals

- Add, edit, and remove cards with quantity, set, rarity, and condition
- Search and filter the collection by name, type, set, rarity, and other attributes
- Auto-fetch card details, images, and prices from the YGOPRODeck API and cache them locally
- Dashboard with collection stats (total cards, unique cards, estimated value)
- Modern, clean, easy-to-use UI
- Work offline with local data storage
- Web portal, sync and friends' binders via the `workers/portal` Cloudflare Worker (marketing site at duelbinder.com, app at app.duelbinder.com)

## Out of scope

- Trading or marketplace features
- Mobile version

## Suggested stack

- **Electron** — User's preferred desktop framework; cross-platform
- **React + TypeScript (via Vite)** — Modern, type-safe UI with a fast dev workflow
- **Tailwind CSS + shadcn/ui** — Clean, modern components with little custom styling work
- **SQLite (better-sqlite3)** — Reliable local offline storage for the collection and cached card data
- **YGOPRODeck API** — Free, comprehensive Yu-Gi-Oh! card data, images, and prices
