# O-Budget

Personal finance PWA: enter your income, enter your daily expenses, see where your money goes, how much is left, and how much you save. French UI, euros, mobile-first, deployed on Cloudflare's free tier.

## Architecture

One Cloudflare Worker serves everything:

- **Frontend**: React 19 + TypeScript + Tailwind CSS 4, built by Vite, served as static assets.
- **API**: [Hono](https://hono.dev) on the same Worker under `/api/*`.
- **Database**: Cloudflare D1 (managed SQLite). Chosen because it is native to Workers, relational (proper foreign keys and transactions), free for personal use, and needs no separate server.
- **Auth**: email + password, implemented in the Worker. Passwords are hashed with PBKDF2-SHA256 (100 000 iterations, the Workers maximum) and a random salt. Sessions are random 256-bit tokens in an `HttpOnly`, `Secure`, `SameSite=Lax` cookie; only their SHA-256 hash is stored. Mutating requests from another origin are rejected (CSRF). Failed logins are throttled (10 per email / 30 per IP per 15 min).
- **Validation**: the same Zod schemas (`shared/schemas.ts`) run in the browser and on the server.
- **PWA**: `public/manifest.webmanifest` + a small hand-written service worker (`public/sw.js`): app shell cached for fast/offline opening, financial data network-first with the last copy readable offline. Auth and exports are never cached; the data cache is cleared on logout.

No paid service is required. Same-origin frontend and API means no CORS and no secrets in frontend code.

### Money and calculations

All amounts are stored as **integer cents** (no floating-point rounding). Formulas live in `shared/finance.ts` and are unit-tested:

- Total income = sum of the month's income records
- Total expenses = sum of every category amount of the month's expense entries
- **Remaining = Income − Expenses** (savings are *not* subtracted again)
- Savings rate = Savings / Income × 100
- Category % = Category / Total expenses × 100

Default income (Alternance 1 202 €, Freelance 500 €) is **never assumed**. A month has no income until you either type the real amounts or tap "Appliquer les montants habituels", which *copies* the defaults into that month. Changing a default later never touches existing months.

### Database schema (`migrations/`)

```
users ─┬─ sessions
       ├─ user_settings            (default income, theme, currency = EUR)
       ├─ payment_methods          (CIH Bank, LCL, Revolut + your own)
       └─ financial_periods        (one per month, e.g. 2026-10)
             ├─ incomes            (alternance | freelance | other, label, amount)
             ├─ savings            (one amount per month)
             └─ expense_entries    (date, France+city or country, payment, description)
                   └─ expense_amounts (one row per category: the 10 fixed categories)
```

Child tables reference `(period_id, user_id)` together, so a row can never point to another user's month. Every query also filters on the session's `user_id`.

## Project structure

```
migrations/          D1 SQL migrations
shared/              Code used by both client and Worker (categories, money, months, finance, schemas, types)
worker/              Hono API (auth, months/incomes/savings/analysis, expenses, settings, export)
src/                 React app (pages, components, hooks, API client)
public/              Manifest, service worker, icons, cache headers
scripts/             API test scenarios, password reset, icon generator
tests/               Unit tests (finance, money parsing, validation)
```

## Run it locally

Requirements: [Node.js](https://nodejs.org) 20 or newer.

```bash
npm install
npm run db:migrate:local      # creates the local database
npm run dev                   # http://localhost:5173
```

Open the URL, create your account, done. The local database lives in `.wrangler/` and is separate from production.

## Deploy to Cloudflare (step by step)

You need a free Cloudflare account.

1. **Log in from the terminal**
   ```bash
   npx wrangler login
   ```
2. **Create the database**
   ```bash
   npx wrangler d1 create o-budget
   ```
   Copy the `database_id` it prints into `wrangler.jsonc`, replacing `00000000-0000-0000-0000-000000000000`.
3. **Create the tables in production**
   ```bash
   npm run db:migrate:remote
   ```
4. **Build and deploy**
   ```bash
   npm run deploy
   ```
   Wrangler prints your URL, e.g. `https://o-budget.<your-subdomain>.workers.dev`. HTTPS is automatic.
5. **Create your account** on that URL.
6. **Close sign-ups** (recommended, since this is a personal app): in `wrangler.jsonc` set `"ALLOW_SIGNUP": "false"`, then `npm run deploy` again.

Optional: add your own domain in the Cloudflare dashboard → Workers & Pages → o-budget → Settings → Domains & Routes.

### Configuration

| Variable | Where | Purpose |
|---|---|---|
| `DB` | `wrangler.jsonc` → `d1_databases` | D1 binding (set the `database_id`) |
| `ALLOW_SIGNUP` | `wrangler.jsonc` → `vars` | `"false"` blocks new accounts |

There are no other secrets: the app needs no API keys. For local overrides, copy `.dev.vars.example` to `.dev.vars`.

### Install on your phone

Open the deployed URL in Safari (iPhone) → Share → "Sur l'écran d'accueil", or in Chrome (Android) → menu → "Installer l'application". It opens full screen like a native app.

## Forgotten password

Sending reset emails would require a third-party email service, so O-Budget resets passwords from the computer you deploy from instead (free, and only someone with access to your Cloudflare account can do it):

```bash
npm run reset-password -- you@example.com            # production
npm run reset-password -- you@example.com --local    # local dev database
```

You are asked for the new password (hidden input). All sessions of that account are signed out. When logged in, you can also change your password in Paramètres → Profil.

## Testing

```bash
npm run typecheck     # strict TypeScript for client, Worker and shared code
npm test              # unit tests: formulas, amount parsing, validation
npm run dev           # in one terminal, then in another:
npm run test:api      # end-to-end API scenarios against the running app
```

`test:api` covers registration, login, empty October with no assumed income, October income (300 + 500 + 150 adjustment), a multi-category Paris expense, Montpellier, another French city, Morocco without a city, validation errors, double-submit protection, edit, delete, totals/remaining/savings rate, November via defaults, comparison, changing defaults without altering history, CSV/Excel export, cross-user isolation, CSRF rejection, login throttling, data deletion and logout.

Manual checks for the rest (mobile layout, dark mode, PWA install): Chrome DevTools device mode at 360/375/390/412 px; Paramètres → Apparence; DevTools → Application → Manifest.

## Exports

Paramètres → Données: expenses (Date, Lieu, Pays, Catégorie, Montant, Moyen de paiement, Description; one line per category amount) and income + savings, each as standard CSV (comma, dot decimals) or Excel-compatible CSV (semicolon, comma decimals, UTF-8 BOM so accents display correctly).

## Notes and limitations

- **Offline**: you can open the app and read the last loaded data offline; adding or editing requires a connection (a friendly French error appears). Offline queuing was left out to keep the app simple and avoid sync conflicts.
- **PBKDF2 at 100 000 iterations** is the maximum Cloudflare Workers allows; bcrypt/argon2 are not available natively there.
- Transfers between your own accounts should simply not be entered as expenses; there is deliberately no transfer category.

## Possible future improvements (not implemented, by design)

- A monthly spending goal per category.
- Duplicating a frequent expense in one tap.
- Email-based password reset (would need a provider such as Resend's free tier).
- Offline entry queue with background sync.
