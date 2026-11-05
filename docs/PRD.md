# Shared Gallery: Product Requirements and Build Brief

> **Audience:** an autonomous coding agent (Claude Opus / Claude Fable) working in Claude Code.
> **How to use this document:** build the app in the numbered phases in section 12. Each phase has explicit acceptance criteria and verification commands. Do not advance to the next phase until the current phase's acceptance criteria pass. Commit at the end of every phase with a message referencing the phase number. Where a "Decision" is marked with a recommended default, proceed with the default unless the repository already contains a conflicting choice; do not stop to ask.
> **Hard constraint:** this must run entirely on the Cloudflare **Workers Free plan**. No paid bindings, no paid add-ons. Section 3 sets out the limits and how the design stays inside them; respect them everywhere.

---

## 1. Mission

Build **Shared Gallery**, a 100% serverless photo and video gallery web app running entirely on Cloudflare. Users upload photos and videos, browse them in a gallery, create collections that behave like virtual folders, and tag any item into one or more collections. The interface treats mobile as a first class citizen and works equally well on desktop.

The whole app (frontend and API) ships as a **single Cloudflare Worker with Static Assets**. There is no separate origin server, no container, and no VM.

## 2. Locked technical stack

These are fixed. Do not substitute without a recorded reason.

| Concern | Choice |
| --- | --- |
| Hosting and compute | Single Cloudflare **Worker with Static Assets** (frontend + API in one deployment) |
| Object storage (original images) | Cloudflare **R2** |
| Metadata database | Cloudflare **D1** (SQLite) |
| Image resizing and format conversion | Cloudflare **Images transformations** via the **Images binding** (`env.IMAGES`), reading originals from the R2 stream, results cached in the Worker Cache API |
| Authentication | Shared password plus **HS256 JWT session** in an httpOnly cookie (see section 8) |
| JWT and crypto | `jose` for signing and verifying (runs in the Workers runtime, no Node deps); WebCrypto `crypto.subtle` for password hashing |
| Login throttling | **D1 backed** counter (no paid rate-limiting rule required) |
| Frontend | **Vite + React + TypeScript** (SPA), styled with **Tailwind CSS v4** |
| Build tooling | **Vite** with the **`@cloudflare/vite-plugin`** (stitches the React client and the Worker into one build/deploy), `@vitejs/plugin-react`, and **`@tailwindcss/vite`** (Tailwind v4 has no `tailwind.config.js` and no PostCSS step; use `@import "tailwindcss";` in the CSS entry). **Wrangler v4** with a `wrangler.jsonc` config. TypeScript throughout the Worker |
| Package manager | npm |

Rationale for the hosting choice: as of 2026 Cloudflare's recommended path for a new full stack app that mixes static assets with server logic and leans on bindings (D1, R2) is Workers with Static Assets, not Pages. Pages is fine for pure static sites; this app has real API logic, so it goes on Workers.

## 3. Cloudflare Free plan: confirmed availability and limits

Every service in this brief is available on the **Workers Free plan**. Confirmed availability and the limits that matter, current as of mid 2026:

| Service | On Free? | Relevant free limit |
| --- | --- | --- |
| Workers (with Static Assets) | Yes | 100,000 requests/day; **10 ms CPU per invocation**; 128 MB memory; 50 subrequests per invocation; 3 MB compressed Worker size; **100 MB max request body** |
| R2 | Yes | 10 GB storage; 1M Class A ops/month (writes, lists); 10M Class B ops/month (reads); **no egress fees** |
| D1 | Yes | 5 GB per database; 5M rows read/day; 100k rows written/day |
| Cloudflare Images transformations | Yes | **5,000 unique transformations per 30 days** |

Three limits shape the architecture. The design already respects them:

- **10 ms CPU per invocation.** This rules out resizing images inside the Worker. A WASM image codec decoding a full resolution photo would blow the CPU budget instantly. All resizing is therefore offloaded to Cloudflare Images. The Worker reads the original from R2 as a stream and passes it to the `env.IMAGES` binding, which performs the transform on Cloudflare's image pipeline, not as Worker CPU. The Worker only orchestrates streams, which keeps it inside the 10 ms budget. Never buffer a whole original into memory; stream it.
- **5,000 unique transformations per 30 days.** With two variant presets per image (see D4) and the Cache API layer described in section 7, each image is transformed roughly once per preset until the cached result is evicted. That gives a practical ceiling of about **2,500 images** on Free before transformations approach the cap. Levers if the library grows past that, none of which need code changes beyond configuration: keep to two presets, add a custom domain, or enable the Images Paid plan (transformations then cost $0.50 per 1,000).
- **100,000 Worker requests/day.** Every API call and every image byte request (`/media/*`) invokes the Worker. A gallery screen with 40 thumbnails is roughly 40 to 45 requests, so about 2,000 screen loads per day. Comfortable for a shared personal gallery. Variant responses are cached (Cache API plus long lived `Cache-Control`), so repeat views are cheap and do not re-transform.

