#!/usr/bin/env node
// Turns the static binaries of cpp-linter/clang-tools-static-binaries into npm packages.
//
// For each LLVM version it makes, per tool:
//   @cpp-linter/<tool>               a small package with the `<tool>` command
//   @cpp-linter/<tool>-<os>-<cpu>    one package per platform with the binary
// The main package lists the platform packages as optionalDependencies, and
// npm installs only the one that matches the machine (see the README).
//
// Nothing is compiled here: the binaries come from the GitHub releases listed in
// index.json, and every file is checked against its sha512 (and, with
// --verify-attestations, against its GitHub build attestation) before it is packed.
//
//   node scripts/build.mjs --versions 23
//   node scripts/build.mjs --versions all --only-missing --verify-attestations

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATES = path.join(ROOT, 'templates');

export const SCOPE = '@cpp-linter';
export const REPOSITORY = 'cpp-linter/clang-tools-npm';
export const SOURCE_REPOSITORY = 'cpp-linter/clang-tools-static-binaries';
export const DEFAULT_INDEX = 'https://cpp-linter.github.io/clang-tools-static-binaries/index.json';
export const REGISTRY = 'https://registry.npmjs.org';

export const TOOLS = {
  'clang-format': {
    headers: false,
    description: 'clang-format, the C/C++ code formatter from LLVM, as a static binary',
    keywords: ['clang-format', 'formatter', 'format', 'c', 'cpp', 'c++', 'llvm', 'clang'],
  },
  'clang-tidy': {
    // clang-tidy parses the code, so it needs clang's builtin headers (stddef.h, ...)
    // next to the binary: <bin>/../lib/clang/<version>/include.
    headers: true,
    description: 'clang-tidy, the C/C++ linter from LLVM, as a static binary with its builtin headers',
    keywords: ['clang-tidy', 'linter', 'lint', 'static-analysis', 'c', 'cpp', 'c++', 'llvm', 'clang'],
  },
};

// Platform names in index.json -> Node's process.platform and process.arch.
export const PLATFORMS = [
  { source: 'linux-amd64', os: 'linux', cpu: 'x64', label: 'Linux x64' },
  { source: 'linux-arm64', os: 'linux', cpu: 'arm64', label: 'Linux arm64' },
  { source: 'macos-amd64', os: 'darwin', cpu: 'x64', label: 'macOS x64' },
  { source: 'macos-arm64', os: 'darwin', cpu: 'arm64', label: 'macOS arm64' },
  { source: 'windows-amd64', os: 'win32', cpu: 'x64', label: 'Windows x64' },
  { source: 'windows-arm64', os: 'win32', cpu: 'arm64', label: 'Windows arm64' },
];

const REPOSITORY_FIELD = { type: 'git', url: `git+https://github.com/${REPOSITORY}.git` };
const HOMEPAGE = `https://github.com/${REPOSITORY}#readme`;
const BUGS = { url: `https://github.com/${REPOSITORY}/issues` };

export function platformPackageName(tool, platform) {
  return `${SCOPE}/${tool}-${platform.os}-${platform.cpu}`;
}

export function distTag(major, latestMajor) {
  return String(major) === String(latestMajor) ? 'latest' : `llvm-${major}`;
}

/** "all" -> every major in the index, newest first; "latest" -> the newest one. */
export function selectMajors(spec, index) {
  const available = Object.keys(index.versions).sort((a, b) => Number(b) - Number(a));
  const words = String(spec || 'latest')
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((word) => (word === 'latest' ? String(index.latest) : word));
  if (words.includes('all')) {
    return available;
  }
  for (const word of words) {
    if (!available.includes(word)) {
      throw new Error(`LLVM ${word} is not in index.json (it has ${available.join(', ')}).`);
    }
  }
  return available.filter((major) => words.includes(major));
}

async function fetchOk(url, init) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await fetch(url, init);
      if (response.ok || response.status === 404 || attempt === 4) {
        return response;
      }
    } catch (error) {
      if (attempt === 4) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000 * 2 ** (attempt - 1)));
  }
}

