# PENOKS Neighborhood Friends — Club Portal

A member portal with a public single-page site, member login/dashboard, a
membership application workflow, payment/expense submission, an admin
back-office, and a PostgreSQL-backed accounts ledger. Ships as three Docker
Compose services: `app` (Node/Express), `db` (PostgreSQL), and `backup`
(scheduled Google Drive backups + a Google Sheets export of the ledger).

## 1. What's inside

```
penoks-portal/
├── docker-compose.yml
├── .env.example              # copy to .env and fill in
├── db/init.sql               # schema, runs automatically on first boot
├── app/                       # the web app (Node/Express + EJS)
│   ├── server.js
│   ├── routes/                # auth.js, public.js, member.js, admin.js, contact.js
│   ├── utils/                  # ids.js, mailer.js
│   ├── views/                  # EJS: member dashboard/directory/ledger + admin pages
│   └── public/                # static site: home, about, contact, forms
└── backup/                    # scheduled Drive backup + Sheets export
    ├── index.js                # node-cron scheduler
    ├── scripts/db-backup.js    # pg_dump -> Google Drive
    ├── scripts/accounts-export.js  # accounts table -> Google Sheet
    └── credentials/            # put your service-account JSON key here
```

## 2. Quick start

```bash
cp .env.example .env
# edit .env: set DB_PASSWORD, JWT_SECRET, SEED_ADMIN_USERNAME/PASSWORD
# (GDRIVE_FOLDER_ID can be left blank until you've set up the service account)

docker compose up -d --build
```

The app will be available at `http://<your-server>:8350`. On first boot it:
- Creates the schema (`db/init.sql`) automatically inside the `db` container.
- Creates one admin account from `SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD`
  in `.env` — log in at `/admin/login.html` with those credentials.

**Change `SEED_ADMIN_PASSWORD` to something strong before your first deploy**,
and rotate it via a direct DB update if you ever need to (there's no
"forgot password" flow for admins by design — this is a small, trusted-admin
system; see §6 for how to add more admins or reset a password by hand).

## 3. Branding assets

- `app/public/assets/logo.png` — your PENOKS logo (already included).
- `app/public/assets/hero.jpg` — **placeholder** gradient/mountain image
  standing in for your real hero photo. Replace this file with an actual
  photo (same filename) for the homepage banner.
- Colors/fonts live in `app/public/css/style.css` (CSS variables at the top)
  if you want to adjust the palette.

## 4. How the workflow fits together

**New member application** (`member-apply.html`, public):
1. Visitor clicks "Apply" → the requirements PDF opens, then the form loads.
2. Six-step wizard (personal, contact, membership, references, declaration,
   review) submits to `/api/applicants` with the passport photo attached.
3. Row lands in the `applicants` table, `status = 'pending'`.
4. Admin reviews it under **Admin → Applicants**. Approving:
   - Generates a unique Member ID (`PNK-0001`, `PNK-0002`, …).
   - Creates the row in `members` with a random temporary password
     (shown once to the admin — relay it to the new member yourself; there's
     no email integration in this build).
   - Marks the applicant `approved` and links the new Member ID.

**Submit Payment / Submit Expenses** (public forms, no login required —
matches the "Member Number" field you specified):
1. Member fills in their name, Member Number, purpose, amount, and attaches
   a receipt or budget sheet.
2. Row lands in `payments` / `expenses` with `status = 'pending'`.
3. **The transaction does *not* affect the accounts balance until an admin
   reviews it.** Admin verifies a payment or approves an expense under
   **Admin → Payments / Expenses**, which:
   - Updates that record's status.
   - Inserts a matching `credit` (payment) or `debit` (expense) row into
     `accounts`.
   This is a deliberate design choice so the ledger only ever reflects
   reviewed transactions — let me know if you'd rather have submissions post
   to the ledger immediately and be reversed on rejection instead.

**Member dashboard** (`/dashboard`, login required, view-only):
Shows the member's profile, their own payment/expense history and statuses,
and their personal totals (sum of *their* verified payments / approved
expenses). Every logged-in member can also browse:
- **Member Directory** (`/members`) — every member's name, Member ID,
  status, and join date. View-only; no contact details are shown here by
  default (phone/email are visible only on the member's own profile and to
  admins) — easy to change if you'd rather show contact info to the whole
  membership.
- **Club Accounts** (`/club-accounts`) — the full club ledger (every posted
  payment and expense, club-wide totals and balance), same data as the
  admin ledger but read-only: no verify/approve/reject controls are exposed
  on these member-facing pages, and the underlying API routes only support
  `GET`.

**Contact form** (`/contact.html`): posts to `/api/contact`, which sends a
real email via SMTP (Nodemailer) to `CONTACT_TO_EMAIL`, with the sender's
address set as Reply-To so you can respond directly. See §5b for setup.

**Admin back office** (`/admin/dashboard`, login required):
Applicants, Members (activate/suspend), Payments, Expenses, and the full
Accounts Ledger with running totals.

