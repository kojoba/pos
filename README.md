# Daddy's Pizza POS

A multi-file restaurant management rebuild using React, Express and SQLite. The application source is split between `client/` and `server/`; the original one-file prototype is preserved under `reference/` but is not used by the rebuilt app.

## Start locally

1. Copy `server/.env.example` to `server/.env`.
2. Set a private `ADMIN_PASSWORD` and a unique `JWT_SECRET` in `server/.env`.
3. From this folder, install and start:

   ```bash
   npm install
   npm --prefix server install
   npm --prefix client install
   npm run dev
   ```

4. Open `http://localhost:5173` and sign in with the `ADMIN_USERNAME` and `ADMIN_PASSWORD` from `server/.env`.

The database is created at `server/data/daddys-pizza.sqlite` when the API first starts. Local demo login values in `.env.example` must be changed before real use or network exposure.

See [`server/README.md`](server/README.md) for production notes, workflows and the payment limitation.

## Main folders

- `client/src/pages/` — React screens for overview, POS, inventory, sales, customers, deliveries and team accounts.
- `client/src/components/` — shared page, modal, notification and metric components.
- `server/src/routes/` — separate API modules for authentication, products, orders, stock, users, deliveries, dashboard and customers.
- `server/src/db.js` — SQLite schema and first-run seed data.
