# Turnkey EU Self-Hosting (Outbound-Only)

Run ADE's always-on runtime (Flavor 2) on an EU VPS you control (Hetzner Cloud, Scaleway, OVHcloud, or a home server) with **zero public inbound ports**, **rootless Podman** session isolation, and **EU-only mode** enabled.

## What the EU cloud-init recipe sets up

- Non-root `ade` user with SSH key-only login (password login and root SSH disabled).
- **Outbound-only UFW firewall**: denies all inbound traffic except over `tailscale0` (when `TAILSCALE_AUTHKEY` is provided).
- **Node.js 24 LTS**, `git`, `rsync`, `make`, `g++`, `python3`.
- **Rootless Podman** (`podman`, `uidmap`, `slirp4netns`, `fuse-overlayfs`) with `subuid`/`subgid` configured — no root daemon, no `sudo`.
- **systemd user linger** (`loginctl enable-linger ade`) so ADE keeps running after you disconnect.

## Option 1: Hetzner Cloud (Germany / Finland)

```bash
chmod +x deploy/eu-vps/hetzner.sh
TAILSCALE_AUTHKEY=tskey-auth-... ./deploy/eu-vps/hetzner.sh ade-eu fsn1 cpx21
# Wait ~90s for cloud-init, then install ADE:
node scripts/ade-server.ts install ade@ade-eu
```

## Option 2: Scaleway (Amsterdam / Paris / Warsaw)

```bash
chmod +x deploy/eu-vps/scaleway.sh
TAILSCALE_AUTHKEY=tskey-auth-... ./deploy/eu-vps/scaleway.sh ade-eu nl-ams-1 DEV1-M
# Wait ~90s for cloud-init, then install ADE:
node scripts/ade-server.ts install ade@ade-eu
```

## Option 3: Generate `cloud-init.yaml` for any EU provider (OVHcloud, IONOS, Proxmox)

```bash
node scripts/ade-server.ts cloud-init \
  --hostname=ade-eu \
  --ssh-key="$(cat ~/.ssh/id_ed25519.pub)" \
  --tailscale-key="$TAILSCALE_AUTHKEY" \
  --out=cloud-init.yaml
```

## Connect ADE Desktop & Phone

1. Open ADE Desktop → **Settings → Environments → Add host → Remote SSH**.
2. Enter `ade@ade-eu` (port 22, runtime port `4319`).
3. Turn on **Settings → Providers → EU-only mode** and configure an EU model endpoint (e.g., Mistral or Scaleway) or OpenCode.
4. Pair your phone PWA over Tailscale from **Settings → Mobile**.
