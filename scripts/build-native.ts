/** Build the pinned native engine. Run with Bun; never download during cargo build. */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const version = '2.17';
const sha256 = '065fe06c06788d97c35f563796d59f00ce52fe9558a52d7b490a042a966facce';
const root = path.resolve(import.meta.dir, '..');
const targetIndex = process.argv.indexOf('--target');
const target = targetIndex < 0 ? undefined : process.argv[targetIndex + 1];
const androidTargets: Record<string, { arch: string; abi: string; openssl: string }> = {
  'aarch64-linux-android': { arch: 'arm64', abi: 'arm64-v8a', openssl: 'android-arm64' },
  'x86_64-linux-android': { arch: 'x64', abi: 'x86_64', openssl: 'android-x86_64' },
};
if (targetIndex >= 0 && !androidTargets[target || '']) throw new Error('Supported cross targets: aarch64-linux-android, x86_64-linux-android');
const android = target ? androidTargets[target] : undefined;
const base = path.join(root, 'src-tauri', 'target', 'native', android ? `android-${android.arch}` : `${process.platform}-${process.arch}`);
const source = path.join(base, `pjproject-${version}`);
const prefix = path.join(base, 'install');
async function run(args: string[], cwd = root, env: Record<string, string> = {}) {
  const child = Bun.spawn(args, { cwd, env: { ...process.env, ...env }, stdout: 'inherit', stderr: 'inherit' });
  if (await child.exited !== 0) throw new Error(`Native build failed: ${args[0]}`);
}

if (!['darwin', 'linux', 'win32'].includes(process.platform)) {
  throw new Error('Unsupported native build host');
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
if (process.platform === 'win32') {
  await run(['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'scripts/build-windows.ps1'), '-Source', source, '-Prefix', prefix]);
  process.exit(0);
}
let sslPrefix = process.env.DAAD_OPENSSL_PREFIX;
let crossEnv: Record<string, string> = {};
if (android) {
  const ndk = process.env.NDK_HOME || process.env.ANDROID_NDK_HOME || process.env.ANDROID_NDK_ROOT;
  if (!ndk) throw new Error('Set NDK_HOME to Android NDK r27 or later');
  const toolchain = path.join(ndk, 'toolchains/llvm/prebuilt', process.platform === 'darwin' ? 'darwin-x86_64' : 'linux-x86_64');
  crossEnv = {
    ANDROID_NDK_ROOT: ndk, TARGET_ABI: android.abi, APP_PLATFORM: '24',
    PATH: `${toolchain}/bin:${process.env.PATH}`,
    CFLAGS: '-fPIC -D__BIONIC_NO_PAGE_SIZE_MACRO',
    LDFLAGS: '-Wl,-z,max-page-size=16384',
  };
  // Build a matching static OpenSSL; a host library cannot be linked into Android.
  sslPrefix = path.join(base, 'openssl');
  if (!(await Bun.file(path.join(sslPrefix, 'lib/libssl.a')).exists())) {
    const sslVersion = '3.6.3';
    const sslArchive = path.join(base, `openssl-${sslVersion}.tar.gz`);
    if (!(await Bun.file(sslArchive).exists())) {
      const response = await fetch(`https://github.com/openssl/openssl/releases/download/openssl-${sslVersion}/openssl-${sslVersion}.tar.gz`);
      if (!response.ok) throw new Error(`OpenSSL download failed: HTTP ${response.status}`);
      await Bun.write(sslArchive, await response.arrayBuffer());
    }
    if (createHash('sha256').update(await Bun.file(sslArchive).bytes()).digest('hex') !== '243a86649cf6f23eeb6a2ff2456e09e5d77dd9018a54d3d96b0c6bdd6ba6c7f1') throw new Error('OpenSSL checksum mismatch');
    await run(['tar', '-xzf', sslArchive, '-C', base]);
    const sslSource = path.join(base, `openssl-${sslVersion}`);
    await run(['perl', 'Configure', android.openssl, 'no-shared', 'no-tests', '-D__ANDROID_API__=24', `--prefix=${sslPrefix}`, '--libdir=lib'], sslSource, crossEnv);
    await run(['make', `-j${process.env.DAAD_BUILD_JOBS || '4'}`], sslSource, crossEnv);
    await run(['make', 'install_sw'], sslSource, crossEnv);
  }
}
if (!sslPrefix && process.platform === 'darwin' && !android) {
  const brew = Bun.spawn(['brew', '--prefix', 'openssl@3'], { stdout: 'pipe', stderr: 'inherit' });
  sslPrefix = (await new Response(brew.stdout).text()).trim();
  if (await brew.exited !== 0) throw new Error('Install OpenSSL first: brew install openssl@3 pkg-config');
}
await writeFile(path.join(source, 'pjlib/include/pj/config_site.h'), [
  ...(android ? ['#define PJ_CONFIG_ANDROID 1', '#include <pj/config_site_sample.h>', '#define PJ_JNI_HAS_JNI_ONLOAD 0'] : []),
  '#define PJMEDIA_HAS_VIDEO 0', '',
].join('\n'));
await run([
  android ? './configure-android' : './configure', ...(android ? ['--use-ndk-cflags'] : []), `--prefix=${prefix}`, '--disable-video', '--disable-pjsua2',
  '--disable-opus', '--disable-libyuv', '--disable-ffmpeg', '--disable-vpx',
  '--disable-openh264', '--disable-sdl',
  ...(sslPrefix ? [`--with-ssl=${sslPrefix}`] : []),
], source, crossEnv);
await run(['make', 'dep'], source, crossEnv);
await run(['make', `-j${process.env.DAAD_BUILD_JOBS || '4'}`], source, crossEnv);
await run(['make', 'install'], source, crossEnv);
if (sslPrefix) {
  const pcPath = path.join(prefix, 'lib/pkgconfig/libpjproject.pc');
  const pc = await Bun.file(pcPath).text();
  await Bun.write(pcPath, pc.replace('Libs.private:', `Libs.private: -L${sslPrefix}/lib`));
}
console.log(`Native engine installed: ${prefix}`);
console.log('The adapter compile rejects builds missing TLS or SRTP.');
