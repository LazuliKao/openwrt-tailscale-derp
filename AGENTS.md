# PROJECT KNOWLEDGE BASE

**Generated:** 2026-05-28
**Commit:** 65bdd69
**Branch:** main

## OVERVIEW

OpenWrt LuCI application for managing a Tailscale DERP relay server. Monorepo with pnpm workspaces: Go backend (`tailscale-derp/`) + TypeScript frontend (`luci-app-tailscale-derp/frontend/`).

## STRUCTURE

```
openwrt-tailscale-derp/
├── luci-app-tailscale-derp/    # LuCI web interface
│   ├── frontend/               # TypeScript/TSX source (rsbuild)
│   ├── htdocs/                 # Build output → /www on router
│   ├── po/                     # i18n translations (zh_Hans)
│   ├── root/                   # OpenWrt package files (rpcd, menu.d)
│   └── Makefile                # OpenWrt package build
├── tailscale-derp/             # Go backend service
│   ├── src/                    # Go source (cmd/, config/, internal/)
│   ├── files/                  # Init scripts, UCI defaults
│   └── Makefile                # Go build for OpenWrt
├── package.json                # Root workspace scripts
└── pnpm-workspace.yaml         # Workspace: luci-app-tailscale-derp/frontend
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Frontend views | `luci-app-tailscale-derp/frontend/src/views/` | TSX files with LuCI form API |
| Shared utilities | `luci-app-tailscale-derp/frontend/src/shared/` | Config helpers, validation |
| Build config | `luci-app-tailscale-derp/frontend/rsbuild.config.ts` | SWC, JSX, output settings |
| Type definitions | `luci-app-tailscale-derp/frontend/tsconfig.json` | Uses @lazulikao/luci-types |
| Backend logic | `tailscale-derp/src/` | Go: cmd/, config/, internal/ |
| RPC interface | `luci-app-tailscale-derp/root/usr/libexec/rpcd/` | Shell scripts for ubus |
| Translations | `luci-app-tailscale-derp/po/` | Gettext .po files |

## COMMANDS

```bash
# Frontend
pnpm frontend:build      # Build TSX → JS (output: htdocs/luci-static/resources/view/)
pnpm frontend:dev        # Dev server with watch
pnpm frontend:typecheck  # TypeScript type checking

# i18n
pnpm --dir luci-app-tailscale-derp/frontend i18n:export  # Export translations
```

## CONVENTIONS

- **JSX Runtime**: Uses `@lazulikao/luci-types` (NOT React). See frontend/AGENTS.md for details.
- **Module format**: LuCI expects `'use strict'; 'require view'; ... return main;` wrapper (auto-added by rsbuild)
- **Entry points**: Each view exports `const main = view.extend({...})`
- **RPC calls**: `L.rpc.declare<T>({object, method})` with TypeScript generics
- **Form API**: `L.form.Map` → `TypedSection` → `option(Flag|Value)` pattern
- **Paths alias**: `src/*` → `./src/*` (rsbuild + tsconfig)

## ANTI-PATTERNS

- NEVER use React-style `className` → use `class`
- NEVER use React-style `style={{}}` objects → use `style="string"`
- NEVER use `import React` → JSX runtime is automatic via luci-types
- NEVER edit `htdocs/` directly → it's build output, edit `frontend/src/` instead
- NEVER add `splitChunks` or `runtimeChunk` → LuCI modules must be single-file

## NOTES

- Build output wraps each file as a LuCI view module with `require` declarations
- The Go backend communicates via ubus/rpcd (shell scripts in root/)
- Translations use LuCI's `_()` function + gettext .po workflow
- `@lazulikao/luci-types` provides global types: `L`, `LuCI`, `E`, `_`
