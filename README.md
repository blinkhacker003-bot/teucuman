# Teucuman — Sweet Bonanza 1000 Demo Server

A standalone Node.js/Express server for the bundled Sweet Bonanza 1000 demo and optional PPCode HTML5 game catalog. PostgreSQL stores isolated local and upstream demo sessions.

> **Important:** This repository is a demo/test implementation. The game server cycles through prerecorded response fixtures in `games/sb/responses/index.json`; it is not the official Pragmatic Play game engine, does not connect to a licensed provider, and is not suitable for real-money play or production wallet settlement. The bundled frontend/assets may be subject to third-party intellectual-property and distribution rights. Deploy them only if you have permission.

## What is included

- Express server on `HOST:PORT` (default `127.0.0.1:3000`)
- Game assets served from `public/gs2c/`
- HTML5 game page served at `/gs2c/html5Game.html`
- Per-page session key generation and replacement of the previous Railway origin
- PostgreSQL-backed demo balances and spin/collect counters
- Idempotent database migration: `npm run db:migrate`
- Health endpoint: `GET /healthz`

## Add the PPCode game catalog

The private `blinkhacker003-bot/ppcode` repository contains **38 Pragmatic Play HTML5 frontend packages** under `public/<symbol>/` (about **5.0 GB** in total). Teucuman serves these files directly from a separate PPCode checkout instead of copying several gigabytes into this repository.

1. Check out PPCode beside Teucuman using your own authorized GitHub credentials:

   ```bash
   sudo git clone https://github.com/blinkhacker003-bot/ppcode.git /var/www/ppcode
   ```

   If it is already present at `/var/www/ppcode`, do not clone it again.

2. Set this in Teucuman's private environment file (for example `/etc/teucuman/teucuman.env`):

   ```dotenv
   PP_ASSETS_ROOT=/var/www/ppcode/public
   PRAGMATIC_DEMO_ORIGIN=https://demogamesfree.pragmaticplay.net
   PROVIDER_TIMEOUT_MS=20000
   ```

3. Allow the Teucuman service account to read the PPCode assets. On Ubuntu, install ACL support if needed, then grant read/traverse access without changing file ownership:

   ```bash
   sudo apt-get install -y acl
   sudo setfacl -R -m u:teucuman:rX /var/www/ppcode/public
   sudo find /var/www/ppcode/public -type d -exec setfacl -m d:u:teucuman:rX {} \\;
   ```

4. Apply the migration and restart Teucuman:

   ```bash
   cd /var/www/teucuman
   npm run db:migrate
   sudo systemctl restart teucuman
   ```

Open the Teucuman home page to see the discovered game catalog, or open a game directly at `/play/<symbol>` (for example `/play/vs20sugarrush`). The wrapper is rendered by Node, and the original `public/<symbol>/` assets are served from PPCode. The browser-visible session key is mapped to a separate upstream demo session in PostgreSQL.

If PPCode is stored at another path, change `PP_ASSETS_ROOT` to its `public` directory. Do not make the private PPCode checkout world-readable or put GitHub credentials in the Teucuman repository.

## Quick Ubuntu bootstrap

For a fresh Ubuntu host, clone the repository to the service path:

```bash
sudo git clone --branch main https://github.com/blinkhacker003-bot/teucuman.git /var/www/teucuman
cd /var/www/teucuman
sudo DOMAIN=game.example.com bash scripts/bootstrap-ubuntu.sh
```

The bootstrap script installs Node.js 20 when the distro package is too old, PostgreSQL, Nginx and Certbot; creates a dedicated PostgreSQL database and restricted Linux service account; writes a private environment file; runs the migration; and adds a new Nginx site named `teucuman`. It refuses to overwrite an existing database role/database or Nginx site with those names. It does not modify other Nginx virtual hosts.

After DNS for the domain points to this server, issue TLS:

```bash
sudo certbot --nginx -d game.example.com
sudo systemctl restart teucuman
BASE_URL=https://game.example.com bash scripts/smoke-test.sh
```

Replace `game.example.com` with the domain you control. Do not run the bootstrap script on a server where the `teucuman` PostgreSQL role/database or Nginx site already belongs to another application.

## Requirements

