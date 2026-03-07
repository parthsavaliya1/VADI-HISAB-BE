# VADI-HISAB Backend

Express API for the VADI Hisaab farmer app. Uses **PostgreSQL** (via Sequelize).

## Setup

1. **PostgreSQL**: Create a database (e.g. `vadi_hisab`).

2. **Env**: Copy `.env.example` to `.env` and set:
   - `DATABASE_URL` or `PG_URI`: e.g. `postgresql://user:password@localhost:5432/vadi_hisab`
   - `JWT_SECRET`: min 32 characters
   - `TWO_FACTOR_API_KEY`: for OTP (2Factor.in)

3. **Install & run**:
   ```bash
   npm install
   npm run dev
   ```
   Tables are created/updated automatically on startup (`sequelize.sync({ alter: true })`).

## API (unchanged from before)

- `POST /api/auth/send-otp` — send OTP
- `POST /api/auth/verify-otp` — verify OTP, returns `token`, `isProfileCompleted`, `consentGiven`
- `GET /api/auth/me` — current user (Bearer token)
- `POST /api/profile/complete` — first-time profile (sets `isProfileCompleted: true`)
- `GET /api/profile/me`, `PUT /api/profile/update`
- `GET/POST/PUT/PATCH/DELETE /api/crops` — crops (year defaults to current year)
- `PATCH /api/crops/:id/harvest` — mark harvested; when you **sell**, add income via `POST /api/income` with `category: "Crop Sale"` and `cropId`
- `GET/POST /api/income`, `GET/POST /api/expenses`, `GET/POST /api/service-ledger`

## Crop → Income flow

1. **Add crop** (year = current year by default).
2. **Harvest**: `PATCH /api/crops/:id/harvest` → status becomes `Harvested`.
3. **Sell**: `POST /api/income` with `category: "Crop Sale"`, `cropId`, and `cropSale: { quantitySold, pricePerUnit, ... }` → amount is added to income.

All responses keep the same shape as before (including `_id` for app compatibility).
