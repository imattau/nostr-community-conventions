#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_SCRIPT="$SCRIPT_DIR/install-sidecar.sh"

if [ -f "$INSTALL_SCRIPT" ]; then
  exec "$INSTALL_SCRIPT" remove "$@"
else
  echo "Error: install-sidecar.sh not found in $SCRIPT_DIR"
  exit 1
fi