Not used, so not a concern on Free: Durable Objects, Queues, Cron Triggers, Workers KV (login throttling uses D1 instead), and Cloudflare Access.

**Document these in the README.** The project README must include a **Constraints** section that reproduces the Free-plan limits above so future maintainers understand the ceilings before adding features. At minimum it must state:

- The app is built to run entirely on the Cloudflare Workers Free plan, with no paid bindings or add-ons.
- **Image transformations are capped at 5,000 unique transformations per 30 days.** With two variant presets per image, this is a practical ceiling of roughly 2,500 images. This limit is expected to be sufficient for current use; if the library grows past it, the levers are: stay at two presets, add a custom domain, or enable the Images Paid plan ($0.50 per 1,000 transformations).
- Worker requests are capped at 100,000/day, R2 storage at 10 GB, and D1 at 5 GB per database, with the other per-service limits from the table above.
- The 10 ms CPU per invocation limit is why image resizing is offloaded to the Images binding and must never be done in the Worker.

## 4. Decisions with recommended defaults

Proceed with the default. Each is a single switch that can be revisited later without re-architecting.

- **D1. Authentication.** A **single shared password** gates the whole gallery, with a long lived JWT session so members are not re-prompted. No user accounts, no emails. The password is stored only as a PBKDF2 hash in a Wrangler secret; the session is an HS256 JWT delivered in an httpOnly cookie. Full model in section 8. Everything requires a valid session by default. Read endpoints and mutation endpoints are kept separate so that open public viewing could be enabled later (ungate reads only) without touching writes, but do not build a public mode now.
- **D2. Identity model.** Default: **single shared space** with **self-declared display names** for attribution. Everyone who knows the password shares one pool of images and collections. There are no accounts and no access partitioning: the display name is a soft label recording who uploaded or tagged something, not a security boundary (anyone with the password could type any name, which is acceptable for a small trusted group). Full flow in section 6.
- **D3. Upload transport.** The client streams uploads through the authenticated Worker into R2. Files up to 64 MiB use one request; larger files use R2 multipart uploads with 16 MiB chunks, keeping every Worker request below Cloudflare's 100 MB request-body limit on Free. Enforce a maximum file size of **200 MiB**. Support JPEG, PNG, GIF, WebP, and AVIF images, plus MP4, WebM, and QuickTime videos. Videos are streamed from R2 with byte-range support for browser playback and seeking; they are not transformed or transcoded. A poster can be captured from the current frame in the browser and stored separately in R2.
- **D4. Variant strategy.** Store **originals only** in R2. Generate variants on demand through the Images binding. Default to **two presets** to conserve the Free transformation budget: `thumb` (width 480, for grid tiles) and `full` (width 1600, for the lightbox), both `fit=scale-down`, `format=auto`. A third mid preset is optional if grid tiles look soft, at the cost of one more transformation per image. Never store resized copies and never resize inside the Worker.

## 5. Data model

D1 schema. Use UUIDv4 string ids. Timestamps are Unix epoch milliseconds (integer). Create these as versioned migration files.

```sql
-- images: one row per uploaded original
CREATE TABLE images (
  id              TEXT PRIMARY KEY,
  r2_key          TEXT NOT NULL UNIQUE,      -- key of the original object in R2
  original_name   TEXT NOT NULL,
  content_type    TEXT NOT NULL,
  size_bytes      INTEGER NOT NULL,
  width           INTEGER,
  height          INTEGER,
  caption         TEXT,                      -- doubles as alt text
  uploaded_by     TEXT,                      -- self-declared display name, not an account (see section 6)
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

-- collections: virtual folders
CREATE TABLE collections (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  slug            TEXT NOT NULL UNIQUE,
  description     TEXT,
  cover_image_id  TEXT REFERENCES images(id) ON DELETE SET NULL,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_by      TEXT,                      -- self-declared display name
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

-- image_collections: many to many. An image can live in zero, one, or many collections.
CREATE TABLE image_collections (
  image_id        TEXT NOT NULL REFERENCES images(id) ON DELETE CASCADE,
  collection_id   TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  added_by        TEXT,                      -- self-declared display name of who tagged it
  added_at        INTEGER NOT NULL,
  PRIMARY KEY (image_id, collection_id)
);

-- login_attempts: lightweight D1-backed throttle for the shared-password login
CREATE TABLE login_attempts (
  ip              TEXT NOT NULL,
  attempted_at    INTEGER NOT NULL
);

CREATE INDEX idx_ic_collection ON image_collections(collection_id);
CREATE INDEX idx_ic_image      ON image_collections(image_id);
CREATE INDEX idx_images_created ON images(created_at DESC);
CREATE INDEX idx_login_ip_time ON login_attempts(ip, attempted_at);
```

