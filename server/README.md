# Daddy's Pizza POS

A React + Express + SQLite restaurant operations app. The source prototype is kept in `ORIGINAL-prototype.html`; the rebuilt app lives in `client/` and `server/`.

## Requirements

- Node.js 20 or newer
- npm

## Run locally

1. Open a terminal in the project folder.
2. Copy `server/.env.example` to `server/.env`.
3. Change `JWT_SECRET` to a long random value and set a private `ADMIN_PASSWORD` (at least 8 characters).
4. Install packages and start both apps:

   ```bash
   npm install
   npm --prefix server install
   npm --prefix client install
   npm run dev
   ```

5. Open `http://localhost:5173` and sign in with the `ADMIN_USERNAME` and `ADMIN_PASSWORD` from `server/.env`.

The database is created automatically at `server/data/daddys-pizza.sqlite`. The first manager account and sample menu products are seeded the first time the API starts. Keep the database file and `.env` private. Do not commit them to source control.

## Production build

```bash
npm install
npm --prefix server install
npm --prefix client install
npm run build
NODE_ENV=production npm start
```

When running in production, serve the app over HTTPS, set a unique `JWT_SECRET`, a strong `ADMIN_PASSWORD`, and set `CLIENT_ORIGIN` to the deployed origin. The Express server serves the built React app from `client/dist`.

## Included workflows

- Role-based access for managers, workers and riders, enforced by API middleware.
- POS checkout that validates stock and records the order, customer and stock movements in one SQLite transaction.
- Cash, MTN MoMo, Telecel Cash, AT Money, card and bank transfer as recorded payment methods.
- Product management, stock adjustments, stock movement history and manager-approved stock requests.
- Sales history with CSV export, customer list, delivery assignment/status and team accounts.

**Payment limitation:** payment methods are recorded after staff confirm receipt. This app does not contact a mobile money provider, card processor or bank. A real payment integration requires provider credentials and a server-side integration.

**Initial login:** the example environment file uses `manager` / `ChangeMe123!` for local setup. Change the password before using real data or exposing the app to a network.
