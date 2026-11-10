'use strict';

// Finds the native binary that npm installed from the platform package
// (an optional dependency, e.g. @cpp-linter/clang-tidy-linux-x64) and runs it.

const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const pkg = require('./package.json');

/** Tool name, e.g. "clang-tidy". */
const tool = pkg.name.slice(pkg.name.lastIndexOf('/') + 1);

/** LLVM version of the binary, e.g. "23.1.3". */
const llvmVersion = pkg.version;

const supportedPlatforms = Object.keys(pkg.optionalDependencies || {}).map((name) =>
  name.slice(pkg.name.length + 1),
);

function platformPackageName(platform = process.platform, arch = process.arch) {
  return `${pkg.name}-${platform}-${arch}`;
}

/**
 * Absolute path of the native binary for this platform.
 * Throws an Error that says how to fix it when the binary is not installed.
 */
function binaryPath() {
  const key = `${process.platform}-${process.arch}`;
  const name = platformPackageName();
  if (!supportedPlatforms.includes(key)) {
    throw new Error(
      `${pkg.name} has no ${tool} binary for ${key}. ` +
        `Supported platforms: ${supportedPlatforms.join(', ')}.`,
    );
  }
  let dir;
  try {
    dir = path.dirname(require.resolve(`${name}/package.json`));
  } catch {
    throw new Error(
      `${name} is not installed. npm installs it as an optional dependency of ` +
        `${pkg.name}; it is skipped when optional dependencies are turned off ` +
        '(--omit=optional, --no-optional) or when the lockfile was made on another ' +
        `platform without it. Reinstall ${pkg.name}, or add ${name}@${llvmVersion} ` +
        'to your dependencies.',
    );
  }
  const file = path.join(dir, 'bin', process.platform === 'win32' ? `${tool}.exe` : tool);
  if (!fs.existsSync(file)) {
    throw new Error(`${name} is installed but ${file} is missing. Reinstall ${pkg.name}.`);
  }
  return file;
}

/**
 * Runs the tool with `args` and returns its exit code.
 * Output goes to this process's stdout and stderr unless `options.stdio` says otherwise.
 */
function run(args = [], options = {}) {
  const file = binaryPath();
  const spawn = () => childProcess.spawnSync(file, args, { stdio: 'inherit', ...options });
  let result = spawn();
  if (result.error && result.error.code === 'EACCES') {
    // Some package managers drop the executable bit when they unpack.
    fs.chmodSync(file, 0o755);
    result = spawn();
  }
  if (result.error) {
    throw result.error;
  }
  if (result.signal) {
    process.kill(process.pid, result.signal);
  }
  return result.status === null ? 1 : result.status;
}

/**
 * Runs git-clang-format, LLVM's script that formats only the lines changed in git,
 * with the clang-format binary of this package, and returns its exit code.
 * It is a Python script, so Python 3 must be on PATH.
 */
function gitClangFormat(args = [], options = {}) {
  const binary = binaryPath();
  const script = path.join(path.dirname(binary), 'git-clang-format');
  if (!fs.existsSync(script)) {
    throw new Error(`${pkg.name} ${llvmVersion} does not include git-clang-format.`);
  }
  const pythons = process.platform === 'win32' ? ['python', 'py'] : ['python3', 'python'];
  for (const python of pythons) {
    const result = childProcess.spawnSync(python, [script, '--binary', binary, ...args], {
      stdio: 'inherit',
      ...options,
    });
    if (result.error && result.error.code === 'ENOENT') {
      continue;
    }
    if (result.error) {
      throw result.error;
    }
    return result.status === null ? 1 : result.status;
  }
  throw new Error(`git-clang-format needs Python 3, but ${pythons.join(' and ')} are not on PATH.`);
}

module.exports = { tool, llvmVersion, supportedPlatforms, binaryPath, run, gitClangFormat };
