/** Reproducible target-specific PJSIP + static OpenSSL; Cargo never downloads. */
import { createHash } from 'node:crypto';
import { cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { nativeTargets, resolveTarget } from './native-targets';

const root = path.resolve(import.meta.dir, '..');
const host = Bun.spawnSync(['rustc', '-vV']).stdout.toString().match(/^host: (.+)$/m)?.[1];
const target = resolveTarget(process.argv[2] || process.env.DAAD_NATIVE_TARGET || host || '');
const spec = nativeTargets[target];
if ((spec.os === 'macos' || spec.os === 'ios') && process.platform !== 'darwin') throw new Error('Apple targets require macOS and Xcode.');
if (spec.os === 'windows' && process.platform !== 'win32') throw new Error('Windows targets require a Visual Studio developer shell.');
if (spec.os === 'linux' && host !== target) throw new Error('Build Linux on a runner matching the target architecture.');
const base = path.join(root, 'src-tauri/target/native', target);
const prefix = path.join(base, 'install');
const sslPrefix = path.join(base, 'openssl');
const cache = path.join(root, 'src-tauri/target/native/downloads');
const version = '2.17';
const sslVersion = '3.6.3';
const stamp = JSON.stringify({ target, version, sslVersion, recipe: 1 });
if (await Bun.file(path.join(prefix, 'build-stamp.json')).text().catch(() => '') === stamp) {
  console.log(`Native engine already prepared: ${target}`);
  process.exit(0);
}
await mkdir(base, { recursive: true });
await mkdir(cache, { recursive: true });
async function run(args: string[], cwd = root, env: Record<string, string> = {}) {
  const child = Bun.spawn(args, { cwd, env: { ...process.env, ...env }, stdout: 'inherit', stderr: 'inherit' });
  if (await child.exited !== 0) throw new Error(`Native build failed: ${args.join(' ')}`);
}
async function unpack(name: string, url: string, digest: string) {
  const archive = path.join(cache, `${name}.tar.gz`);
  if (!await Bun.file(archive).exists()) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
    await Bun.write(archive, await response.arrayBuffer());
  }
  if (createHash('sha256').update(await Bun.file(archive).bytes()).digest('hex') !== digest) throw new Error(`Source checksum mismatch: ${name}`);
  await rm(path.join(base, name), { recursive: true, force: true });
  await run(['tar', '-xzf', archive, '-C', base]);
  return path.join(base, name);
}
const source = await unpack(`pjproject-${version}`, `https://github.com/pjsip/pjproject/archive/refs/tags/${version}.tar.gz`, '065fe06c06788d97c35f563796d59f00ce52fe9558a52d7b490a042a966facce');
const sslSource = await unpack(`openssl-${sslVersion}`, `https://github.com/openssl/openssl/releases/download/openssl-${sslVersion}/openssl-${sslVersion}.tar.gz`, '243a86649cf6f23eeb6a2ff2456e09e5d77dd9018a54d3d96b0c6bdd6ba6c7f1');
const env: Record<string, string> = {};
let configure = './configure';
let config = '#define PJMEDIA_HAS_VIDEO 0\n';
const extra: string[] = [];
if (spec.os === 'macos') {
  env.CFLAGS = `-arch ${spec.arch} -mmacosx-version-min=11.0`;
  env.LDFLAGS = env.CFLAGS;
  env.MACOSX_DEPLOYMENT_TARGET = '11.0';
  extra.push(`--host=${spec.arch === 'arm64' ? 'aarch64' : 'x86_64'}-apple-darwin`);
}
if (spec.os === 'ios' && 'sdk' in spec) {
  configure = './configure-iphone';
  const developer = Bun.spawnSync(['xcode-select', '-p']).stdout.toString().trim();
  env.DEVPATH = `${developer}/Platforms/${spec.sdk === 'iphoneos' ? 'iPhoneOS' : 'iPhoneSimulator'}.platform/Developer`;
  env.ARCH = `-arch ${spec.arch}`;
  env.MIN_IOS = spec.sdk === 'iphoneos' ? '-miphoneos-version-min=14.0' : '-mios-simulator-version-min=14.0';
  env.IPHONEOS_DEPLOYMENT_TARGET = '14.0';
  config = '#define PJ_CONFIG_IPHONE 1\n#include <pj/config_site_sample.h>\n' + config;
}
if (spec.os === 'android' && 'abi' in spec) {
  const ndk = process.env.ANDROID_NDK_HOME || process.env.NDK_HOME;
  if (!ndk) throw new Error('Set ANDROID_NDK_HOME to NDK r28 or newer.');
  env.ANDROID_NDK_ROOT = ndk;
  const hostTag = process.platform === 'darwin' ? 'darwin-x86_64' : 'linux-x86_64';
  env.PATH = `${ndk}/toolchains/llvm/prebuilt/${hostTag}/bin${path.delimiter}${process.env.PATH}`;
  env.APP_PLATFORM = '24';
  env.TARGET_ABI = spec.abi;
  env.CFLAGS = '-fPIC';
  env.LDFLAGS = '-Wl,-z,max-page-size=16384';
  configure = './configure-android';
  extra.push('--use-ndk-cflags');
  config = '#define PJ_CONFIG_ANDROID 1\n#include <pj/config_site_sample.h>\n#undef PJMEDIA_AUDIO_DEV_HAS_ANDROID_JNI\n#define PJMEDIA_AUDIO_DEV_HAS_ANDROID_JNI 0\n#undef PJMEDIA_AUDIO_DEV_HAS_OPENSL\n#define PJMEDIA_AUDIO_DEV_HAS_OPENSL 1\n' + config;
}
const sslArgs = ['perl', 'Configure', spec.ssl, `--prefix=${sslPrefix}`, '--libdir=lib', 'no-shared', 'no-tests', 'no-module', 'no-asm'];
if (spec.os === 'android') sslArgs.push('-D__ANDROID_API__=24');
await run(sslArgs, sslSource, env);
const jobs = `-j${process.env.DAAD_BUILD_JOBS || '4'}`;
await run(spec.os === 'windows' ? ['nmake', 'build_libs'] : ['make', jobs, 'build_libs'], sslSource, env);
await run([spec.os === 'windows' ? 'nmake' : 'make', 'install_dev'], sslSource, env);
if (spec.os === 'windows' && 'vs' in spec) {
  config += '#define PJ_HAS_SSL_SOCK 1\n#define PJ_SSL_SOCK_IMP PJ_SSL_SOCK_IMP_OPENSSL\n';
  await writeFile(path.join(source, 'pjlib/include/pj/config_site.h'), config);
  env.INCLUDE = `${sslPrefix}/include;${process.env.INCLUDE || ''}`;
  env.LIB = `${sslPrefix}/lib;${process.env.LIB || ''}`;
  await run(['msbuild', 'pjproject-vs14.sln', '/m', '/t:pjsua', '/p:Configuration=Release', `/p:Platform=${spec.vs}`, '/p:WindowsTargetPlatformVersion=10.0'], source, env);
  await mkdir(path.join(prefix, 'lib'), { recursive: true });
  for (const folder of ['pjlib', 'pjlib-util', 'pjnath', 'pjmedia', 'pjsip']) {
    await cp(path.join(source, folder, 'include'), path.join(prefix, 'include'), { recursive: true });
  }
  const libraries: string[] = [];
  for (const folder of ['pjlib', 'pjlib-util', 'pjnath', 'pjmedia', 'pjsip', 'third_party']) {
    for (const file of await readdir(path.join(source, folder, 'lib'))) {
      if (!file.endsWith(`-${spec.vs}-vc14-Release.lib`)) continue;
      await cp(path.join(source, folder, 'lib', file), path.join(prefix, 'lib', file));
      libraries.push(file.slice(0, -4));
    }
  }
  if (!libraries.some(name => name.startsWith('pjsua-lib-'))) throw new Error('PJSUA static library missing');
  await writeFile(path.join(prefix, 'windows-libs.json'), JSON.stringify(libraries));
} else {
  await writeFile(path.join(source, 'pjlib/include/pj/config_site.h'), config);
  await run([configure, `--prefix=${prefix}`, `--with-ssl=${sslPrefix}`, '--disable-video', '--disable-pjsua2', '--disable-opus', '--disable-libyuv', '--disable-ffmpeg', '--disable-vpx', '--disable-openh264', '--disable-sdl', ...extra], source, env);
  await run(['make', 'dep'], source, env);
  await run(['make', jobs, 'lib'], source, env);
  await run(['make', 'install'], source, env);
  const pcPath = path.join(prefix, 'lib/pkgconfig/libpjproject.pc');
  const pc = await Bun.file(pcPath).text();
  await Bun.write(pcPath, pc.replace('Libs.private:', `Libs.private: -L${sslPrefix}/lib`));
}
await writeFile(path.join(prefix, 'build-stamp.json'), stamp);
console.log(`Native engine installed: ${prefix}`);