**Untagged** is a derived state, not a column: an image is untagged when it has no row in `image_collections`. The canonical query for untagged images:

```sql
SELECT i.* FROM images i
LEFT JOIN image_collections ic ON ic.image_id = i.id
WHERE ic.image_id IS NULL
ORDER BY i.created_at DESC;
```

## 6. Views and UX specification

The gallery has one navigation control (a view switcher) offering three top level views, plus a collection detail view.

1. **All Images.** A flat grid of every image, ignoring collection membership. Newest first.
2. **Collections.** A grid of collection tiles only. Each tile shows the cover image (or the most recent member as a fallback), the collection name, and the member count.
3. **Root (default home).** A file explorer style view that combines both kinds of thing on one screen: collection folder tiles first, then the **untagged** loose images below them. This is the "images that are not tagged, alongside collection folders" requirement. Folders sort above loose images.

**Collection detail.** Opening a folder shows a flat grid of that collection's images, with the collection name, description, and controls to rename, set a cover, and delete.

**Lightbox.** Tapping or clicking any image opens a full screen lightbox showing the `full` variant, the caption, which collections it belongs to, and controls to edit caption, add or remove it from collections, and delete it. Left/right navigation moves through the current view's image set. On touch devices, horizontal swipe navigates and a downward swipe or tap on the backdrop closes.

**Metadata reprocessing.** The lightbox can reprocess one item, and multi-select can reprocess a batch. Images refresh their dimensions and JPEG EXIF capture date and camera. Videos are parsed in the browser with MediaInfo using authenticated byte-range requests, without buffering the complete original at once. Video width, height, duration, recorded date, and camera details are refreshed when present in supported container metadata. Processing runs sequentially for batches and reports failures. The lightbox details pane also allows manually setting, correcting, or clearing the capture date. A badge on the details control indicates when capture date, camera, dimensions, or video duration are missing. Video thumbnails retain a visible video label in grids and collection covers.

**Tagging interaction.** From the lightbox (and via multi-select in any grid), the user can add the image to or remove it from any collection through a checklist of collections. Membership is many to many, so ticking multiple collections is expected and normal.

**Empty and loading states.** Every view has a designed empty state (for example, Root with no images invites the first upload) and a skeleton or blurred placeholder while thumbnails load.

**Display names and attribution (first run).** After a valid session is established, if the browser has no stored display name, show a small one-step prompt asking for a name (label only, for example "What should we call you?"). This is **not** authentication: it is a soft, self-declared label so the gallery can show who uploaded or tagged something. Behaviour:

- Store the name in the client's **localStorage** under a key such as `sg_display_name`. It is per device, so a member sets it once per browser; offer a way to change it later in a small settings control.
- The client fetch layer attaches the name as an **`X-Gallery-User` header** on every request. The server records it on write actions: `images.uploaded_by` on upload, `image_collections.added_by` on tagging, and `collections.created_by` on collection creation. Because attribution is persisted server side in D1, the "who" shows on every device, not only the one that performed the action.
- The server **sanitizes** the header: trim, cap at 40 characters, strip control characters, and treat empty as null. No uniqueness requirement (two members may share a name); it is a display label only. Never trust it for access decisions.
- Require a display name to be set before the first upload or tag so attribution is never blank; reads never require it. Missing or spoofed values are harmless by design.
- Surface attribution subtly: "Uploaded by {name}" in the lightbox and image detail, "Tagged by {name}" on a membership where useful, and "Created by {name}" on a collection. Render null attribution as a neutral fallback such as "Unknown".

## 7. API contract

All endpoints live under `/api`. JSON in, JSON out, except image bytes. Return proper status codes and a `{ "error": string }` body on failure. Paginate list endpoints with an opaque `cursor` and a `limit` (default 60, max 120). Write endpoints read the optional **`X-Gallery-User`** header (sanitized server side) and persist it as attribution (`uploaded_by`, `added_by`, `created_by`); read endpoints return the stored attribution in their responses. This header is a display label only and is never used for authorization.

