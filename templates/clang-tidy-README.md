# {{NAME}}

[![part of cpp-linter](https://img.shields.io/badge/part%20of-cpp--linter-ffc20a?labelColor=454a63)](https://cpp-linter.github.io/)

[clang-tidy](https://clang.llvm.org/extra/clang-tidy/) {{VERSION}} as a static binary, for Linux, macOS and Windows on x64 and arm64. It comes with clang's builtin headers (`stddef.h`, `stdarg.h` and the others), so it works without an LLVM install.

```sh
npm install --save-dev {{NAME}}@{{MAJOR}}
npx clang-tidy -p build src/main.cpp          # with build/compile_commands.json
npx clang-tidy src/main.cpp -- -std=c++17     # without a compilation database
```

The npm version is the LLVM version: `{{NAME}}@{{MAJOR}}` always installs the newest LLVM {{MAJOR}} release. Every major from LLVM 12 is published.

clang-tidy also needs the headers of your C++ standard library (libstdc++, libc++ or the Windows SDK), which come with your compiler. For lint checks in pull requests, see [cpp-linter](https://github.com/cpp-linter).

## How it is installed

This package has one optional dependency per platform, such as `{{NAME}}-linux-x64`, and npm installs only the one for your machine. Nothing is downloaded or run at install time, so it works with `--ignore-scripts`, pnpm, Yarn, offline caches and private registry mirrors.

## From Node.js

```js
const clangTidy = require('{{NAME}}');

clangTidy.binaryPath(); // absolute path of the clang-tidy binary
clangTidy.run(['--version']); // runs it and returns the exit code
```

## Where the binaries come from

They are built from the LLVM source by [cpp-linter/clang-tools-static-binaries](https://github.com/cpp-linter/clang-tools-static-binaries), with a GitHub build attestation for every file. Before publishing, the [release workflow](https://github.com/cpp-linter/clang-tools-npm) checks each binary's sha512 and attestation, and the packages are published from GitHub Actions with npm provenance.

[Website](https://cpp-linter.github.io/) · [Source](https://github.com/cpp-linter/clang-tools-npm) · [Issues](https://github.com/cpp-linter/clang-tools-npm/issues) · [Discussions](https://github.com/orgs/cpp-linter/discussions)
