# FRONTEND KNOWLEDGE BASE

**Stack:** TypeScript + rsbuild + @lazulikao/luci-types JSX runtime

## STRUCTURE

```
openwrt-tailscale-derp/
├── package/                    # OpenWrt packages
│   ├── luci-app-tailscale-derp # LuCI app package
│   │   ├── Makefile            # LuCI app package Makefile
│   │   ├── htdocs              # Build output (copied to router /www)
│   │   ├── po                  # i18n translations
│   │   └── root                # Configs/rpcd files
│   └── tailscale-derp          # Go backend daemon package
│       ├── Makefile            # Go build Makefile
│       ├── files               # Init scripts/config
│       └── src                 # Go source code
├── src/                        # Frontend TypeScript/TSX source
├── tsconfig.json               # TypeScript config
├── rsbuild.config.ts           # Build config (SWC, rspack)
└── package.json                # Dependencies and build scripts
```

## Core Project
- For golang backend (derp core), view `../tailscale-derp`, notify the user if new feature require backend changes, after confirmation, make an prompt for assign the backend task to the golang developer agent.


## JSX RUNTIME (@lazulikao/luci-types)

**CRITICAL**: This project uses LuCI's JSX runtime, NOT React.

### Configuration

- `tsconfig.json`: `"jsx": "react-jsx"`, `"jsxImportSource": "@lazulikao/luci-types"`
- `rsbuild.config.ts`: `transform.react.runtime: "automatic"`, `importSource: "@lazulikao/luci-types"`

### JSX Rules (DIFFERENT FROM REACT)

| Feature | React | LuCI (this project) |
|---------|-------|---------------------|
| CSS class | `className` | `class` |
| Inline style | `style={{color: 'red'}}` | `style="color: red;"` |
| Event handlers | `onClick={fn}` | `onClick={fn}` (same syntax, uses addEventListener internally) |
| Boolean attrs | `disabled={true}` | `disabled` (attribute name as value) |
| Fragment | `<React.Fragment>` or `<>` | `<>` (uses Symbol.for("jsx.fragment")) |

### JSX Type Definitions

Located in `@lazulikao/luci-types/jsx.d.ts`:

- `JSX.Element` = `HTMLElement`
- `JSX.IntrinsicElements` = typed HTML elements (div, button, table, etc.)
- `BaseProps`: `children`, `class`, `id`, `name`, `style`

### Event Handling Pattern

```tsx
// Pre-bind handlers to preserve `this` context
const handleClick = ui.createHandlerFn(this, "handleAction", "start");

// Use in JSX
<button onClick={handleClick}>Start</button>
```

## VIEW PATTERN

```tsx
import { someUtil } from "@/shared/config";

type ViewContext = { map: LuCI.form.CBIMap | null };

export const main = L.view.extend({
  load() {
    return Promise.all([L.uci.load("config-name")]);
  },
  
  render(this: ViewContext) {
    const m = new L.form.Map("config-name", "Title", "Description");
    this.map = m;
    
    let s = m.section(L.form.TypedSection, "section", "Section Title");
    s.anonymous = true;
    
    let o = s.option(L.form.Flag, "enabled", "Enable");
    o.default = "0";
    
    return m.render();
  }
});
```

## BUILD CONFIGURATION

### rsbuild.config.ts

- Entry: `src/views/*.tsx` → `package/luci-app-tailscale-derp/htdocs/luci-static/resources/view/tailscale-derp/*.js`
- Output: Single-file LuCI modules (no splitChunks)
- Banner: Prepends `'use strict'; 'require view'; ...`
- Footer: Appends `return main;`
- SWC: TypeScript + JSX automatic runtime

### Key Constraints

- NEVER enable `splitChunks` or `runtimeChunk` → breaks LuCI module loading
- NEVER minify → LuCI needs readable error messages
- Output must be ASCII → `charset: "ascii"`
- Target: ES2020+ browsers

## TYPES

Global types from `@lazulikao/luci-types`:

- `L` - LuCI global (view, form, rpc, uci, Poll)
- `LuCI` - LuCI namespace (ui, form types)
- `E()` - DOM element factory (used internally by JSX)
- `_()` - i18n translation function

### Form Types

- `LuCI.form.CBIMap` - Form map
- `LuCI.form.CBIAbstractValue` - Base option type
- `LuCI.form.CBIAbstractSection` - Base section type

## ANTI-PATTERNS

- NEVER `import React` → JSX runtime is automatic
- NEVER use `className` → use `class`
- NEVER use `style={{}}` → use `style=""`
- NEVER edit `htdocs/` directly → build output
- NEVER add React-specific patterns (hooks, context, etc.)
- NEVER use `document.getElementById`, `document.querySelector`, or any DOM traversal API → JSX returns `HTMLElement` directly, store the reference
- NEVER add `id` attributes just to look up elements later → pass JSX element references directly instead
