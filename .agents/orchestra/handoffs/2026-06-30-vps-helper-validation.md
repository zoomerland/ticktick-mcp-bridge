# VPS Helper Validation Handoff

Date: 2026-06-30

## Role And Scope

- Conductor-owned bridge/deployment validation record.
- Repo path: `C:\Users\Zoomerland\Documents\TiickTick-chatgpt-oauth`.
- Branch at handoff: `main`.
- Published commit: `f5720a7` (`fix(ticktick): allow clearing task dates`).
- Scope: record accepted TickTick MCP Bridge production state, local Ubuntu VM
  staging state, deploy-helper validation, and remaining external route gap.
- Non-goals: no Telegram runtime work, no private secret inventory, and no
  writes to real user TickTick tasks.

## Accepted Main Baseline

`origin/main` includes:

- ChatGPT/self-hosted HTTP MCP OAuth provider.
- VPS deployment helper: `plugins/ticktick-mcp-bridge/scripts/deploy-vps.ps1`.
- Deployment guide updates:
  `plugins/ticktick-mcp-bridge/docs/VPS_DEPLOYMENT.md`.
- MCP tool diagnostics and validation envelopes with diagnostic IDs.
- Task API contract hardening for official TickTick create/update payloads.
- Task date clearing support:
  `ticktick_update_task` accepts `startDate: null` and `dueDate: null`.

## Production VPS Validation

Production private VPS:

- Repo path:
  `/opt/ticktick-mcp-bridge/plugins/ticktick-mcp-bridge`.
- Branch: `main`.
- Commit: `f5720a7`.
- Service: `ticktick-mcp-bridge.service`, active.
- Public endpoint: private DuckDNS hostname already used by ChatGPT connector.

Checks run:

- `npm run check`: passed.
- `npm test`: passed.
- Production QA through HTTPS `/mcp`: passed, `27/27`.
- Sandbox project cleanup: passed.
- `update_clear_dates` live QA step: passed against a sandbox task.
- Tools schema smoke: `ticktick_update_task.startDate` and `dueDate` are
  advertised as `["string", "null"]`.

## Local Ubuntu VM Staging Validation

Windows host:

- `VAAPC`, reached through SSH alias `codex-vaapc`.

VirtualBox VM:

- VM name: `ticktick-mcp-staging-vbox`.
- Ubuntu SSH:
  `ssh -i ~/.ssh/<staging-vm-key> -p 2222 ubuntu@192.168.0.100`.
- NAT forwarding:
  - host `2222` -> guest `22`
  - host `80` -> guest `80`
  - host `443` -> guest `443`
- Disk was expanded to 10 GB; root filesystem was resized.

Deploy helper validation:

- Caddy path smoke: passed.
- Nginx path smoke: passed.
- `deploy-vps.ps1 -ReverseProxy nginx -StagingSelfSigned`: passed.
- HTTPS health through local forwarded route:
  `ok=True`, `tools=40`, `authRequired=True`.
- HTTPS `/mcp tools/list` with generated bearer secret: passed, 40 tools.

Final VM service state after Nginx smoke:

- `ticktick-mcp-bridge.service`: active.
- `nginx`: active.
- `caddy`: inactive.
- VM repo: `/opt/ticktick-mcp-bridge` on `codex/vps-deploy-helper` at
  `b9e0068`.

## Remaining Untested Gap

The full external route into the LAN staging VM is intentionally still pending:

```text
DuckDNS/custom domain
-> public ingress IP or controlled VPN/load-balancer endpoint
-> router/VPN/load-balancer forwarding 80/443
-> Windows host 192.168.0.100
-> VirtualBox NAT 80/443
-> Ubuntu VM reverse proxy
-> Node on 127.0.0.1:8787
```

This means the helper has been validated locally with both Caddy and Nginx, but
not yet through the user's external domain/VPN/load-balancer path. That test is
the next deployment gate.

## Privacy Handling

- No TickTick OAuth client secrets, access tokens, refresh tokens, bearer
  secrets, Telegram tokens, SSH private keys, or private task data were
  committed.
- Generated staging secrets printed by the helper were not copied into this
  handoff.
- VM-local private details remain in ignored files under
  `.agents/orchestra/private/`.

## Recommended Next Gate

Run the external route smoke after the user provides/finishes the controlled
domain/VPN/load-balancer path:

1. Point DNS at the ingress IP that can receive inbound `80/443`.
2. Forward/proxy `80/443` to the Windows host or directly to the VM route.
3. Re-run the helper with the real staging domain and chosen reverse-proxy mode.
4. Verify public HTTPS `/health`.
5. Verify public HTTPS `/mcp tools/list` with bearer auth.
6. Only then attempt a ChatGPT connector scan against the staging domain.
