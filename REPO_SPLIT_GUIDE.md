# Repository Split Guide

This document captures how `apps/weixin-gateway` should be extracted into its own repository.

## Goal

Create a standalone, upstream-neutral repository for the Weixin gateway without carrying over Xuanji-specific runtime data or local reference artifacts.

## Keep in the standalone repository

- `src/`
- `package.json`
- `package-lock.json`
- `README.md`
- `LICENSE`
- `CONTRIBUTING.md`
- `CHANGELOG.md`
- `RELEASE_CHECKLIST.md`
- `.gitignore`

## Do not include

- `.data/`
  Runtime state, login sessions, cursors, and downloaded inbound media.
- `*.tgz`
  Local package artifacts used for reference or manual inspection.
- `package/`
  Reference implementation files copied from the upstream OpenClaw plugin package.
- `.DS_Store`
  Local macOS metadata.

## Recommended extraction flow

1. Create a new repository directory.
2. Copy only the files listed in **Keep in the standalone repository**.
   Or use the helper script:

```bash
cd apps/weixin-gateway
bash scripts/export-standalone.sh ~/Codes/xuanji-weixin-gateway
```

3. Run:

```bash
pnpm test
node --check src/server.js
node --check src/cli.js
```

4. Add repository metadata to `package.json` once the final repo URL is known:
   - `repository`
   - `homepage`
   - `bugs`

## Suggested first commit structure

- `src/`
- package metadata
- README and contribution docs
- release checklist

Avoid mixing local runtime state or experimental reference files into the initial history.

## Naming notes

The gateway should stay product-neutral:

- prefer `UPSTREAM_*` naming over Xuanji-specific names
- keep Xuanji compatibility as an adapter/integration concern
- avoid describing the project as “for Xuanji only”
