#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

INSTALL_DIR_DEFAULT="/opt/ncc-sidecar"
DATA_DIR_DEFAULT="/var/lib/ncc-sidecar"
SERVICE_NAME_DEFAULT="ncc-sidecar"
SERVICE_USER_DEFAULT="ncc-sidecar"
ALLOW_REMOTE=false
NODE_VERSION="v24.12.0"
SERVICE_PORT_DEFAULT="3000"

usage() {
  cat <<EOF
Usage: $(basename "$0") [command] [options]

Commands:
  install      Install or update the sidecar (default)
  update       Pull new source and rebuild in-place
  reinstall    Remove and re-run install
  remove       Uninstall the sidecar, service, and optionally data

Options:
  --install-dir DIR     Where to deploy the code (default: $INSTALL_DIR_DEFAULT)
  --data-dir DIR        Where to keep runtime data like sidecar.db (default: $DATA_DIR_DEFAULT)
  --service-name NAME   systemd unit name (default: $SERVICE_NAME_DEFAULT)
  --service-user USER   Linux user that runs the sidecar (default: $SERVICE_USER_DEFAULT)
  --port PORT           Port to listen on (default: $SERVICE_PORT_DEFAULT)
  --caddy-address ADDR  Configure Caddy reverse proxy for this domain or IP
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
SERVICE_PORT="$SERVICE_PORT_DEFAULT"
CADDY_ADDRESS=""
ACTION="install"
NPM_PACKAGE=""

while (( "$#" )); do
  case "$1" in
    install|update|reinstall|remove)
      ACTION="$1"
      shift
      ;;
    --install-dir) INSTALL_DIR="$2"; shift 2;;
    --data-dir) DATA_DIR="$2"; shift 2;;
    --service-name) SERVICE_NAME="$2"; shift 2;;
    --service-user) SERVICE_USER="$2"; shift 2;;
    --port) SERVICE_PORT="$2"; shift 2;;
    --caddy-address) CADDY_ADDRESS="$2"; shift 2;;
    --repo-source) REPO_SOURCE="$2"; shift 2;;
    --npm-package) NPM_PACKAGE="$2"; shift 2;;
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

require_cmd rsync
require_cmd systemctl

install_node_dist() {
  local cached_node="$INSTALL_DIR/.node/bin/node"
  if [ -x "$cached_node" ] && [ -x "$(dirname "$cached_node")/npm" ]; then
    NODE_BIN="$cached_node"
    NPM_BIN="$(dirname "$cached_node")/npm"
    NODE_DIR="$(dirname "$NODE_BIN")"
    return
  fi
  if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
    NODE_BIN="$(command -v node)"
    NPM_BIN="$(command -v npm)"
    NODE_DIR="$(dirname "$NODE_BIN")"
    return
  fi
  require_cmd curl
  require_cmd tar
  local arch
  case "$(uname -m)" in
    x86_64) arch="linux-x64";;
    aarch64) arch="linux-arm64";;
    *)
      echo "Unsupported architecture for automatic Node download: $(uname -m)"
      exit 1
      ;;
  esac
  local node_tar="$DATA_DIR/node-$NODE_VERSION-$arch.tar.xz"
  local url="https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-$arch.tar.xz"
  echo "Downloading Node.js $NODE_VERSION for $arch..."
  curl -fsSL "$url" -o "$node_tar"
  local node_root="$INSTALL_DIR/.node"
  rm -rf "$node_root"
  mkdir -p "$node_root"
  tar -xJf "$node_tar" -C "$node_root" --strip-components=1
  NODE_BIN="$node_root/bin/node"
  NPM_BIN="$node_root/bin/npm"
  NODE_DIR="$(dirname "$NODE_BIN")"
  chmod +x "$NODE_BIN" "$NPM_BIN"
}

setup_node_path() {
  if [ -n "$NODE_DIR" ]; then
    export PATH="$NODE_DIR:$PATH"
  fi
}

SOURCE_DIR=""
TEMP_SOURCE=""

