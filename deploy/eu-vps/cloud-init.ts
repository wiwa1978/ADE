// Generates a hardened, outbound-only EU Ubuntu 24.04 cloud-init configuration for ADE Flavor 2.
// Installs Node.js 24, git, rsync, build tools, rootless Podman, Tailscale, and systemd linger.

export type CloudInitOptions = {
	username?: string;
	sshPublicKey: string;
	tailscaleAuthKey?: string;
	hostname?: string;
	/** Allow public TCP/22 until Tailscale SSH is confirmed. Default false when tailscaleAuthKey is provided. */
	allowPublicSsh?: boolean;
};

export function renderEuCloudInit(options: CloudInitOptions): string {
	const user = (options.username?.trim() || "ade").replace(/[^a-z0-9_-]/gi, "");
	if (!user) throw new Error("Invalid username.");
	const sshKey = options.sshPublicKey.trim();
	if (!sshKey || /[\r\n]/.test(sshKey)) throw new Error("Provide a single-line SSH public key.");
	const hostname = (options.hostname?.trim() || "ade-eu-server").replace(/[^a-z0-9-]/gi, "-");
	const tsKey = options.tailscaleAuthKey?.trim() ?? "";
	if (/[\r\n'"]/.test(tsKey)) throw new Error("Invalid Tailscale auth key.");
	const allowPublicSsh = options.allowPublicSsh ?? !tsKey;

	const ufwCommands = [
		"ufw default deny incoming",
		"ufw default allow outgoing",
		"ufw allow in on tailscale0",
		...(allowPublicSsh ? ["ufw allow 22/tcp"] : []),
		"ufw --force enable",
	];

	const tailscaleSetup = tsKey
		? `tailscale up --authkey=${JSON.stringify(tsKey)} --ssh --hostname=${JSON.stringify(hostname)}`
		: `echo "Run 'sudo tailscale up --ssh --hostname=${hostname}' to join your tailnet."`;

	return `#cloud-config
# ADE EU Self-Hosted Server (Flavor 2) — Outbound-only hardened Ubuntu 24.04
# Provisions: Node.js 24, git, rsync, build tools, rootless Podman, Tailscale, UFW firewall, systemd linger.
hostname: ${hostname}
package_update: true
package_upgrade: true

users:
  - name: ${user}
    groups: [sudo]
    shell: /bin/bash
    sudo: ["ALL=(ALL) NOPASSWD:ALL"]
    ssh_authorized_keys:
      - ${sshKey}

ssh_pwauth: false
disable_root: true

packages:
  - ca-certificates
  - curl
  - gnupg
  - git
  - rsync
  - make
  - g++
  - python3
  - ufw
  - podman
  - uidmap
  - slirp4netns
  - fuse-overlayfs

write_files:
  - path: /etc/ssh/sshd_config.d/99-ade-hardening.conf
    permissions: "0644"
    content: |
      PasswordAuthentication no
      KbdInteractiveAuthentication no
      PermitRootLogin no
      PubkeyAuthentication yes
      AllowTcpForwarding yes

runcmd:
  # Install Node.js 24 LTS
  - curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  - apt-get install -y nodejs
  # Install Tailscale for zero-public-port access
  - curl -fsSL https://tailscale.com/install.sh | sh
  - ${tailscaleSetup}
  # Configure outbound-only firewall (Tailscale interface allowed)
${ufwCommands.map(cmd => `  - ${cmd}`).join("\n")}
  # Enable rootless Podman subuid/subgid & systemd linger so ADE runs after logout
  - usermod --add-subuids 100000-165535 --add-subgids 100000-165535 ${user} || true
  - loginctl enable-linger ${user}
  - systemctl reload ssh || systemctl reload sshd || true
  - echo "ADE EU server base ready. Run: node scripts/ade-server.ts install ${user}@${hostname}"
`;
}
