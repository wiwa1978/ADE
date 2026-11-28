# ADE Plugin System & Open-Source Marketplace Spec

ADE uses a **Lean Core + Git-backed Marketplace** architecture so users can choose the exact capabilities they want, and open-source contributors can publish plugins via GitHub PR without modifying ADE core.

## Two Tiers of Plugins

1. **Core Modules (`kind: "core"`)**
   Built-in ADE capabilities that can be toggled on or off in **Marketplace → Core Modules**:
   - `core.observatory` — ADE Observatory (Live Fleet, Stall Detection, Gantt Task Traces)
   - `core.swarm` — Swarm & Team Board
   - `core.blueprints` — Software Factory & Blueprints
   - `core.automations` — Automations & Inbound Gateway
   - `core.cloud-vms` — Cloud VM Providers (Boat.dev, Daytona, E2B)
   - `core.eu-sovereignty` — EU Sovereignty & Egress Proxy
   - `core.mobile` — Mobile Companion

2. **Community Plugins (`kind: "community"`)**
   Installed from any GitHub repository (`owner/repo`) or HTTPS URL serving a `marketplace.json` index. Teams can also host private internal marketplaces.

## `marketplace.json` Format

Host a `marketplace.json` at the root of your repository's `main` branch (or any HTTPS URL):

```json
{
  "schemaVersion": 1,
  "id": "my-org-marketplace",
  "name": "My Org ADE Marketplace",
  "description": "Curated workflows, skills, and MCP bundles for our team.",
  "homepage": "https://github.com/my-org/ade-marketplace",
  "plugins": [
    {
      "id": "community.pr-review-pack",
      "name": "PR Review & Security Audit Pack",
      "version": "1.0.0",
      "description": "Automated pull request reviewer focused on security regressions and test coverage.",
      "author": "your-github-handle",
      "homepage": "https://github.com/my-org/ade-marketplace",
      "license": "MIT",
      "kind": "community",
      "category": "workflows",
      "tags": ["pr-review", "security"],
      "capabilities": {
        "recipes": [
          {
            "id": "pr-security-review",
            "name": "PR Security & Quality Review",
            "description": "Review the active branch diff for security issues and missing tests.",
            "prompt": "Review all changes on the current branch against main..."
          }
        ],
        "skills": [
          {
            "name": "owasp-checklist",
            "description": "OWASP top-10 review checklist",
            "source": "https://github.com/my-org/skills/tree/main/owasp-checklist"
          }
        ],
        "mcpServers": [
          {
            "id": "playwright",
            "name": "Playwright MCP",
            "command": "npx",
            "args": ["-y", "@playwright/mcp@latest"]
          }
        ]
      }
    }
  ]
}
```

## Contributing a Plugin to the Official Marketplace

1. Fork the marketplace repository and add your plugin entry to `marketplace.json`.
2. Ensure your manifest validates against `AdeMarketplaceIndexSchema` in `packages/protocol/schemas/plugins.ts`.
3. Open a pull request — once merged, every ADE user who clicks **Refresh catalogs** will see your plugin immediately.
