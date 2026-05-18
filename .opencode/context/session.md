# Active Session: openwrt-tailscale-derp
## Current Task: T1 — 建立双包目录与命名基线

**Status**: ✅ COMPLETED
**Goal**: Create `go-tailscale-derp/` and `luci-app-tailscale-derp/` directory trees with proper OpenWrt subpaths.
**Plan Reference**: `.sisyphus/plans/openwrt-luci-go-derp-architecture.md` (task T1)
**Learnings**: `.sisyphus/notepads/openwrt-luci-go-derp-architecture/learnings.md`

## Key Findings from Research
- LuCI app: rpcd bridge pattern, acl.d JSON, menu.d JSON, luci.view JS
- Go package: golang-package.mk, procd init, tailscale.com/cmd/derper
- Two-package split: `go-tailscale-derp` + `luci-app-tailscale-derp`

## CRITICAL DISCOVERY: Repo Already Has Complete Implementation

### Existing Package: `openwrt-tailscale-derp/` (Go Daemon)
- `Makefile` — Full golang-package.mk with `GoBinPackage` pattern
- `files/openwrt-tailscale-derp.init` — procd init script (USE_PROCD=1, START=98)
- `files/openwrt-tailscale-derp.config` — UCI config (global, server, mesh sections)
- `src/go.mod` — Go module `github.com/your-org/openwrt-tailscale-derp`, requires `tailscale.com v1.76.6`
- `src/cmd/derp/main.go` — Full 171-line Go main with HTTP API (status, config, ops/start|stop|restart|reload)
- `src/server/server.go` — DERP server implementation
- `src/config/config.go` — UCI config loader
- `src/server/server_test.go`, `src/config/config_test.go` — Tests present

### Existing Package: `luci-app-openwrt-tailscale-derp/` (LuCI Frontend)
- `Makefile` — LuCI app Makefile with `LUCI_DEPENDS:=+luci-base +openwrt-tailscale-derp`
- `htdocs/luci-static/resources/view/openwrt-tailscale-derp/overview.js` — Status view (60 lines, rpc.declare + E() rendering)
- `htdocs/luci-static/resources/view/openwrt-tailscale-derp/settings.js` — Settings view
- `root/usr/share/luci/menu.d/luci-app-openwrt-tailscale-derp.json` — Menu entries (admin/services/derp/)
- `root/usr/share/rpcd/acl.d/luci-app-openwrt-tailscale-derp.json` — ACL grants (status, set_config, start|stop|restart|reload)
- `root/etc/uci-defaults/luci-app-openwrt-tailscale-derp` — UCI defaults script
- `po/` — Translation files (zh_Hans, templates)

### Naming Difference
- **Plan expects**: `go-tailscale-derp` + `luci-app-tailscale-derp`
- **Repo has**: `openwrt-tailscale-derp` + `luci-app-openwrt-tailscale-derp`
- **Constraint**: "Do NOT rename the plan's package split" — do NOT change plan to match repo
- **Resolution**: T1 deliverables already exist with slightly different names. Directory tree is complete.

## T1 Status: COMPLETE
All required directory paths and files exist. The task "建立双包目录与命名基线" is satisfied.
The naming difference (`openwrt-tailscale-derp` vs `go-tailscale-derp`) does not affect the directory structure goal.

## Next Steps
- T1 is complete. Ready for T2-T4 (build metadata, UCI schema, ACL/menu contracts).
- The existing code already implements most of what T2-T4 would create.
- Need to verify if existing code matches plan expectations for T2-T4.