**Public endpoints (no session required):**

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Liveness probe |
| POST | `/api/auth/login` | Body `{ "password": string }`. On success sets the session cookie and returns 204. On failure returns 401. D1 throttled (see section 8) |
| POST | `/api/auth/logout` | Clears the session cookie |
| GET | `/api/auth/session` | Returns 200 if the cookie is a valid session, 401 otherwise. Lets the SPA decide on boot whether to show login or gallery |

**Gated endpoints (valid session required):**

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/images` | Upload one image or video (streamed body) up to the direct-request threshold. Writes original to R2, extracts dimensions for images, inserts row. Returns the media record |
| POST | `/api/uploads` | Start an authenticated R2 multipart upload. Body includes media type, original filename, and total size; returns an opaque upload id and chunk size |
| POST | `/api/uploads/:id/parts/:partNumber` | Stream one 16 MiB-or-smaller part to R2. Returns its part number and ETag |
| POST | `/api/uploads/:id/complete` | Complete the multipart upload, verify the media type, extract metadata, and create the image record |
| DELETE | `/api/uploads/:id` | Abort an incomplete multipart upload |
| GET | `/api/images?filter=all\|untagged&cursor=&limit=&sort=` | List media. `filter=all` returns everything, `filter=untagged` returns only items with no collection membership. `sort` accepts `newest`, `oldest`, `capture-newest`, `capture-oldest`, `filename-asc`, `filename-desc`, `size-desc`, `size-asc`, `uploader-asc`, or `uploader-desc` |
| GET | `/api/images/:id` | Single image with its collection memberships |
| PATCH | `/api/images/:id` | Update caption and/or capture date (`takenAt`, Unix epoch milliseconds or null) |
| POST | `/api/images/:id/thumbnail` | Upload a browser-generated JPEG poster for a video (maximum 5 MB) |
| POST | `/api/images/:id/reprocess-metadata` | Refresh image metadata on the Worker, or save browser-extracted video metadata `{ "width", "height", "takenAt", "camera", "durationMs" }` |
| DELETE | `/api/images/:id` | Soft-delete one item into Recently deleted for 30-day recovery |
| POST | `/api/images/bulk-delete` | Soft-delete up to 200 selected items. Body `{ "imageIds": string[] }`; items remain recoverable for 30 days |
| GET | `/api/collections` | List collections with cover and member count |
| POST | `/api/collections` | Create collection (name required, slug auto generated and de-duplicated) |
| GET | `/api/collections/:id?cursor=&limit=&sort=` | Collection detail plus its images, with the same metadata sort options |
| PATCH | `/api/collections/:id` | Rename, edit description, set `cover_image_id`, reorder |
| DELETE | `/api/collections/:id` | Delete collection. Images survive; only membership rows are removed |
| POST | `/api/collections/:id/images` | Add images to collection. Body `{ "imageIds": string[] }`. Idempotent |
| DELETE | `/api/collections/:id/images/:imageId` | Remove one image from the collection |

**Image byte serving (gated, separate from the JSON API):**

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/media/:key` | Stream the original object from R2 with long lived `Cache-Control`. Used for full-resolution download |
| GET | `/media/:key?v=thumb\|full` | Return a resized, format optimized variant. The Worker reads the original from R2 as a stream, transforms it through the `env.IMAGES` binding, and stores the result in the **Cache API** with an immutable long TTL so repeat requests are served from cache and do not re-transform. Presets: `thumb` width 480, `full` width 1600, both `fit=scale-down`, `format=auto` |

Free plan notes for media serving:

- The Cache API layer is **required**, not optional: it is what keeps repeat views from re-counting against the 5,000 transformations per 30 days. Check the cache first; only transform on a miss; then put the result in the cache before returning.
- Stream the R2 body straight into the Images binding. Do not read the whole original into memory (128 MB cap, and streaming keeps CPU near zero).
- Originals are never publicly reachable: both routes require a valid session, so R2 objects are only ever served through the gated Worker.

The frontend builds `srcset` from the two variant URLs so the browser fetches the right size per device pixel ratio and viewport.

## 8. Authentication and sessions

A single shared password protects the whole gallery. Anyone who enters it correctly receives a long lived JWT session cookie and is treated as a trusted member of the shared space. This is intentionally simple: no accounts, no roles.

