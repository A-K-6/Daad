import path from 'node:path';

const root = path.resolve(import.meta.dir, '..');
const pkg = await Bun.file(path.join(root, 'package.json')).json();
if (typeof pkg.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(pkg.version)) throw new Error('A valid release version is required');
const tauri = await Bun.file(path.join(root, 'src-tauri/tauri.conf.json')).json();
const cargo = await Bun.file(path.join(root, 'src-tauri/Cargo.toml')).text();
const updates = await Bun.file(path.join(root, 'src/services/updateService.ts')).text();
const versions = [pkg.version, tauri.version, cargo.match(/^version\s*=\s*"([^"]+)"/m)?.[1], updates.match(/currentVersion\s*=\s*'([^']+)'/)?.[1]];
if (versions.some((version) => version !== pkg.version)) throw new Error(`Release versions disagree: ${versions.join(', ')}`);
const ref = process.env.GITHUB_REF || '';
if (ref.startsWith('refs/tags/') && ref !== `refs/tags/v${pkg.version}`) throw new Error(`Tag ${ref} does not match version ${pkg.version}`);
console.log(`Release versions agree: ${pkg.version}`);
