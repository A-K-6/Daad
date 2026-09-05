/** Build the pinned native engine. Run with Bun; never download during cargo build. */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const version = '2.17';
const sha256 = '065fe06c06788d97c35f563796d59f00ce52fe9558a52d7b490a042a966facce';
const root = path.resolve(import.meta.dir, '..');
const base = path.join(root, 'src-tauri', 'target', 'native', `${process.platform}-${process.arch}`);
const source = path.join(base, `pjproject-${version}`);
const prefix = path.join(base, 'install');
async function run(args: string[], cwd = root, env: Record<string, string> = {}) {
  const child = Bun.spawn(args, { cwd, env: { ...process.env, ...env }, stdout: 'inherit', stderr: 'inherit' });
  if (await child.exited !== 0) throw new Error(`Native build failed: ${args[0]}`);
}

if (!['darwin', 'linux'].includes(process.platform)) {
  throw new Error('This build script currently supports macOS and Linux. Windows needs a native PJSIP build before packaging.');
}
await mkdir(base, { recursive: true });
const archive = path.join(base, `pjproject-${version}.tar.gz`);
if (!(await Bun.file(archive).exists())) {
  const response = await fetch(`https://github.com/pjsip/pjproject/archive/refs/tags/${version}.tar.gz`);
  if (!response.ok) throw new Error(`PJSIP download failed: HTTP ${response.status}`);
  await Bun.write(archive, await response.arrayBuffer());
}
const hash = createHash('sha256').update(await Bun.file(archive).bytes()).digest('hex');
if (hash !== sha256) throw new Error('PJSIP source checksum mismatch; refusing build.');
await run(['tar', '-xzf', archive, '-C', base]);
let sslPrefix = process.env.DAAD_OPENSSL_PREFIX;
if (!sslPrefix && process.platform === 'darwin') {
  const brew = Bun.spawn(['brew', '--prefix', 'openssl@3'], { stdout: 'pipe', stderr: 'inherit' });
  sslPrefix = (await new Response(brew.stdout).text()).trim();
  if (await brew.exited !== 0) throw new Error('Install OpenSSL first: brew install openssl@3 pkg-config');
}
await writeFile(path.join(source, 'pjlib/include/pj/config_site.h'), '#define PJMEDIA_HAS_VIDEO 0\n');
await run([
  './configure', `--prefix=${prefix}`, '--disable-video', '--disable-pjsua2',
  '--disable-opus', '--disable-libyuv', '--disable-ffmpeg', '--disable-vpx',
  '--disable-openh264', '--disable-sdl',
  ...(sslPrefix ? [`--with-ssl=${sslPrefix}`] : []),
], source);
await run(['make', 'dep'], source);
await run(['make', `-j${process.env.DAAD_BUILD_JOBS || '4'}`], source);
await run(['make', 'install'], source);
if (sslPrefix) {
  const pcPath = path.join(prefix, 'lib/pkgconfig/libpjproject.pc');
  const pc = await Bun.file(pcPath).text();
  await Bun.write(pcPath, pc.replace('Libs.private:', `Libs.private: -L${sslPrefix}/lib`));
}
console.log(`Native engine installed: ${prefix}`);
console.log('The adapter compile rejects builds missing TLS or SRTP.');
