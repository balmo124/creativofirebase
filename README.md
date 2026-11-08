# Creativo

A marketplace where clients book local photographers, videographers and event organizers.

- **Backend:** Node.js, Express, SQLite (better-sqlite3), JWT login, bcrypt password hashing
- **Frontend:** one static page in `public/index.html` that talks to the API

## Run it on your computer

```bash
npm install
npm run dev          # starts on http://localhost:3000 with test accounts
```

Test accounts (only created when `SEED_DEMO=1`, which `npm run dev` sets):

| Role     | Email           | Password   |
|----------|-----------------|------------|
| Client   | alex@demo.ph    | demo1234   |
| Provider | lumen@demo.ph   | demo1234   |

## Set up an admin account

Admin access is granted only to the account whose email matches the server's `ADMIN_EMAIL` setting. Start the server with that setting, then create an account using the same email in the app (or sign in if it already exists). After signing in, use **Admin panel** to see marketplace totals and browse people, provider profiles, and bookings. Admin data is read-only.

Signed-in clients and providers can use **Contact admin** to send a question or feedback. Messages appear in the admin dashboard's **Messages** tab, along with the sender's account email for follow-up.

When a provider accepts a booking, the client and provider can see each other's account email in that booking and use it to contact each other outside Creativo. Emails stay hidden while a booking is pending or declined. Provider profiles without a linked account email cannot share a contact email this way.

In PowerShell, for local development:

```powershell
$env:ADMIN_EMAIL = "your-email@example.com"
npm run dev
```

Keep the setting private to your server environment. Configure `ADMIN_EMAIL` in your production host's environment settings as well; do not rely on a client-side setting to grant admin access.

## Publish it

Any host that runs Node works (Render, Railway, Fly.io, a VPS).

1. Push this folder to a GitHub repository.
2. Create a new **Web Service** from the repo.
3. Build command: `npm install`  Start command: `npm start`
4. Set environment variables:
   - `JWT_SECRET`: a long random string (required in production)
   - `NODE_ENV`: `production`
   - `DB_PATH`: path on a **persistent disk**, for example `/data/creativo.db`
5. Attach a persistent disk mounted at `/data`. SQLite is a file, so without a disk your data resets on every deploy.

Do not set `SEED_DEMO` in production.

## API

| Method | Path                | Who            | What it does                         |
|--------|---------------------|----------------|--------------------------------------|
| POST   | /api/signup         | anyone         | Create a client or provider account  |
| POST   | /api/login          | anyone         | Sign in, returns a token             |
| GET    | /api/me             | signed in      | Current user                         |
| GET    | /api/providers      | anyone         | List all providers                   |
| GET    | /api/providers/:id  | anyone         | One provider                         |
| GET    | /api/bookings       | signed in      | Your bookings/requests; shares email only after acceptance |
| POST   | /api/bookings       | client         | Send a booking request               |
| PATCH  | /api/bookings/:id   | client/provider| Cancel (client) or accept/decline (provider) |
| POST   | /api/bookings/:id/review | client with an accepted booking | Submit one 1–5 star rating |
| GET    | /api/admin/overview | admin          | Marketplace counts and recent activity |
| GET    | /api/admin/:section | admin          | People, provider, booking, or message records |
| POST   | /api/messages       | signed in      | Send a message to the admin team |

Clients can submit one 1–5 star rating for each accepted booking from **My bookings**. The average and rating count appear on the creative’s listing and profile.

## Ideas for next steps

Provider profile editing, portfolio image uploads, written reviews, email notifications, and a move to PostgreSQL if you outgrow SQLite.