## 5. Contact form email (SMTP)

The contact form on `/contact.html` sends a real email — no CRM or
third-party form service needed. Set these in `.env`:

```
SMTP_HOST=smtp.yourprovider.com
SMTP_PORT=587
SMTP_SECURE=false          # true only if using port 465
SMTP_USER=your_smtp_username
SMTP_PASSWORD=your_smtp_password
CONTACT_FROM_EMAIL=no-reply@penoksa.me
CONTACT_TO_EMAIL=contact@penoksa.me
```

Works with any standard SMTP provider — Gmail (with an
[App Password](https://support.google.com/accounts/answer/185833)),
SendGrid, Mailgun, Amazon SES, or your own mail server. If SMTP isn't
configured, the form shows a friendly error instead of crashing the app.
This was tested end-to-end against a local SMTP server during development
and confirmed to deliver a correctly formatted email with the submitter's
address set as Reply-To.

## 6. Google Drive / Sheets backups

Two scheduled jobs run inside the `backup` container:

| Job | Default schedule | What it does |
|---|---|---|
| DB backup | `0 2 * * *` (2am daily) | `pg_dump` (custom format) uploaded to Drive |
| Accounts export | `0 3 * * *` (3am daily) | Reads the `accounts` table, builds a spreadsheet with `exceljs`, uploads it converted to a native Google Sheet |

Schedules are 5-field cron expressions, set via `DB_BACKUP_CRON` and
`ACCOUNTS_EXPORT_CRON` in `.env`. They're evaluated using the container's
system time zone (UTC by default).

**Setup:**
1. In [Google Cloud Console](https://console.cloud.google.com), create/select
   a project and enable the **Google Drive API**.
2. Create a **Service Account**, then create a JSON key for it.
3. Save that key as `backup/credentials/gdrive_service_account.json`
   (never commit this file — it's already in `.gitignore`).
4. In Google Drive, create a folder for backups and **share it** with the
   service account's `client_email` (found inside the JSON key) as an
   **Editor**.
5. Copy that folder's ID (from its URL) into `GDRIVE_FOLDER_ID` in `.env`.
6. `docker compose up -d --build backup` to pick up the new env/credentials.

If `GDRIVE_FOLDER_ID` is left blank, both jobs still run and write their
output into the `backup_tmp` Docker volume, but skip the upload step (logged
clearly) — useful for testing before you've set up the service account.

To run a job immediately instead of waiting for the schedule:
```bash
docker compose exec backup node scripts/db-backup.js
docker compose exec backup node scripts/accounts-export.js
```

## 7. Operational notes

- **Adding another admin / resetting an admin password** (no UI for this yet):
  ```bash
  docker compose exec db psql -U <DB_USER> -d <DB_NAME>
  -- generate a bcrypt hash first, e.g. with:
  -- docker compose exec app node -e "console.log(require('bcryptjs').hashSync('newpassword',10))"
  INSERT INTO admins (username, password_hash, full_name, role)
  VALUES ('newadmin', '<bcrypt-hash>', 'New Admin', 'admin');
  ```
- **Uploads** (passport photos, receipts, budget sheets) live in the
  `uploads_data` Docker volume, mounted at `/app/uploads` in the `app`
  container — this is what gets swept up by the DB backup's referenced
  files if you extend the backup script to also archive `/app/uploads`
  (the current backup only dumps the database itself, not the uploaded
  files — let me know if you'd like the Drive backup to include them too).
- **HTTPS**: this compose file exposes the app on plain HTTP (`:3000`). Put
  Nginx, Caddy, or a cloud load balancer with a TLS certificate in front of
  it for production, and set `COOKIE_SECURE=true` in `.env` once you're
  serving over HTTPS (otherwise login cookies won't be sent correctly).
- **Ports**: Postgres is bound to `127.0.0.1:5432` only (not exposed
  publicly) — connect to it from the host via `psql -h 127.0.0.1 ...` if
  needed, or `docker compose exec db psql -U <user> <db>`.

## 8. Assumptions made while building this

- Payments/expenses require admin review before touching the ledger balance
  (see §4) — flag if you want immediate posting instead.
- No email system is wired up; the admin communicates new Member IDs and
  temporary passwords manually after approving an application.
- The "cron jobs" you asked for run via an in-process scheduler
  (`node-cron`) inside the long-lived `backup` container rather than the
  server's OS crontab — functionally the same result, but simpler to keep
  portable across any Ubuntu host. If you'd specifically like real OS-level
  cron entries instead (e.g. to survive independently of Docker), that's a
  straightforward swap.
- Contact form (`contact.html`) now sends a real email via SMTP — see §5.
- Members see a read-only directory of other members' names/status/join
  date (not phone/email) and the full club accounts ledger — say the word
  if you'd rather show contact details in the directory too, or restrict
  the ledger to summary totals only instead of the full transaction list.
