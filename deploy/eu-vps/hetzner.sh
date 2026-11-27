#!/usr/bin/env bash
# Provision a hardened, outbound-only ADE server on Hetzner Cloud (EU) and install ADE.
#
# Prerequisites:
#   - hcloud CLI authenticated (`hcloud context create ade`)
#   - SSH public key at ~/.ssh/id_ed25519.pub (or set ADE_SSH_PUBKEY)
#   - Optional: TAILSCALE_AUTHKEY for zero-public-port Tailscale SSH access
#
# Usage:
#   ./deploy/eu-vps/hetzner.sh [server-name] [location] [server-type]
# Example:
#   TAILSCALE_AUTHKEY=tskey-auth-... ./deploy/eu-vps/hetzner.sh ade-eu fsn1 cpx21

set -euo pipefail

NAME="${1:-ade-eu}"
LOCATION="${2:-fsn1}"     # fsn1 (Falkenstein, DE), nbg1 (Nuremberg, DE), hel1 (Helsinki, FI)
TYPE="${3:-cpx21}"        # 3 vCPU, 4 GB RAM, 80 GB NVMe
PUBKEY_FILE="${ADE_SSH_PUBKEY:-$HOME/.ssh/id_ed25519.pub}"

if ! command -v hcloud >/dev/null 2>&1; then
  echo "Install the Hetzner Cloud CLI first: https://github.com/hetznercloud/cli" >&2
  exit 1
fi
if [ ! -f "$PUBKEY_FILE" ]; then
  echo "SSH public key not found at $PUBKEY_FILE (set ADE_SSH_PUBKEY to override)." >&2
  exit 1
fi

TMP_CLOUD_INIT="$(mktemp -t ade-cloud-init.XXXXXX.yaml)"
trap 'rm -f "$TMP_CLOUD_INIT"' EXIT

ARGS=("cloud-init" "--hostname=$NAME" "--ssh-key=$(cat "$PUBKEY_FILE")" "--out=$TMP_CLOUD_INIT")
if [ -n "${TAILSCALE_AUTHKEY:-}" ]; then
  ARGS+=("--tailscale-key=$TAILSCALE_AUTHKEY")
fi

node scripts/ade-server.ts "${ARGS[@]}"

echo "→ Creating Hetzner Cloud EU server '$NAME' in $LOCATION ($TYPE)..."
hcloud server create \
  --name "$NAME" \
  --location "$LOCATION" \
  --type "$TYPE" \
  --image ubuntu-24.04 \
  --user-data-from-file "$TMP_CLOUD_INIT"

IP="$(hcloud server ip "$NAME")"
TARGET="ade@${TAILSCALE_AUTHKEY:+$NAME}"
[ -z "${TAILSCALE_AUTHKEY:-}" ] && TARGET="ade@${IP}"

echo ""
echo "Server created (IP: $IP). Wait ~90 seconds for cloud-init to finish, then run:"
echo "  node scripts/ade-server.ts install $TARGET"
