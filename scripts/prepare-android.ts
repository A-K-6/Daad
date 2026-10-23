/** Reproducible changes to the generated Android shell. Never writes signing secrets. */
import path from 'node:path';
const root = path.resolve(import.meta.dir, '..');
const android = path.join(root, 'src-tauri/gen/android');
if (!(await Bun.file(path.join(android, 'settings.gradle')).exists()) && !(await Bun.file(path.join(android, 'settings.gradle.kts')).exists())) {
  const child = Bun.spawn(['bun', 'run', 'tauri', 'android', 'init', '--ci', '--skip-targets-install'], { cwd: root, stdout: 'inherit', stderr: 'inherit' });
  if (await child.exited !== 0) throw new Error('Android initialization failed');
}
const manifest = path.join(android, 'app/src/main/AndroidManifest.xml');
let xml = await Bun.file(manifest).text();
// Encrypted account blobs must not be restored without their device Keystore key.
xml = xml.replace(/android:allowBackup="[^"]*"/, 'android:allowBackup="false"');
if (!xml.includes('android:allowBackup=')) xml = xml.replace('<application', '<application android:allowBackup="false"');
await Bun.write(manifest, xml);
const gradle = path.join(android, 'app/build.gradle.kts');
let source = await Bun.file(gradle).text();
if (!source.includes('// Daad release signing')) {
  source += `
// Daad release signing: values come from the CI environment, never source files.
android {
    if (System.getenv("DAAD_ANDROID_KEYSTORE") != null) {
        signingConfigs {
            create("daadRelease") {
                storeFile = file(System.getenv("DAAD_ANDROID_KEYSTORE"))
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
            }
        }
        buildTypes.getByName("release") { signingConfig = signingConfigs.getByName("daadRelease") }
    }
}
`;
  await Bun.write(gradle, source);
}
