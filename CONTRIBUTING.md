# Contributing to Weixin Gateway

Thanks for considering contributing.

## Development Principles

- Keep the gateway **upstream-neutral**. Avoid hardcoding Xuanji-specific names or assumptions in core modules.
- Treat Xuanji integration as a compatibility adapter, not as the product core.
- Prefer small, reviewable changes with tests.
- When behavior changes, update the README in the same patch.

## Local Development

```bash
cd apps/weixin-gateway
pnpm test
node src/server.js
```

Useful commands:

```bash
node src/cli.js health
node src/cli.js accounts
node src/cli.js poll:status
node src/cli.js login:start
```

## Testing Expectations

Before opening a PR, run:

```bash
pnpm test
node --check src/server.js
node --check src/cli.js
```

If you change media handling, also verify at least one real flow manually:

- text in/out
- image in/out
- file in/out
- video or voice if touched

## Design Notes

- `src/api/` contains Weixin HTTP protocol wrappers.
- `src/runtime/` contains polling and outbound routing.
- `src/media/` contains inbound/outbound media handling.
- `src/bridge/` should remain generic for arbitrary upstream agent runtimes.

## PR Guidelines

- Explain the user-visible behavior change.
- Mention any protocol assumptions or known limitations.
- Add or update tests for the changed path.
- Keep logs useful for debugging, but avoid noisy default output.
