#!/usr/bin/env bash
# Provision a hardened, outbound-only ADE server on Scaleway (EU) and install ADE.
#
# Prerequisites:
#   - scw CLI authenticated (`scw init`)
#   - SSH public key at ~/.ssh/id_ed25519.pub (or set ADE_SSH_PUBKEY)
#   - Optional: TAILSCALE_AUTHKEY for zero-public-port Tailscale SSH access
#
# Usage:
#   ./deploy/eu-vps/scaleway.sh [server-name] [zone] [instance-type]
# Example:
#   TAILSCALE_AUTHKEY=tskey-auth-... ./deploy/eu-vps/scaleway.sh ade-eu nl-ams-1 DEV1-M

set -euo pipefail

NAME="${1:-ade-eu}"
ZONE="${2:-nl-ams-1}"     # nl-ams-1 (Amsterdam, NL), fr-par-1 (Paris, FR), pl-waw-1 (Warsaw, PL)
TYPE="${3:-DEV1-M}"       # 3 vCPU, 4 GB RAM
PUBKEY_FILE="${ADE_SSH_PUBKEY:-$HOME/.ssh/id_ed25519.pub}"

if ! command -v scw >/dev/null 2>&1; then
  echo "Install the Scaleway CLI first: https://github.com/scaleway/scaleway-cli" >&2
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

echo "→ Creating Scaleway EU instance '$NAME' in $ZONE ($TYPE)..."
scw instance server create \
  zone="$ZONE" \
  name="$NAME" \
  type="$TYPE" \
  image=ubuntu_noble \
  cloud-init="@$TMP_CLOUD_INIT"

echo ""
echo "Instance created. Wait ~90 seconds for cloud-init to finish, then run:"
if [ -n "${TAILSCALE_AUTHKEY:-}" ]; then
  echo "  node scripts/ade-server.ts install ade@$NAME"
else
  echo "  node scripts/ade-server.ts install ade@<instance-ip>"
fi