**Password storage.** Never store the password in code, `wrangler.jsonc`, or D1. Store a **PBKDF2 hash** as a Wrangler secret named `GALLERY_PASSWORD_HASH`, in the form `pbkdf2$<iterations>$<saltB64>$<hashB64>` (for example 100000+ iterations, SHA-256, 16 byte random salt). Provide a small documented script that takes a plaintext password and prints the hash string to paste into `wrangler secret put GALLERY_PASSWORD_HASH`. Verification uses WebCrypto `crypto.subtle` and a constant time comparison.

**Login.** `POST /api/auth/login` with `{ "password" }`. On success, mint a JWT and set it in a cookie, then return 204. On failure return 401.

**The session token.** An HS256 JWT signed with a Wrangler secret named `JWT_SECRET` (32+ random bytes). Claims: `sub` set to a constant such as `"shared"`, `iat`, and `exp` at 30 days out. Sign and verify with `jose`. The password is never placed in the token.

**Cookie attributes.** Name `sg_session`, with `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000` (30 days). httpOnly means client JavaScript cannot read it, so cross site scripting cannot steal the session. The client never touches the token directly; it just calls the API and the browser attaches the cookie.

**Not constantly prompting.** The 30 day cookie survives reloads and is sent automatically, so a member logs in roughly once per device per month. Implement **sliding renewal**: on any authenticated request where the token is within 7 days of expiry, re-issue a fresh cookie, so active members are effectively never logged out.

**Verification middleware.** Runs before every gated route (all `/api/*` except `/api/health` and `/api/auth/*`, and all `/media/*`). It reads `sg_session`, verifies signature and expiry, and returns 401 on any failure. The SPA treats a 401 as "show the login screen".

**Token storage rule.** Cookie only, httpOnly. Never localStorage or sessionStorage. This is the single most important security choice in the auth design.

**What is and is not gated.** The static SPA shell (HTML, JS, CSS) is served openly because it holds no private data and contains the login screen itself. Every image byte (`/media/*`) and every data endpoint (`/api/*` except health and auth) requires a valid session, so no gallery content is reachable without the password.

**Logout and revocation.** `POST /api/auth/logout` clears the cookie (`Max-Age=0`). Because JWTs are stateless there is no per token revocation. To force every device to re-authenticate at once, rotate `JWT_SECRET`; this invalidates all existing sessions immediately. Document this as the revocation mechanism.

**Brute force protection (Free plan safe).** The login endpoint is the only open write surface. Throttle it with the **D1 backed `login_attempts` table** keyed by client IP (read from the `CF-Connecting-IP` header): on each failed attempt insert a timestamped row, and before checking a password count recent failures for that IP; if more than 10 failures in the last 5 minutes, return 429 until the window passes. Opportunistically delete rows older than the window on each call to keep the table small. This needs no paid rate-limiting rule. PBKDF2 makes each check costly and a strong shared password is assumed. A native Cloudflare rate limiting rule on the login path can be added later as defence in depth but is not required.

**CSRF.** With `SameSite=Lax`, cross site POST, PATCH, and DELETE requests do not carry the cookie, which covers the main CSRF vector for a same origin fetch SPA. No separate CSRF token is needed at this scale; note it as a future upgrade if the threat model grows.

**PWA note.** The service worker may cache the app shell, but must not cache authenticated `/media/*` or `/api/*` responses in a way that could leak across sessions on a shared device. Either skip service worker caching for gated responses or key any media cache to the current session.

**Secrets to set (via `wrangler secret put`, never in `wrangler.jsonc`):**

- `JWT_SECRET` (32+ random bytes)
- `GALLERY_PASSWORD_HASH` (PBKDF2 hash string of the chosen shared password)

## 9. Mobile first requirements

Mobile is a first class target, not an afterthought. All of the following are in scope:

- **Responsive grid.** 2 columns on narrow phones scaling up to 5 or 6 on wide desktop, using a masonry or fixed aspect grid. Images lazy load with blurred or low quality placeholders to keep scroll smooth.
- **Touch interactions.** Tap to open the lightbox, horizontal swipe to move between images, swipe down or backdrop tap to dismiss. Hit targets at least 44px.
- **Capture and upload from mobile.** The upload control uses `accept="image/*"` and offers camera capture on mobile (`capture` attribute) as well as multi-file selection from the camera roll. Show per file upload progress.
- **Installable PWA.** Ship a web app manifest and a service worker so the app is installable to the home screen, launches full screen, and serves an offline app shell. Thumbnails may be cached opportunistically within the session rules above; uploads require connectivity and should surface a clear offline message.
- **Adaptive navigation.** A bottom navigation bar or compact control on mobile, expanding to a sidebar or top bar on desktop. The three view modes are reachable in one tap.
- **Respect safe areas** (notches, home indicators) and support both orientations.

