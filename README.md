# Shared Gallery

A private, self-hosted photo and video gallery for a small group, running entirely
on the **Cloudflare free plan**. One shared password, no accounts. Upload by drag and drop
(hundreds at a time), organise into collections, browse from any device. Installs as
a PWA on phones.

Built as a single Cloudflare Worker: R2 stores the originals, D1 the metadata, and
Cloudflare Images produces thumbnails on demand.

## Features

- Drag-and-drop bulk upload of photos and MP4, WebM, or QuickTime videos (files or
  folders), with automatic retry and camera capture on mobile
- Collections as virtual folders; a photo can live in many at once
- Lightbox with swipe/keyboard navigation, captions, and a details pane (EXIF capture date, camera, resolution — press `i`)
- Set or update a video's gallery thumbnail from its current frame in the lightbox
- Reprocess metadata in the lightbox or in bulk: image dimensions and JPEG EXIF,
  plus video dimensions, duration, and embedded capture details when available
- Set or correct an item's capture date manually from the lightbox details pane
- Multi-select (shift-click for ranges) to download or file photos
- Everything attributed: see who uploaded or tagged each photo
- Offline-capable installable PWA; originals stored byte-identical, metadata intact

## Getting started

You need Node 20+, npm, and a Cloudflare account (free).

```sh
git clone https://github.com/Zesty0wl/cloudflare-shared-gallery
cd cloudflare-shared-gallery
npm install
npx wrangler login

# Create resources, then put the printed database_id into wrangler.jsonc
npx wrangler r2 bucket create shared-gallery-media
npx wrangler d1 create shared-gallery-db
npx wrangler d1 migrations apply shared-gallery-db --remote

# Secrets: your shared password (as a hash) and a session-signing key
node scripts/hash-password.mjs "your password" | npx wrangler secret put GALLERY_PASSWORD_HASH
openssl rand -base64 32 | npx wrangler secret put JWT_SECRET

npm run deploy
```

Then enable **Images → Transformations** in the Cloudflare dashboard (one-time) so
thumbnails resolve. Share the URL and password with your group.

### Local development

```sh
cp .dev.vars.example .dev.vars    # dev secrets; generate a hash as above
npx wrangler d1 migrations apply shared-gallery-db --local
npm run dev
```

## Free plan limits

The design keeps everything inside Cloudflare's free tiers: 10 GB of photo storage,
100k requests/day, and 5,000 image transformations per 30 days (roughly 2,500 photos;
thumbnails are aggressively cached so repeats are free). The in-app footer shows live
usage. Uploads are limited to 100 MB per file. Videos play directly from R2 and
support seeking; they are not resized or transcoded. Details and design
constraints are in [docs/PRD.md](docs/PRD.md) and [AGENTS.md](AGENTS.md).

Deletes are soft: photos sit in "Recently deleted" (Settings menu) for 30 days, where
anyone can restore them, collections included. Nothing is permanently removed before
then, so a leaked password or a bad day cannot destroy the gallery. D1 Time Travel
(built into Cloudflare, 30 days) is a further metadata backstop.

To log every device out, rotate the session key:
`openssl rand -base64 32 | npx wrangler secret put JWT_SECRET`.

## License

[MIT](LICENSE). Icons from [Octicons](https://github.com/primer/octicons) (MIT).
Designed by [bzwrd](https://bzwrd.co.uk).
