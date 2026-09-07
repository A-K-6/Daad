/** Target triples are the build identity, including simulator versus device. */
export const nativeTargets = {
  'aarch64-apple-darwin': { os: 'macos', arch: 'arm64', ssl: 'darwin64-arm64-cc' },
  'x86_64-apple-darwin': { os: 'macos', arch: 'x86_64', ssl: 'darwin64-x86_64-cc' },
  'x86_64-unknown-linux-gnu': { os: 'linux', arch: 'x86_64', ssl: 'linux-x86_64' },
  'aarch64-unknown-linux-gnu': { os: 'linux', arch: 'arm64', ssl: 'linux-aarch64' },
  'x86_64-pc-windows-msvc': { os: 'windows', arch: 'x86_64', ssl: 'VC-WIN64A', vs: 'x64' },
  'aarch64-pc-windows-msvc': { os: 'windows', arch: 'arm64', ssl: 'VC-WIN64-ARM', vs: 'ARM64' },
  'aarch64-linux-android': { os: 'android', arch: 'arm64', ssl: 'android-arm64', abi: 'arm64-v8a' },
  'armv7-linux-androideabi': { os: 'android', arch: 'arm', ssl: 'android-arm', abi: 'armeabi-v7a' },
  'x86_64-linux-android': { os: 'android', arch: 'x86_64', ssl: 'android-x86_64', abi: 'x86_64' },
  'aarch64-apple-ios': { os: 'ios', arch: 'arm64', ssl: 'ios64-xcrun', sdk: 'iphoneos' },
  'aarch64-apple-ios-sim': { os: 'ios', arch: 'arm64', ssl: 'iossimulator-arm64-xcrun', sdk: 'iphonesimulator' },
  'x86_64-apple-ios': { os: 'ios', arch: 'x86_64', ssl: 'iossimulator-x86_64-xcrun', sdk: 'iphonesimulator' },
} as const;
export type NativeTarget = keyof typeof nativeTargets;
export function resolveTarget(value: string): NativeTarget {
  if (!Object.hasOwn(nativeTargets, value)) throw new Error(`Unsupported native target: ${value}`);
  return value as NativeTarget;
}