setup_source() {
  if [ -n "$NPM_PACKAGE" ]; then
    require_cmd npm
    TEMP_SOURCE="$(mktemp -d /tmp/ncc-sidecar-npm-XXXX)"
    echo "Fetching npm package $NPM_PACKAGE..."
    npm pack "$NPM_PACKAGE" --pack-destination "$TEMP_SOURCE" >/dev/null
    local tarball
    tarball="$(find "$TEMP_SOURCE" -maxdepth 1 -name '*.tgz' -print -quit)"
    if [ -z "$tarball" ]; then
      echo "Failed to download npm package: $NPM_PACKAGE"
      exit 1
    fi
    mkdir -p "$TEMP_SOURCE/src"
    tar -xzf "$tarball" -C "$TEMP_SOURCE/src" --strip-components=1
    SOURCE_DIR="$TEMP_SOURCE/src"
    return
  fi
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
NODE_BIN=""
NPM_BIN=""
NODE_DIR=""

ensure_user() {
  if id "$SERVICE_USER" >/dev/null 2>&1; then
    echo "Service user $SERVICE_USER already exists."
  else
    useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
  fi
}

stop_service() {
  systemctl stop "$SERVICE_NAME" >/dev/null 2>&1 || true
}

disable_service() {
  systemctl disable "$SERVICE_NAME" >/dev/null 2>&1 || true
}

remove_service_unit() {
  rm -f "$SYSTEMD_UNIT_PATH"
}

write_systemd_unit() {
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
Environment=ADMIN_PORT=$SERVICE_PORT
ExecStart=$NODE_BIN src/index.js
Restart=on-failure
RestartSec=5
LimitNOFILE=65536
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
}

setup_caddy() {
  if [ -z "$CADDY_ADDRESS" ]; then
    return
  fi
  if ! command -v caddy >/dev/null 2>&1; then
    echo "Caddy is not installed. Skipping Caddy setup."
    return
  fi
  
  local caddy_config="/etc/caddy/Caddyfile"
  if [ ! -f "$caddy_config" ]; then
    echo "Caddyfile not found at $caddy_config. Skipping Caddy setup."
    return
  fi

  if grep -q "$CADDY_ADDRESS" "$caddy_config"; then
    echo "Address $CADDY_ADDRESS seems to be already configured in $caddy_config."
  else
    echo "Configuring Caddy for $CADDY_ADDRESS..."
    cat <<EOF >> "$caddy_config"

$CADDY_ADDRESS {
    reverse_proxy 127.0.0.1:$SERVICE_PORT
}
EOF
    if systemctl is-active --quiet caddy; then
        systemctl reload caddy
        echo "Caddy reloaded."
    else
        echo "Caddy service is not active. Please start/reload it manually."
    fi
  fi
}

deploy_sidecar() {
  echo "Installing NCC-06 Sidecar under $INSTALL_DIR"
  install_node_dist
  setup_node_path
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
    --exclude '.node' \
    "$SOURCE_DIR/" "$INSTALL_DIR/"

  mkdir -p "$INSTALL_DIR/certs"
  chown -R "$SERVICE_USER:$SERVICE_GROUP" "$INSTALL_DIR"

  touch "$DATA_DIR/sidecar.db"
  chown "$SERVICE_USER:$SERVICE_GROUP" "$DATA_DIR/sidecar.db"

  ln -sf "$DATA_DIR/sidecar.db" "$INSTALL_DIR/sidecar.db"
  chown -h "$SERVICE_USER:$SERVICE_GROUP" "$INSTALL_DIR/sidecar.db"

  echo "Installing Node.js dependencies..."
  cd "$INSTALL_DIR"
  "$NPM_BIN" install
  cd "$INSTALL_DIR/ui"
  "$NPM_BIN" install
  "$NPM_BIN" run build
  cd "$INSTALL_DIR"
  chown -R "$SERVICE_USER:$SERVICE_GROUP" "$INSTALL_DIR"

  write_systemd_unit
  setup_caddy
}

start_service() {
  systemctl daemon-reload
  systemctl enable --now "$SERVICE_NAME"
}

restart_service() {
  systemctl daemon-reload
  systemctl restart "$SERVICE_NAME"
}

update_sidecar() {
  stop_service
  deploy_sidecar
  restart_service
  echo "NCC-06 Sidecar updated and restarted."
}

remove_sidecar() {
  stop_service
  disable_service
  remove_service_unit
  systemctl daemon-reload
  rm -rf "$INSTALL_DIR"
  rm -rf "$INSTALL_DIR/.node"
  rm -rf "$DATA_DIR"
  userdel -r "$SERVICE_USER" >/dev/null 2>&1 || true
  echo "NCC-06 Sidecar uninstalled. Data and service files were removed."
}

case "$ACTION" in
  install)
    deploy_sidecar
    start_service
    if [ -n "$CADDY_ADDRESS" ]; then
        echo "Visit https://$CADDY_ADDRESS (or http://$CADDY_ADDRESS) to complete provisioning."
    else
        echo "Visit http://127.0.0.1:$SERVICE_PORT to complete provisioning."
    fi
    ;;
  update)
    update_sidecar
    ;;
  reinstall)
    remove_sidecar
    deploy_sidecar
    start_service
    if [ -n "$CADDY_ADDRESS" ]; then
        echo "Visit https://$CADDY_ADDRESS (or http://$CADDY_ADDRESS) to complete provisioning."
    else
        echo "Visit http://127.0.0.1:$SERVICE_PORT to complete provisioning."
    fi
    ;;
  remove)
    remove_sidecar
    ;;
  *)
    echo "Unknown command: $ACTION"
    usage
    ;;
esac
