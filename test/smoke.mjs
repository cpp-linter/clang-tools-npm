#!/usr/bin/env node
// Installs the packed packages the way users do and runs them on test code.
//
//   node test/smoke.mjs --dist dist --version 23 [--pm npm|pnpm]
//
// Only the tarballs for this machine are installed: the main package and its
// platform package. The other platform packages are optional dependencies
// that npm skips here (they are not on the registry yet, or not for this OS).

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';

// Uses only clang's builtin headers, which come with the clang-tidy package:
// with -nostdlibinc clang searches nothing else, so this fails with
// "'stddef.h' file not found" when they are missing.
const FREESTANDING_SOURCE = `#include <limits.h>
#include <stdarg.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

const size_t int_size = sizeof(int32_t);
const bool positive = INT_MAX > 0;
int *pointer = 0;
`;
const FREESTANDING_FLAGS = ['-std=c++11', '-ffreestanding', '-nostdlibinc'];

// With the system's C++ standard library; only on Linux, where the runner's
// libstdc++ is found without an SDK or a Visual Studio environment.
const HOSTED_SOURCE = `#include <string>
#include <vector>

std::vector<std::string> names() { return {"clang-tidy", "clang-format"}; }
int *pointer = 0;
`;

const UNFORMATTED = 'int  main( ){return 0;}\n';
const FORMATTED = 'int main() { return 0; }\n';

const { values } = parseArgs({
  options: {
    dist: { type: 'string', default: 'dist' },
    version: { type: 'string' },
    pm: { type: 'string', default: 'npm' },
  },
});
const dist = path.resolve(values.dist);
const manifest = JSON.parse(fs.readFileSync(path.join(dist, 'manifest.json'), 'utf8'));
const release = manifest.versions.find((v) => v.major === values.version || v.version === values.version);
if (!release) {
  console.error(`dist/manifest.json has no LLVM ${values.version}.`);
  process.exit(1);
}
const windows = process.platform === 'win32';
const packages = release.packages.filter(
  (p) => p.kind === 'main' || (p.os === process.platform && p.cpu === process.arch),
);
const tools = [...new Set(packages.map((p) => p.tool))];
for (const tool of tools) {
  if (!packages.some((p) => p.tool === tool && p.kind === 'platform')) {
    console.error(`No ${tool} package for ${process.platform}-${process.arch}.`);
    process.exit(1);
  }
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'clang-tools-npm-'));
fs.writeFileSync(path.join(work, 'package.json'), '{"name":"smoke","version":"1.0.0","private":true}\n');
const tarballs = packages.map((p) => path.join(dist, p.tarball));

function sh(cmd, args, options = {}) {
  console.log(`>>> ${cmd} ${args.join(' ')}`);
  // .cmd shims (npx, pnpm, the installed commands) need a shell on Windows.
  return spawnSync(cmd, args, { cwd: work, encoding: 'utf8', shell: windows, ...options });
}

if (values.pm === 'pnpm') {
  execFileSync('pnpm', ['add', ...tarballs], { cwd: work, stdio: 'inherit', shell: windows });
} else {
  execFileSync('npm', ['install', '--no-audit', '--no-fund', ...tarballs], {
    cwd: work,
    stdio: 'inherit',
    shell: windows,
  });
}

function exec(tool, args) {
  return values.pm === 'pnpm' ? sh('pnpm', ['exec', tool, ...args]) : sh('npx', ['--no-install', tool, ...args]);
}

const failures = [];
function check(name, ok, details) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) {
    console.log(`      ${details.replaceAll('\n', '\n      ')}`);
    failures.push(name);
  }
}
const output = (r) => `${r.stdout || ''}${r.stderr || ''}${r.error ? r.error.message : ''}`;

for (const tool of tools) {
  const result = exec(tool, ['--version']);
  check(
    `${tool} --version`,
    result.status === 0 && output(result).includes(release.version),
    `exit ${result.status}, expected ${release.version}:\n${output(result)}`,
  );
  const api = sh(process.execPath, [
    '-e',
    `const t = require('@cpp-linter/${tool}');
     const fs = require('fs');
     if (t.llvmVersion !== ${JSON.stringify(release.version)}) throw new Error('llvmVersion ' + t.llvmVersion);
     if (!fs.existsSync(t.binaryPath())) throw new Error('missing ' + t.binaryPath());
     process.exit(t.run(['--version'], { stdio: 'ignore' }));`,
  ], { shell: false });
  check(`${tool} Node.js API`, api.status === 0, output(api));
}

if (tools.includes('clang-format')) {
  fs.writeFileSync(path.join(work, 'format.cpp'), UNFORMATTED);
  const result = exec('clang-format', ['--style=LLVM', 'format.cpp']);
  check(
    'clang-format formats code',
    result.status === 0 && (result.stdout || '').replaceAll('\r\n', '\n') === FORMATTED,
    `exit ${result.status}, printed ${JSON.stringify(result.stdout)}, expected ${JSON.stringify(FORMATTED)}\n${result.stderr}`,
  );
}

if (tools.includes('clang-tidy')) {
  const tidy = (name, source, flags) => {
    fs.writeFileSync(path.join(work, `${name}.cpp`), source);
    const result = exec('clang-tidy', [`${name}.cpp`, '--checks=-*,modernize-use-nullptr', '--', ...flags]);
    const out = output(result);
    check(
      `clang-tidy finds the headers (${name})`,
      result.status === 0 && !out.includes('error:') && out.includes('modernize-use-nullptr'),
      `exit ${result.status}:\n${out}`,
    );
  };
  tidy('freestanding', FREESTANDING_SOURCE, FREESTANDING_FLAGS);
  if (process.platform === 'linux') {
    tidy('hosted', HOSTED_SOURCE, ['-std=c++17']);
  }
}

fs.rmSync(work, { recursive: true, force: true });
if (failures.length > 0) {
  console.error(`LLVM ${release.version} on ${process.platform}-${process.arch} (${values.pm}): ${failures.length} check(s) failed.`);
  process.exit(1);
}
console.log(`LLVM ${release.version} on ${process.platform}-${process.arch} (${values.pm}): all checks passed.`);