async function loadIndex(location) {
  if (!/^https?:/.test(location)) {
    return JSON.parse(fs.readFileSync(location, 'utf8'));
  }
  const response = await fetchOk(location);
  if (!response.ok) throw new Error(`GET ${location}: HTTP ${response.status}`);
  return response.json();
}

/** True when name@version is already on the npm registry. */
export async function isPublished(name, version) {
  const url = `${REGISTRY}/${name.replace('/', '%2F')}/${encodeURIComponent(version)}`;
  const response = await fetchOk(url, { headers: { accept: 'application/json' } });
  if (response.status === 404) return false;
  if (!response.ok) throw new Error(`GET ${url}: HTTP ${response.status}`);
  return true;
}

function sha512(file) {
  return createHash('sha512').update(fs.readFileSync(file)).digest('hex');
}

/** Downloads a file listed in index.json into the cache and checks size and sha512. */
async function download(entry, cacheDir) {
  const file = path.join(cacheDir, entry.name);
  if (fs.existsSync(file) && sha512(file) === entry.sha512) {
    return file;
  }
  fs.mkdirSync(cacheDir, { recursive: true });
  console.log(`  downloading ${entry.url}`);
  const response = await fetchOk(entry.url);
  if (!response.ok) throw new Error(`GET ${entry.url}: HTTP ${response.status}`);
  const data = Buffer.from(await response.arrayBuffer());
  if (entry.size !== undefined && data.length !== entry.size) {
    throw new Error(`${entry.name}: got ${data.length} bytes, index.json says ${entry.size}.`);
  }
  const digest = createHash('sha512').update(data).digest('hex');
  if (digest !== entry.sha512) {
    throw new Error(`${entry.name}: sha512 ${digest} does not match index.json (${entry.sha512}).`);
  }
  fs.writeFileSync(file, data);
  return file;
}

