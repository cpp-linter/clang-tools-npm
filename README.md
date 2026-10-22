# clang-tools-npm

[![clang-format on npm](https://img.shields.io/npm/v/@cpp-linter/clang-format?label=clang-format&labelColor=454a63&color=007ec6)](https://www.npmjs.com/package/@cpp-linter/clang-format)
[![clang-tidy on npm](https://img.shields.io/npm/v/@cpp-linter/clang-tidy?label=clang-tidy&labelColor=454a63&color=007ec6)](https://www.npmjs.com/package/@cpp-linter/clang-tidy)
[![ci](https://img.shields.io/github/actions/workflow/status/cpp-linter/clang-tools-npm/test.yml?branch=main&label=ci&labelColor=454a63)](https://github.com/cpp-linter/clang-tools-npm/actions/workflows/test.yml)
[![part of cpp-linter](https://img.shields.io/badge/part%20of-cpp--linter-ffc20a?labelColor=454a63)](https://cpp-linter.github.io/)

clang-format and clang-tidy as npm packages, made from the [static binaries](https://github.com/cpp-linter/clang-tools-static-binaries) for LLVM 12–23 on 6 platforms, so you can use them without installing LLVM.

[Website](https://cpp-linter.github.io/) · [Get started](https://cpp-linter.github.io/getting-started/#just-the-clang-tools) · [Discussions](https://github.com/orgs/cpp-linter/discussions)

## Quick start

| Package | What it is |
| --- | --- |
| [`@cpp-linter/clang-format`](https://www.npmjs.com/package/@cpp-linter/clang-format) | clang-format, the C/C++ code formatter |
| [`@cpp-linter/clang-tidy`](https://www.npmjs.com/package/@cpp-linter/clang-tidy) | clang-tidy, the C/C++ linter, with clang's builtin headers |

```sh
npm install --save-dev @cpp-linter/clang-format@23 @cpp-linter/clang-tidy@23
npx clang-format --dry-run --Werror src/*.cpp
npx clang-tidy -p build src/main.cpp
```

- **The npm version is the LLVM version.** `@cpp-linter/clang-format@18` installs the newest LLVM 18 release. clang-format output changes between LLVM majors, so pin one.
- **Linux, macOS and Windows, on x64 and arm64.** Each package has one optional dependency per platform (such as `@cpp-linter/clang-tidy-linux-x64`), and npm installs only the one for your machine. Nothing is downloaded or run at install time, so the packages work with `--ignore-scripts`, pnpm, Yarn, offline caches and private registry mirrors.
- **clang-tidy works out of the box.** Its platform packages include clang's builtin headers (`stddef.h`, `stdarg.h` and the others) in `lib/clang/<version>/include`, next to the binary, where clang-tidy looks for them.
- **Traceable.** The binaries are built from the LLVM source with a GitHub build attestation for every file. The release workflow checks each file's sha512 and attestation before packing, and publishes from GitHub Actions with npm trusted publishing and provenance.

## How it works

```
index.json of clang-tools-static-binaries
  └─ scripts/build.mjs     download, check sha512 + attestation, make 7 packages per tool and version
      └─ test/smoke.mjs    install on 6 platforms (npm, and pnpm on Linux) and run on test code
          └─ scripts/publish.mjs   npm publish, platform packages first, skip what is already on npm
```

The [Publish](.github/workflows/publish.yml) workflow runs every day and publishes the LLVM versions that are new in `index.json`. Its publish job waits for a maintainer's approval in the `npm` environment. See [CONTRIBUTING.md](CONTRIBUTING.md) for running it locally and for the release setup.

## License

The scripts and the JavaScript in the main packages are MIT licensed. The binaries and headers in the platform packages are LLVM, under the Apache License v2.0 with LLVM Exceptions; each platform package includes LLVM's `LICENSE.TXT`.
