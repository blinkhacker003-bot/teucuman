#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root: sudo bash scripts/bootstrap-ubuntu.sh" >&2
  exit 1
fi

PROJECT_DIR="${PROJECT_DIR:-/var/www/teucuman}"
DOMAIN="${DOMAIN:-}"

if [[ ! -f "${PROJECT_DIR}/package.json" || ! -f "${PROJECT_DIR}/src/app.js" ]]; then
  echo "Project not found at ${PROJECT_DIR}. Clone this repository there first." >&2
  exit 1
fi

if [[ -z "${DOMAIN}" ]]; then
  read -r -p "Public game domain (e.g. game.example.com): " DOMAIN
fi

if [[ ! "${DOMAIN}" =~ ^[A-Za-z0-9.-]+$ ]]; then
  echo "Invalid domain name." >&2
  exit 1
fi

echo "[1/9] Installing required Ubuntu packages..."
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y nodejs npm postgresql nginx certbot python3-certbot-nginx curl openssl acl

if ! node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 18 ? 0 : 1)"; then
  echo "Installing Node.js 20 LTS..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

node -e "if (Number(process.versions.node.split('.')[0]) < 18) process.exit(1)"

systemctl enable --now postgresql
systemctl enable --now nginx

echo "[2/9] Creating dedicated PostgreSQL role and database..."
DB_NAME="teucuman"
DB_USER="teucuman_app"
DB_PASS="$(openssl rand -hex 32)"

ROLE_EXISTS="$(runuser -u postgres -- psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='teucuman_app'")"
DB_EXISTS="$(runuser -u postgres -- psql -tAc "SELECT 1 FROM pg_database WHERE datname='teucuman'")"

if [[ "${ROLE_EXISTS}" == "1" || "${DB_EXISTS}" == "1" ]]; then
  echo "Database role or database already exists. Refusing to overwrite existing PostgreSQL data." >&2
  exit 1
fi

runuser -u postgres -- psql -v ON_ERROR_STOP=1 -v db_user="${DB_USER}" -v db_pass="${DB_PASS}" -v db_name="${DB_NAME}" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'db_user', :'db_pass') \gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'db_name', :'db_user') \gexec
SQL

echo "[3/9] Creating the restricted service account and environment file..."
if ! id teucuman >/dev/null 2>&1; then
  useradd --system --home "${PROJECT_DIR}" --shell /usr/sbin/nologin teucuman
fi

PP_ASSETS_ROOT=""
if [[ -d /var/www/ppcode/public ]]; then
  PP_ASSETS_ROOT="/var/www/ppcode/public"
  setfacl -m u:teucuman:--x /var/www/ppcode
  setfacl -R -m u:teucuman:rX "${PP_ASSETS_ROOT}"
  find "${PP_ASSETS_ROOT}" -type d -exec setfacl -m d:u:teucuman:rX {} \;
fi

install -d -o root -g teucuman -m 750 /etc/teucuman
cat > /etc/teucuman/teucuman.env <<EOF
NODE_ENV=production
HOST=127.0.0.1
PORT=3000
TRUST_PROXY=true
PUBLIC_BASE_URL=https://${DOMAIN}
CORS_ORIGINS=https://${DOMAIN}
DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=${DB_NAME}
DB_USER=${DB_USER}
DB_PASS=${DB_PASS}
DB_SSL=false
DB_POOL_MAX=10
DEFAULT_BALANCE=50000
PP_ASSETS_ROOT=${PP_ASSETS_ROOT}
PRAGMATIC_DEMO_ORIGIN=https://demogamesfree.pragmaticplay.net
PROVIDER_TIMEOUT_MS=20000
EOF
chown root:teucuman /etc/teucuman/teucuman.env
chmod 640 /etc/teucuman/teucuman.env

echo "[4/9] Installing Node dependencies..."
cd "${PROJECT_DIR}"
npm install --omit=dev

echo "[5/9] Running the idempotent PostgreSQL migration..."
set -a
# shellcheck disable=SC1091
source /etc/teucuman/teucuman.env
set +a
npm run db:migrate

echo "[6/9] Installing the systemd service..."
install -m 644 deploy/teucuman.service /etc/systemd/system/teucuman.service
systemctl daemon-reload
systemctl enable teucuman

echo "[7/9] Installing a separate Nginx virtual host..."
if [[ -e /etc/nginx/sites-available/teucuman || -e /etc/nginx/sites-enabled/teucuman ]]; then
  echo "An Nginx site named teucuman already exists. Refusing to overwrite it." >&2
  exit 1
fi

sed "s/game.example.com/${DOMAIN}/g" deploy/nginx.conf > /etc/nginx/sites-available/teucuman
ln -s /etc/nginx/sites-available/teucuman /etc/nginx/sites-enabled/teucuman
nginx -t
systemctl reload nginx

echo "[8/9] Starting the application..."
systemctl restart teucuman
systemctl is-active --quiet teucuman

echo "[9/9] Running the local HTTP smoke test..."
BASE_URL="http://127.0.0.1:3000" bash scripts/smoke-test.sh

echo
echo "Bootstrap completed."
echo "Next, point DNS for ${DOMAIN} to this server, then run:"
echo "  certbot --nginx -d ${DOMAIN}"
echo "After TLS is issued, run:"
echo "  systemctl restart teucuman"
echo "Private DB credentials are stored in /etc/teucuman/teucuman.env (root:teucuman, mode 640)."
