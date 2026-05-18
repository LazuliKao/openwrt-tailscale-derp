## Tailscale DERP dependency policy

- Locked upstream module: `tailscale.com v1.82.5`
- Source of truth: `src/go.mod`
- Scope: use upstream `tailscale.com/derp` and related packages only through tagged module versions

### Rules

- Do not use `@latest`
- Do not track `main`
- Keep DERP-related imports on the same tagged Tailscale release

### Upgrade procedure

1. Review the Tailscale changelog for DERP-facing breaking changes.
2. Update `tailscale.com` in `src/go.mod` to the new fixed tag.
3. Run `go mod tidy` in `go-tailscale-derp/src`.
4. Re-run Go tests and verify DERP startup behavior.
5. Re-check STUN, mesh, TLS, health, and metrics behavior.

### Regression checklist

- DERP server starts without panic
- STUN responds on the configured listener
- Mesh key handling still works when mesh mode is enabled
- TLS cert/key handling still works
- Health and metrics endpoints still respond
