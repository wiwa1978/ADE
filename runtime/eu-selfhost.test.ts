import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderEuCloudInit } from "../deploy/eu-vps/cloud-init.ts";

describe("EU outbound-only cloud-init generator", () => {
	it("generates an outbound-only Tailscale + rootless Podman + Node 24 config", () => {
		const yaml = renderEuCloudInit({
			sshPublicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITestKey user@host",
			tailscaleAuthKey: "tskey-auth-test123",
			hostname: "ade-hetzner-eu",
		});
		assert.match(yaml, /^#cloud-config/);
		assert.match(yaml, /hostname: ade-hetzner-eu/);
		assert.match(yaml, /ssh_pwauth: false/);
		assert.match(yaml, /disable_root: true/);
		assert.match(yaml, /podman/);
		assert.match(yaml, /setup_24\.x/);
		assert.match(yaml, /ufw default deny incoming/);
		assert.match(yaml, /ufw allow in on tailscale0/);
		assert.doesNotMatch(yaml, /ufw allow 22\/tcp/, "public SSH is closed when Tailscale auth key is supplied");
		assert.match(yaml, /loginctl enable-linger ade/);
	});

	it("opens SSH port 22 when no Tailscale auth key is provided", () => {
		const yaml = renderEuCloudInit({
			sshPublicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITestKey user@host",
		});
		assert.match(yaml, /ufw allow 22\/tcp/);
	});

	it("rejects multiline SSH keys", () => {
		assert.throws(() => renderEuCloudInit({ sshPublicKey: "ssh-ed25519 foo\nbar" }), /single-line/);
	});
});
