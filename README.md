# Creativo

A marketplace where clients book local photographers, videographers and event organizers.

- **Backend:** Node.js, Express, Firebase Firestore, JWT login, bcrypt password hashing
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

Admin access is granted only to the account whose email matches the server's `ADMIN_EMAIL` setting and provides the secret `ADMIN_SIGNUP_CODE`. On the sign-up form, select **Admin**, use that exact email, and enter the six-digit code. The server rejects admin sign-ups with another email or an incorrect code; selecting Admin alone does not grant access. If that email already has an account, sign in to that account. After signing in, use **Admin panel** to see marketplace totals and browse people, provider profiles, and bookings. Admin data is read-only.

Signed-in clients and providers can use **Contact admin** to send a question or feedback. Messages appear in the admin dashboard's **Messages** tab, along with the sender's account email for follow-up.

When a provider accepts a booking, the client and provider can see each other's account email in that booking and use it to contact each other outside Creativo. Emails stay hidden while a booking is pending or declined. Provider profiles without a linked account email cannot share a contact email this way.

For local development, put `ADMIN_EMAIL` in the ignored `.env` file described below, then run:

```powershell
npm run dev
```

Do not rely on a client-side setting to grant admin access.

## Set up Firebase Firestore

1. Create a Firebase project and create a **Cloud Firestore** database in the Firebase console.
2. In Google Cloud IAM, create a service account for the server and generate a private key. Keep the downloaded JSON private; never commit it to GitHub or put it in `public`.
3. Configure these environment variables on the server:
   - `FIREBASE_PROJECT_ID`: your Firebase project ID
   - `FIREBASE_SERVICE_ACCOUNT_JSON`: the full contents of the service-account JSON file
   - `JWT_SECRET`: a long random string (required in production)
   - `ADMIN_EMAIL`: the email address that should have admin access
   - `ADMIN_SIGNUP_CODE`: a secret six-digit admin registration code
   - `NODE_ENV`: `production`
4. For local development, download a service-account JSON file and keep it outside this project. Create a `.env` file in the project root (it is ignored by Git) with:

   ```env
   FIREBASE_PROJECT_ID=your-project-id
   GOOGLE_APPLICATION_CREDENTIALS=C:\path\outside\project\service-account.json
   JWT_SECRET=your-own-long-random-secret
   ADMIN_EMAIL=your-admin-email
   ADMIN_SIGNUP_CODE=your-six-digit-code
   ```

   Replace the example values with your own, then run `npm run dev`. Never commit or share the service-account file or its contents.

The server uses the Firebase Admin SDK, so Firestore security rules do not limit server access. Protect the service-account key and keep authorization checks in the server. New users, provider listings, bookings, support messages, and ratings are stored in Firestore. Seed provider listings are created automatically when the providers collection is empty.

The previous SQLite file is not migrated or uploaded. This project starts with a fresh Firestore database.

## Publish it

Any host that runs Node works (Render, Railway, Fly.io, a VPS).

1. Push this folder to a GitHub repository.
2. Create a new **Web Service** from the repo.
3. Build command: `npm install`  Start command: `npm start`
4. Set the Firebase and app environment variables described above, and set `NODE_ENV` to `production`.
5. Deploy. The database is hosted by Firestore, so a Render disk is not needed for app data.

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

Provider profile editing, portfolio image uploads, written reviews, and email notifications.