- Linux server (Ubuntu 22.04/24.04 recommended)
- Node.js 18 or newer
- PostgreSQL 13 or newer
- Nginx (recommended reverse proxy)

## 1. Install dependencies

From the repository root:

```bash
node --version
npm --version
```

Node must be v18 or newer. Install application dependencies:

```bash
npm install --omit=dev
```

## 2. Create an isolated PostgreSQL database

Do not point this demo at an unrelated application database. Create a dedicated role and database:

```bash
sudo -u postgres psql
```

At the PostgreSQL prompt, replace the password with a long random value and run:

```sql
CREATE ROLE teucuman_app LOGIN PASSWORD 'REPLACE_WITH_A_LONG_RANDOM_PASSWORD';
CREATE DATABASE teucuman OWNER teucuman_app;
\q
```

The migration creates only the `sessions` table and its supporting index in this dedicated database.

## 3. Configure environment

```bash
cp .env.example .env
nano .env
```

Set at minimum:

- `PUBLIC_BASE_URL`: the public HTTPS origin for this app, e.g. `https://game.example.com`
- `CORS_ORIGINS`: the same origin unless a separate trusted frontend is required
- `DB_PASS`: the PostgreSQL role password created above

Keep `.env` private:

```bash
chmod 600 .env
```

Do not commit `.env` to Git.

## 4. Create the database schema and run

```bash
npm run db:migrate
npm start
```

The server exits if PostgreSQL is unavailable. In another terminal:

```bash
curl -i http://127.0.0.1:3000/healthz
curl -I http://127.0.0.1:3000/gs2c/common/js/html5-script-external.js
```

Open `http://127.0.0.1:3000/` and select the demo game.

## 5. Run under systemd

Create a dedicated service account and private environment file:

```bash
sudo useradd --system --home /var/www/teucuman --shell /usr/sbin/nologin teucuman
sudo install -d -o root -g teucuman -m 750 /etc/teucuman
sudo install -o root -g teucuman -m 640 .env /etc/teucuman/teucuman.env
```

Install the service unit:

```bash
sudo cp deploy/teucuman.service /etc/systemd/system/teucuman.service
sudo systemctl daemon-reload
sudo systemctl enable --now teucuman
sudo systemctl status teucuman --no-pager
sudo journalctl -u teucuman -n 100 --no-pager
```

The unit expects the project at `/var/www/teucuman`. If your checkout is elsewhere, update `WorkingDirectory` and `ExecStart` in the unit before enabling it.

## 6. Nginx reverse proxy

Copy `deploy/nginx.conf` to a new Nginx site file and replace `game.example.com` with your domain:

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/teucuman
sudo nano /etc/nginx/sites-available/teucuman
sudo ln -s /etc/nginx/sites-available/teucuman /etc/nginx/sites-enabled/teucuman
sudo nginx -t
sudo systemctl reload nginx
```

This creates a separate site and does not require changing other virtual hosts. Configure DNS to point the domain to this server. After DNS resolves, issue TLS using Certbot:

```bash
sudo certbot --nginx -d game.example.com
```

Then set `PUBLIC_BASE_URL=https://game.example.com` and `CORS_ORIGINS=https://game.example.com` in `/etc/teucuman/teucuman.env`, and restart:

```bash
sudo systemctl restart teucuman
```

## 7. Smoke test

```bash
BASE_URL=https://game.example.com bash scripts/smoke-test.sh
```

The test checks the health endpoint, game page, local game loader asset, and verifies the generated page no longer references the previous Railway host.

## Game protocol endpoints

- `GET /gs2c/html5Game.html`
- `POST /api/slots/gs2c_/gameService`
- `GET /api/slots/gs2c/reloadBalance.do`
- `POST /api/slots/gs2c/saveSettings.do`
- `GET /healthz`

## Limitations and production boundary

- Spin outcomes are prerecorded fixtures, not random outcomes from a certified game engine.
- The demo balance is not connected to a player account, cashier, payment provider, or wallet ledger.
- The app does not implement operator authentication, player authentication, responsible-gaming controls, audit-grade transaction settlement, or provider certification.
- Compatibility endpoints for jackpot, announcements, regulation, and telemetry are stubs.
- Do not expose this demo as a real-money casino service. A licensed provider integration and a separately reviewed wallet/ledger architecture are required for that use.
