import type { Router } from "../router.ts";
import {
	validateMobileDeviceRename,
	validateMobileEnable,
	validateMobilePair,
	validateMobileTunnel,
} from "../validators.ts";
import type { RouteDeps } from "./context.ts";

export function registerMobileRoutes(router: Router, { mobilePairing }: RouteDeps): void {
	if (!mobilePairing) return;

	router.get("/api/mobile/session", (ctx) => {
		// Local desktop client does not require phone pairing.
		ctx.json(200, {
			mobileBridge: false,
			hostName: mobilePairing.status().hostName,
			paired: true,
			device: null,
		});
	});

	router.get("/api/mobile/status", (ctx) => {
		ctx.json(200, mobilePairing.status());
	});

	router.post(
		"/api/mobile/enable",
		async (ctx) => {
			const input = validateMobileEnable(await ctx.readBody());
			const status = await mobilePairing.configure(input);
			ctx.json(200, status);
		},
		{ originError: "Use ADE on this computer to manage mobile pairing." },
	);

	router.post(
		"/api/mobile/pair",
		async (ctx) => {
			const raw = ctx.request.headers["content-type"] ? await ctx.readBody() : {};
			const input = validateMobilePair(raw);
			const status = mobilePairing.createChallenge(input);
			ctx.json(200, status);
		},
		{ originError: "Use ADE on this computer to generate a pairing QR code." },
	);

	router.post(
		"/api/mobile/tunnel",
		async (ctx) => {
			const input = validateMobileTunnel(await ctx.readBody());
			const status = input.action === "stop"
				? await mobilePairing.stopTunnel()
				: await mobilePairing.startTunnel();
			ctx.json(200, status);
		},
		{ originError: "Use ADE on this computer to manage the remote tunnel." },
	);

	router.patch(
		"/api/mobile/devices/:id",
		async (ctx) => {
			const input = validateMobileDeviceRename(await ctx.readBody());
			ctx.json(200, { device: mobilePairing.renameDevice(ctx.params.id, input.name) });
		},
		{ originError: "Use ADE on this computer to rename paired devices." },
	);

	router.delete(
		"/api/mobile/devices/:id",
		(ctx) => {
			ctx.json(200, mobilePairing.revokeDevice(ctx.params.id));
		},
		{ originError: "Use ADE on this computer to revoke paired devices." },
	);

	router.post(
		"/api/mobile/devices/revoke-all",
		(ctx) => {
			ctx.json(200, mobilePairing.revokeAllDevices());
		},
		{ originError: "Use ADE on this computer to revoke paired devices." },
	);
}
