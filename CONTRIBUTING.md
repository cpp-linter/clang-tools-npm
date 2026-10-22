# Contributing

Thank you for investing your time in contributing to this project! The general guidelines of the cpp-linter organization are in [cpp-linter/.github](https://github.com/cpp-linter/.github/blob/main/CONTRIBUTING.md): pull requests target `main`, and their titles follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore:`, `docs:`, ...), which the pre-commit workflow checks.

## Build and test locally

Node.js 22 or newer and `tar` are needed.

```sh
node scripts/build.mjs --versions 23        # or "12 23", "latest", "all"
node test/smoke.mjs --version 23            # installs the packages for this machine and runs them
node test/smoke.mjs --version 23 --pm pnpm
npm test                                    # unit tests; fails below 100% line coverage
node scripts/publish.mjs --dry-run          # what would be published
```

`build.mjs` writes the packages to `dist/packages/`, the tarballs to `dist/tarballs/` and the list to `dist/manifest.json`; downloads are cached in `.cache/`. Add `--verify-attestations` to check every file with `gh attestation verify` (needs `gh` and a GitHub token). `--only-missing` skips the versions that are already on npm.

A version is skipped by `--versions all` (and makes a named version fail) when its release has no `LICENSE.TXT`, or no clang resource headers for clang-tidy. Rebuild it in clang-tools-static-binaries first.

## Releases

This repository has no version of its own: the npm version of every package is the LLVM version of the binary, like the per-version releases of clang-tools-static-binaries. So it does not use Release Drafter or tags. A new LLVM version is published when it appears in `index.json`.

The [Publish](.github/workflows/publish.yml) workflow runs daily and by hand (`versions`, `dry-run`). It packs every LLVM version from `index.json` that is not on npm yet, runs the smoke tests on all 6 platforms, and then the `publish` job waits in the `npm` environment for a maintainer's approval.

The newest LLVM major gets the dist-tag `latest`; older majors get `llvm-<major>`, so publishing an old version never changes what `npm install @cpp-linter/clang-tidy` installs. An npm version cannot be published twice: a rebuild of the same LLVM version in clang-tools-static-binaries (a new `-N` release) is not published again.

### Trusted publishing

The Publish workflow has no npm token. Every package trusts `publish.yml` in the `npm` environment ([npm trusted publishing](https://docs.npmjs.com/trusted-publishers)), so npm swaps the job's OIDC token for a short-lived publish token and signs a provenance statement. The `npm` environment has a maintainer as required reviewer and allows only `main`.

A package can only trust a workflow once it exists on npm. When a new tool gets packages, publish their first version once with a 1-day granular token that bypasses 2FA (a `NPM_TOKEN` secret in the `npm` environment, passed to the Publish step as `NODE_AUTH_TOKEN` for that run, as for the first release), then set up trust from a maintainer's machine (npm 11.15 or newer, logged in with `npm login --auth-type=web`; one 2FA prompt, then choose to skip 2FA for 5 minutes):

```sh
for tool in clang-format clang-tidy; do
  for pkg in "$tool" "$tool"-{linux,darwin,win32}-{x64,arm64}; do
    npm trust github "@cpp-linter/$pkg" --repo cpp-linter/clang-tools-npm \
      --file publish.yml --env npm --allow-publish --yes
    sleep 2
  done
done
```

Then delete the token.