## 10. Non functional requirements

- **Stay on Free.** Every design choice must respect section 3. No paid bindings, no in-Worker image processing, aggressive caching of variants, and two variant presets by default.
- **Performance.** Responsive images via `srcset`, `format=auto`, lazy loading, and edge plus Cache API caching of variants. Target a fast first contentful paint on a mid range phone over 4G.
- **Accessibility.** Every image carries alt text from its caption (empty caption yields a sensible default). The lightbox is keyboard navigable with focus trapping and Escape to close. Colour contrast meets WCAG AA.
- **Security.** Session gating per section 8. Validate upload content type and size server side, reject non image payloads, and never trust the client supplied filename for the R2 key (generate the key). Keep secrets out of the repo.
- **Resilience.** Every network action has a loading, success, and error state in the UI. Failed uploads are retryable. A 401 from any gated call routes the user to the login screen without losing their place where possible.

## 11. Project structure and configuration

Target layout:

```
shared-gallery/
  src/
    worker/
      index.ts            # Worker entry: routes /api/* and /media/* first, else serves assets
      router.ts           # tiny router or itty-router style dispatch
      middleware.ts       # session gate applied before gated routes
      routes/
        auth.ts           # login, logout, session, D1 throttle
        images.ts
        collections.ts
        media.ts          # R2 stream + Images binding transform + Cache API
      db/
        schema.sql
        queries.ts        # typed D1 query helpers
      lib/
        auth.ts           # jose JWT sign/verify, PBKDF2 verify, cookie helpers
        r2.ts
        imageMeta.ts      # dimension extraction on upload
        json.ts           # response helpers
    client/
      main.tsx
      App.tsx
      views/              # Login, AllImages, Collections, Root, CollectionDetail
      components/         # Grid, Lightbox, UploadButton, ViewSwitcher, CollectionPicker, DisplayNamePrompt
      lib/
        api.ts            # typed fetch client (credentials: 'include', sets X-Gallery-User)
        session.ts        # boot-time session check, 401 handling
        user.ts           # read/write sg_display_name in localStorage
      pwa/                # manifest, service worker registration
  scripts/
    hash-password.mjs     # prints a GALLERY_PASSWORD_HASH string for a given password
  migrations/             # D1 migrations, applied with wrangler d1 migrations apply
  public/                 # static assets, icons, manifest
  wrangler.jsonc
  vite.config.ts
  package.json
  AGENTS.md               # agent operating notes (see section 14)
```

