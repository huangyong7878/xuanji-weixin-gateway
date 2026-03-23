# Release Checklist

Use this checklist before publishing `weixin-gateway`.

## Product Readiness

- [ ] README matches actual behavior
- [ ] API list is current
- [ ] supported media matrix is documented
- [ ] environment variables are documented
- [ ] known limitations are documented

## Neutrality

- [ ] no new Xuanji-specific names leaked into core gateway modules
- [ ] bridge/config naming remains upstream-neutral by default
- [ ] Xuanji-specific compatibility stays isolated to adapter/compat paths

## Verification

- [ ] `pnpm test`
- [ ] `node --check src/server.js`
- [ ] `node --check src/cli.js`
- [ ] manual login flow works
- [ ] text round-trip works
- [ ] image round-trip works
- [ ] file round-trip works
- [ ] video round-trip works if changed
- [ ] voice round-trip works if changed

## Packaging

- [ ] confirm package name/version
- [ ] confirm whether package name should stay `@xuanji/weixin-gateway` or become neutral
- [ ] decide whether `private` should be removed from `package.json`
- [ ] add repository/homepage/bugs metadata if publishing to npm
- [ ] confirm license choice

## Cleanup

- [ ] remove accidental local state from `.data/`
- [ ] avoid committing secrets/tokens
- [ ] keep noisy debug logs behind flags