function verifyAttestation(file) {
  // Proves the file was built by the static-binaries workflow.
  execFileSync('gh', ['attestation', 'verify', file, '--repo', SOURCE_REPOSITORY], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}

/** Unpacks clang's headers (lib/clang/<version>/include/...) into dir. */
function unpackHeaders(archive, dir) {
  const entries = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' })
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  for (const entry of entries) {
    const parts = entry.replace(/^\.\//, '').split('/');
    if (parts[0] !== 'lib' || (parts.length > 1 && parts[1] !== 'clang') || parts.includes('..')) {
      throw new Error(`Unexpected entry in ${path.basename(archive)}: ${entry}`);
    }
  }
  execFileSync('tar', ['-xzf', archive, '-C', dir]);
  const include = fs
    .readdirSync(path.join(dir, 'lib', 'clang'))
    .map((v) => path.join(dir, 'lib', 'clang', v, 'include', 'stddef.h'));
  if (!include.some((f) => fs.existsSync(f))) {
    throw new Error(`${path.basename(archive)} has no lib/clang/<version>/include/stddef.h`);
  }
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function fillTemplate(name, values) {
  let text = fs.readFileSync(path.join(TEMPLATES, name), 'utf8');
  for (const [key, value] of Object.entries(values)) {
    text = text.replaceAll(`{{${key}}}`, value);
  }
  const left = text.match(/\{\{[A-Z_]+\}\}/);
  if (left) throw new Error(`${name}: no value for ${left[0]}`);
  return text;
}

function makePlatformPackage({ tool, platform, version, entry, binary, headers, license, release, dir }) {
  const exe = platform.os === 'win32' ? '.exe' : '';
  fs.mkdirSync(path.join(dir, 'bin'), { recursive: true });
  const dest = path.join(dir, 'bin', `${tool}${exe}`);
  fs.copyFileSync(binary, dest);
  fs.chmodSync(dest, 0o755);
  const files = ['bin', 'LICENSE.TXT'];
  if (headers) {
    unpackHeaders(headers, dir);
    files.push('lib');
  }
  fs.copyFileSync(license, path.join(dir, 'LICENSE.TXT'));
  const name = platformPackageName(tool, platform);
  writeJson(path.join(dir, 'package.json'), {
    name,
    version,
    description: `The ${platform.label} binary for ${SCOPE}/${tool} (LLVM ${version}).`,
    license: 'Apache-2.0 WITH LLVM-exception',
    repository: REPOSITORY_FIELD,
    homepage: HOMEPAGE,
    bugs: BUGS,
    os: [platform.os],
    cpu: [platform.cpu],
    // Yarn PnP must unpack native binaries to run them.
    preferUnplugged: true,
    files,
    staticBinary: { release, file: entry.name, url: entry.url, sha512: entry.sha512 },
  });
  fs.writeFileSync(
    path.join(dir, 'README.md'),
    fillTemplate('platform-README.md', {
      NAME: name,
      MAIN: `${SCOPE}/${tool}`,
      TOOL: tool,
      LABEL: platform.label,
      VERSION: version,
      RELEASE: release,
      SOURCE_REPOSITORY,
    }),
  );
  return name;
}

function makeMainPackage({ tool, version, major, dir }) {
  const info = TOOLS[tool];
  const name = `${SCOPE}/${tool}`;
  fs.mkdirSync(path.join(dir, 'bin'), { recursive: true });
  for (const file of ['index.js', 'index.d.ts']) {
    fs.copyFileSync(path.join(TEMPLATES, 'main', file), path.join(dir, file));
  }
  fs.copyFileSync(path.join(TEMPLATES, 'main', 'bin.js'), path.join(dir, 'bin', `${tool}.js`));
  fs.chmodSync(path.join(dir, 'bin', `${tool}.js`), 0o755);
  fs.copyFileSync(path.join(ROOT, 'LICENSE'), path.join(dir, 'LICENSE'));
  const optionalDependencies = {};
  for (const platform of PLATFORMS) {
    optionalDependencies[platformPackageName(tool, platform)] = version;
  }
  writeJson(path.join(dir, 'package.json'), {
    name,
    version,
    description: `${info.description} (LLVM ${version}).`,
    keywords: info.keywords,
    license: 'MIT',
    repository: REPOSITORY_FIELD,
    homepage: HOMEPAGE,
    bugs: BUGS,
    main: 'index.js',
    types: 'index.d.ts',
    bin: { [tool]: `bin/${tool}.js` },
    files: ['index.js', 'index.d.ts', `bin/${tool}.js`, 'LICENSE'],
    engines: { node: '>=18' },
    optionalDependencies,
  });
  fs.writeFileSync(
    path.join(dir, 'README.md'),
    fillTemplate(`${tool}-README.md`, { NAME: name, TOOL: tool, VERSION: version, MAJOR: String(major) }),
  );
  return name;
}

function pack(dir, destination) {
  const out = execFileSync('npm', ['pack', dir, '--pack-destination', destination, '--json'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  return path.join(destination, JSON.parse(out)[0].filename);
}

async function main() {
  const { values } = parseArgs({
    options: {
      versions: { type: 'string', default: 'latest' },
      tools: { type: 'string', default: Object.keys(TOOLS).join(',') },
      index: { type: 'string', default: DEFAULT_INDEX },
      out: { type: 'string', default: 'dist' },
      cache: { type: 'string', default: '.cache' },
      'only-missing': { type: 'boolean', default: false },
      'verify-attestations': { type: 'boolean', default: false },
    },
  });
  // Asked for by name: fail when a version cannot be packed. With "all": skip it.
  const strict = !values.versions.split(/[\s,]+/).includes('all');
  const tools = values.tools.split(/[\s,]+/).filter(Boolean);
  for (const tool of tools) {
    if (!TOOLS[tool]) throw new Error(`Unknown tool ${tool}; known: ${Object.keys(TOOLS).join(', ')}`);
  }
  const index = await loadIndex(values.index);
  if (index.schema_version !== 1) {
    throw new Error(`index.json schema_version ${index.schema_version} is not supported.`);
  }
  const out = path.resolve(values.out);
  const tarballs = path.join(out, 'tarballs');
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(tarballs, { recursive: true });

  const manifest = { latest_major: String(index.latest), index_generated_at: index.generated_at, versions: [] };
  for (const major of selectMajors(values.versions, index)) {
    const entry = index.versions[major];
    const version = entry.version;
    const tag = distTag(major, index.latest);
    let selected = tools;
    if (values['only-missing']) {
      const missing = [];
      for (const tool of tools) {
        const names = [`${SCOPE}/${tool}`, ...PLATFORMS.map((p) => platformPackageName(tool, p))];
        const published = await Promise.all(names.map((n) => isPublished(n, version)));
        if (published.includes(false)) missing.push(tool);
      }
      selected = missing;
      if (selected.length === 0) {
        console.log(`LLVM ${version}: already on npm, skipped.`);
        continue;
      }
    }
    console.log(`LLVM ${version} (${entry.tag}, dist-tag ${tag}): ${selected.join(', ')}`);
    if (!entry.license) {
      const message =
        `LLVM ${version}: ${entry.tag} has no LICENSE.TXT, which every package must include. ` +
        'Rebuild this version in clang-tools-static-binaries first.';
      if (strict) throw new Error(message);
      console.log(process.env.GITHUB_ACTIONS ? `::warning::${message} Skipped.` : `  ${message} Skipped.`);
      continue;
    }
    const cache = path.resolve(values.cache, entry.tag);
    const verified = new Set();
    const fetchFile = async (file) => {
      const local = await download(file, cache);
      if (values['verify-attestations'] && !verified.has(local)) {
        verifyAttestation(local);
        verified.add(local);
      }
      return local;
    };
    const license = await fetchFile(entry.license);
    const packages = [];
    for (const tool of selected) {
      const info = TOOLS[tool];
      const builds = entry.tools[tool];
      if (!builds) throw new Error(`LLVM ${version}: index.json has no ${tool}.`);
      let headers = null;
      if (info.headers) {
        if (!entry.resource_headers) {
          const message =
            `LLVM ${version}: ${entry.tag} has no clang resource headers yet, so ${tool} ` +
            'could not find stddef.h. Rebuild this version in clang-tools-static-binaries first.';
          if (strict) throw new Error(message);
          // With --versions all, publish the rest and pick this one up after the rebuild.
          console.log(process.env.GITHUB_ACTIONS ? `::warning::${message} Skipped.` : `  ${message} Skipped.`);
          continue;
        }
        headers = await fetchFile(entry.resource_headers);
      }
      for (const platform of PLATFORMS) {
        const build = builds[platform.source];
        if (!build) throw new Error(`LLVM ${version}: no ${tool} for ${platform.source}.`);
        const binary = await fetchFile(build);
        const dir = path.join(out, 'packages', version, `${tool}-${platform.os}-${platform.cpu}`);
        const name = makePlatformPackage({
          tool,
          platform,
          version,
          entry: build,
          binary,
          headers,
          license,
          release: entry.tag,
          dir,
        });
        packages.push({ name, tool, kind: 'platform', os: platform.os, cpu: platform.cpu, tarball: pack(dir, tarballs) });
      }
      const dir = path.join(out, 'packages', version, tool);
      const name = makeMainPackage({ tool, version, major, dir });
      packages.push({ name, tool, kind: 'main', tarball: pack(dir, tarballs) });
    }
    if (packages.length === 0) continue;
    for (const p of packages) p.tarball = path.relative(out, p.tarball).split(path.sep).join('/');
    manifest.versions.push({ major, version, release: entry.tag, dist_tag: tag, packages });
  }
  writeJson(path.join(out, 'manifest.json'), manifest);
  console.log(`Wrote ${path.join(out, 'manifest.json')}`);
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `has-packages=${manifest.versions.length > 0}\n`);
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      `versions=${JSON.stringify(manifest.versions.map((v) => v.major))}\n`,
    );
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