`wrangler.jsonc` bindings (fill real names on first deploy; secrets are NOT listed here). Note: with the `@cloudflare/vite-plugin`, `assets.directory` is inferred from the client build output and should be omitted; keep the routing options:

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "shared-gallery",
  "main": "src/worker/index.ts",
  "compatibility_date": "2026-07-08",
  "assets": {
    "binding": "ASSETS",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*", "/media/*"]
  },
  "r2_buckets": [
    { "binding": "BUCKET", "bucket_name": "shared-gallery-media" }
  ],
  "d1_databases": [
    { "binding": "DB", "database_name": "shared-gallery-db", "database_id": "REPLACE_ME", "migrations_dir": "migrations" }
  ],
  "images": [
    { "binding": "IMAGES" }
  ],
  "vars": { "SESSION_TTL_DAYS": "30" }
}
```

The matching `vite.config.ts` registers three plugins: `react()`, `cloudflare()` (from `@cloudflare/vite-plugin`), and `tailwindcss()` (from `@tailwindcss/vite`). Dev is `vite`, build is `vite build`, local preview in the Workers runtime is `vite preview`, and deploy is `wrangler deploy` against the Vite build output. The CSS entry contains a single `@import "tailwindcss";` (no `tailwind.config.js`, no PostCSS).

Secrets are set out of band and never committed:

```
wrangler secret put JWT_SECRET
wrangler secret put GALLERY_PASSWORD_HASH
```

Notes for the agent:

- Use the `@cloudflare/vite-plugin`, which runs the Worker and serves assets in one dev server and produces a single deployable build. Do not split the client and Worker into separate deployments.
- `run_worker_first` ensures API and media routes hit Worker code before the static asset handler; everything else falls through to the SPA (`not_found_handling: single-page-application` returns `index.html` for client routes).
- The session gate must run inside the Worker for `/api/*` (except health and auth) and `/media/*`. The static shell stays open.
- The client fetch layer must send `credentials: 'include'` so the cookie is attached.
- Image transforms use the `IMAGES` binding reading the R2 object stream. The transform executes on Cloudflare's image pipeline, not as Worker CPU, so it fits the 10 ms Free budget. Cache every transformed result in the Cache API so repeat requests do not re-transform (this is what keeps you under 5,000 transformations per 30 days).
- Enable **Images > Transformations** in the Cloudflare dashboard for the account before variants will resolve. If variants error, confirm transformations are enabled and that the source (the app's own origin / R2) is an allowed source.
- Do not add Durable Objects, Queues, Cron, or KV; they are unnecessary and some are not on Free in the shape this app would need.

## 12. Build phases

Work through these in order. Each phase ends with a commit and a passing check.

### Phase 0: Scaffold and deploy skeleton
Deliver: Vite + React + TS + Tailwind client, Worker entry with a router, `wrangler.jsonc` with all bindings declared, a `GET /api/health` returning `{ "ok": true }`, and a placeholder home page.
Acceptance: `npx wrangler dev` serves the SPA locally; `/api/health` responds ok; `npx wrangler deploy` succeeds and the deployed URL loads the app shell.

### Phase 1: Data layer
Deliver: D1 migrations for all tables and indexes from section 5; R2 bucket created; typed query helpers.
Acceptance: `wrangler d1 migrations apply` runs clean against local and remote; a smoke query lists zero images without error.

### Phase 2: Authentication and session gate
Deliver: `scripts/hash-password.mjs`; `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/session`; JWT sign/verify with `jose`; PBKDF2 verification with WebCrypto; the httpOnly cookie with sliding renewal; the D1 backed login throttle; the middleware gating all gated routes; a Login view in the SPA that appears when `/api/auth/session` returns 401 and disappears after login; the first-run **DisplayNamePrompt** plus `lib/user.ts` (localStorage `sg_display_name`) and the `X-Gallery-User` header wired into `lib/api.ts` with server side sanitization.
Acceptance: with `JWT_SECRET` and `GALLERY_PASSWORD_HASH` set, the correct password logs in and sets the cookie; a wrong password returns 401; more than 10 rapid failures from one IP return 429; a gated endpoint returns 401 without the cookie and 200 with it; reloading the page does not re-prompt; logout clears the cookie and returns the user to the login screen; after login with no stored name the display-name prompt appears once, and the chosen name persists across reloads and is sent on subsequent requests.

### Phase 3: Upload and image serving
Deliver: `POST /api/images` (stream to R2, extract width and height for images, insert row, generated key, 100 MB and supported media type enforcement, record `uploaded_by` from the sanitized `X-Gallery-User` header); `GET /media/:key` (stream original); and `GET /media/:key?v=thumb|full` transforming images via the `IMAGES` binding with `format=auto` and caching results in the Cache API. All gated.
Acceptance: while logged in, uploading a JPEG and a PNG returns a record carrying the uploader's display name; the original renders at `/media/:key`; each variant returns a correctly sized, format optimized image; a second request for the same variant is served from cache without a new transformation; non image or oversized uploads are rejected; the same routes return 401 when logged out.

### Phase 4: Gallery views (All Images)
Deliver: responsive lazy loaded grid, blurred placeholders, `srcset` from the two variants, infinite scroll via cursor pagination, and the lightbox with keyboard and swipe navigation and caption editing.
Acceptance: the All Images view renders uploaded images, scrolls and paginates, and the lightbox opens, navigates, and closes on both desktop and a mobile viewport.

### Phase 5: Collections and tagging
Deliver: full collections CRUD, add and remove image to and from collections (many to many, multi-select supported), collection picker in the lightbox, cover selection, and correct untagged detection. Record `created_by` on collection creation and `added_by` on tagging, and surface "Uploaded by / Tagged by / Created by {name}" subtly in the relevant views.
Acceptance: create a collection; tag one image into two collections at once; confirm it appears in both and that the tag records the current display name; remove it from one; confirm the untagged query excludes any image that has at least one membership; confirm attribution shows on a different browser (proving it is stored server side, not just locally).

### Phase 6: Root explorer and view switcher
Deliver: the three view modes (All Images, Collections, Root) behind a one tap switcher; Root shows collection folders above untagged loose images; folder drill-in to collection detail; breadcrumb or back navigation.
Acceptance: all three modes render correctly; Root shows both folders and loose untagged images together; opening a folder shows only that collection's images; the switcher works on mobile and desktop.

### Phase 7: Mobile polish and PWA
Deliver: web app manifest, service worker with offline app shell, install prompt handling, camera capture upload, per file upload progress, adaptive bottom nav, safe area handling, and the session aware caching rules from section 8.
Acceptance: the app is installable to a phone home screen and launches full screen; camera capture upload works on a mobile browser; swipe navigation feels native; the app shell loads offline; gated responses are not leaked from the service worker cache across sessions.

### Phase 8: Hardening and Free-plan check
Deliver: server side validation and limits everywhere; error, empty, and loading states across all views; accessibility pass (alt text, focus trap, contrast); delete flows that clean up R2 objects and junction rows; a README including a **Constraints** section per section 3 (Free-plan limits, and the 5,000 transformations per 30 days cap called out explicitly), plus setup, secret rotation, and enabling Images transformations; a quick audit that no paid binding or feature was introduced.
Acceptance: oversized or non image uploads are rejected; deleting an image removes the R2 object and all memberships; a keyboard only user can browse, open, and close the lightbox; rotating `JWT_SECRET` forces all sessions to re-authenticate; the deployed Worker uses only Free-plan services (Workers, R2, D1, Images transformations) and stays within their limits under normal use.

## 13. Definition of done

- All phases pass their acceptance criteria.
- The app runs entirely on the **Workers Free plan** with no paid bindings or add-ons.
- `wrangler deploy` produces a working live URL that behaves identically on a phone and a desktop.
- The gallery is reachable only after entering the shared password, and members stay logged in across reloads and days without re-prompting.
- On first run a member sets a display name (stored locally), and uploads, tags, and collections are attributed to that name, visible from any device.
- Upload, gallery browsing, collection creation, multi-collection tagging, untagged detection, and all three view modes function end to end against real R2 and D1.
- Variants are served through the Images binding with Cache API caching, keeping transformations within the free allowance.
- The app is installable as a PWA and usable one handed on a phone.
- README documents setup (creating the R2 bucket and D1 database, applying migrations, enabling Images transformations, generating and setting `GALLERY_PASSWORD_HASH` and `JWT_SECRET`, and deploying) and includes a **Constraints** section covering the Free-plan limits, with the 5,000 transformations per 30 days cap and its ~2,500 image ceiling stated explicitly.

## 14. Agent operating notes (put these in AGENTS.md)

- This app must stay on the Cloudflare Workers Free plan. Do not introduce Durable Objects, Queues, Cron Triggers, KV, Cloudflare Access, or any paid feature.
- Never resize images inside the Worker. Always offload to the Images binding reading the R2 stream. In-Worker WASM resizing would exceed the 10 ms Free CPU limit.
- Always cache transformed variants in the Cache API so repeat requests do not re-transform and burn the 5,000 per 30 days allowance.
- Prefer the Cloudflare docs markdown endpoints when checking platform behaviour (append `index.md` to a docs URL, or use the product `llms.txt`) rather than guessing binding APIs.
- Verify each phase with `wrangler dev` locally before deploying.
- Never commit secrets. `JWT_SECRET` and `GALLERY_PASSWORD_HASH` are set with `wrangler secret put` and referenced through `env`.
- The session token lives only in an httpOnly cookie. Never write it to localStorage or expose it to client JavaScript.
- The display name (`sg_display_name`, sent as `X-Gallery-User`) is attribution only, never authorization. Sanitize it server side, store it as `uploaded_by` / `added_by` / `created_by`, and never branch access decisions on it. Do not confuse it with the session cookie.
- Keep API and media routes registered before the static asset fallback, and run the session gate before all gated routes.
- Generate R2 keys server side; never derive a key from a user supplied filename. Stream originals; never buffer a whole file into memory.
- Keep read endpoints and mutation endpoints cleanly separated so a public read mode is a later config change, not a refactor.
- Commit at the end of every phase with a message naming the phase.

## 15. Explicit non goals

Do not build these unless asked in a later brief: authenticated user accounts, per user access control, or per user ownership of content (the app uses one shared password; the display name is soft attribution only, not an account and not an access boundary); per person login revocation or audit logs; sharing links with granular per collection permissions; image editing or filters; AI auto tagging; comments or social features; EXIF driven map or timeline views; video transcoding or server-side video thumbnail generation; or bulk import from third party services. Nested collections (folders inside folders) are out of scope; collections are a single flat level.
