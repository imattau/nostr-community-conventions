#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

INSTALL_DIR_DEFAULT="/opt/ncc-sidecar"
DATA_DIR_DEFAULT="/var/lib/ncc-sidecar"
SERVICE_NAME_DEFAULT="ncc-sidecar"
SERVICE_USER_DEFAULT="ncc-sidecar"
ALLOW_REMOTE=false

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Options:
  --install-dir DIR     Where to deploy the code (default: $INSTALL_DIR_DEFAULT)
  --data-dir DIR        Where to keep runtime data like sidecar.db (default: $DATA_DIR_DEFAULT)
  --service-name NAME   systemd unit name (default: $SERVICE_NAME_DEFAULT)
  --service-user USER   Linux user that runs the sidecar (default: $SERVICE_USER_DEFAULT)
  --repo-source URL     Git URL or path to the source repo (default: current checkout)
  --allow-remote        Enable remote admin access (sets NCC_SIDECAR_ALLOW_REMOTE=true)
  --help                Show this message
EOF
  exit 1
}

INSTALL_DIR="$INSTALL_DIR_DEFAULT"
DATA_DIR="$DATA_DIR_DEFAULT"
SERVICE_NAME="$SERVICE_NAME_DEFAULT"
SERVICE_USER="$SERVICE_USER_DEFAULT"

while (( "$#" )); do
  case "$1" in
    --install-dir) INSTALL_DIR="$2"; shift 2;;
    --data-dir) DATA_DIR="$2"; shift 2;;
    --service-name) SERVICE_NAME="$2"; shift 2;;
    --service-user) SERVICE_USER="$2"; shift 2;;
    --repo-source) REPO_SOURCE="$2"; shift 2;;
    --allow-remote) ALLOW_REMOTE=true; shift;;
    -h|--help) usage;;
    *)
      echo "Unknown option: $1"
      usage
      ;;
  esac
done

if [ -z "${REPO_SOURCE:-}" ]; then
  REPO_SOURCE="$DEFAULT_REPO_ROOT"
fi

if [ "$(id -u)" -ne 0 ]; then
  echo "Please run this script as root."
  exit 1
fi

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Required command '$1' is missing."
    exit 1
  fi
}

require_cmd node
require_cmd npm
require_cmd rsync
require_cmd systemctl

SOURCE_DIR=""
TEMP_SOURCE=""

setup_source() {
  if [ -d "$REPO_SOURCE" ]; then
    SOURCE_DIR="$REPO_SOURCE"
    return
  fi
  require_cmd git
  TEMP_SOURCE="$(mktemp -d /tmp/ncc-sidecar-install-XXXX)"
  echo "Cloning source from $REPO_SOURCE..."
  git clone --depth 1 "$REPO_SOURCE" "$TEMP_SOURCE"
  SOURCE_DIR="$TEMP_SOURCE"
}

cleanup_source() {
  if [ -n "$TEMP_SOURCE" ] && [ -d "$TEMP_SOURCE" ]; then
    rm -rf "$TEMP_SOURCE"
  fi
}

trap cleanup_source EXIT

SERVICE_GROUP="$SERVICE_USER"
SYSTEMD_UNIT_PATH="/etc/systemd/system/${SERVICE_NAME}.service"
NODE_BIN="$(command -v node)"
NPM_BIN="$(command -v npm)"

ensure_user() {
  if id "$SERVICE_USER" >/dev/null 2>&1; then
    echo "Service user $SERVICE_USER already exists."
  else
    useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
  fi
}

run_as_service() {
  local cmd="$1"
  if command -v runuser >/dev/null 2>&1; then
    runuser -l "$SERVICE_USER" -c "$cmd"
  else
    su -s /bin/bash "$SERVICE_USER" -c "$cmd"
  fi
}

echo "Installing NCC-06 Sidecar under $INSTALL_DIR"

setup_source
ensure_user

mkdir -p "$INSTALL_DIR"
mkdir -p "$DATA_DIR"
chown "$SERVICE_USER:$SERVICE_GROUP" "$DATA_DIR"

echo "Syncing repository files..."
rsync -a --delete \
  --exclude 'node_modules' \
  --exclude 'sidecar.db' \
  --exclude '.git' \
  --exclude '.gitignore' \
  --exclude 'npm-debug.log' \
  --exclude 'certs' \
  "$SOURCE_DIR/" "$INSTALL_DIR/"

mkdir -p "$INSTALL_DIR/certs"
chown -R "$SERVICE_USER:$SERVICE_GROUP" "$INSTALL_DIR"

touch "$DATA_DIR/sidecar.db"
chown "$SERVICE_USER:$SERVICE_GROUP" "$DATA_DIR/sidecar.db"

ln -sf "$DATA_DIR/sidecar.db" "$INSTALL_DIR/sidecar.db"
chown -h "$SERVICE_USER:$SERVICE_GROUP" "$INSTALL_DIR/sidecar.db"

echo "Installing Node.js dependencies..."
run_as_service "cd '$INSTALL_DIR' && '$NPM_BIN' install"
run_as_service "cd '$INSTALL_DIR/ui' && '$NPM_BIN' install && '$NPM_BIN' run build"

cat <<EOF > "$SYSTEMD_UNIT_PATH"
[Unit]
Description=NCC-06 Sidecar
After=network.target

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_GROUP
WorkingDirectory=$INSTALL_DIR
Environment=NODE_ENV=production
Environment=NCC_SIDECAR_DB_PATH=$DATA_DIR/sidecar.db
Environment=NCC_SIDECAR_ALLOW_REMOTE=$ALLOW_REMOTE
ExecStart=$NODE_BIN src/index.js
Restart=on-failure
RestartSec=5
LimitNOFILE=65536
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now "$SERVICE_NAME"

echo "NCC-06 Sidecar installed and started."
echo "Visit http://127.0.0.1:3000 to complete provisioning."
