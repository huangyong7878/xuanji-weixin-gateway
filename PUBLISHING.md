# Publishing Notes

This file captures the remaining manual decisions before publishing `weixin-gateway` as its own repository and package.

## 1. Decide the package name

Current package name:

- `@xuanji/weixin-gateway`

If the goal is a fully neutral open-source project, consider whether this should become:

- `weixin-gateway`
- `@your-scope/weixin-gateway`
- another neutral scope/name

This is the most important naming decision still open.

## 2. Repository metadata

Current standalone repository target:

- `https://github.com/huangyong7878/xuanji-weixin-gateway`

The package metadata should point to:

- repository: `git+https://github.com/huangyong7878/xuanji-weixin-gateway.git`
- homepage: `https://github.com/huangyong7878/xuanji-weixin-gateway#readme`
- bugs: `https://github.com/huangyong7878/xuanji-weixin-gateway/issues`

## 3. Validate the package contents

Because `package.json` already uses a `files` allowlist, the published package should stay focused. Before publishing, verify with:

```bash
npm pack --dry-run
```

Confirm it does **not** include:

- `.data/`
- `package/`
- `*.tgz`
- `.DS_Store`

## 4. Recommended first release message

Suggested positioning:

- standalone Weixin gateway for agent runtimes
- upstream-neutral core
- verified support for text, image, video, voice, and file flows
- API-first with CLI support

## 5. Suggested release order

1. create standalone repository
2. copy minimal file set from `REPO_SPLIT_GUIDE.md`
3. fill repository metadata
4. run tests
5. `npm pack --dry-run`
6. tag `v0.1.0`
