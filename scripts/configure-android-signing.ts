/** Configure a generated Tauri Android project without writing passwords to disk. */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

for (const key of ['ANDROID_KEYSTORE_BASE64', 'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_PASSWORD', 'ANDROID_KEY_ALIAS']) {
  if (!process.env[key]) throw new Error(`Release signing requires ${key}`);
}
const root = path.resolve(import.meta.dir, '../src-tauri/gen/android');
const gradlePath = path.join(root, 'app/build.gradle.kts');
const gradle = await Bun.file(gradlePath).text();
if (gradle.includes('// Daad release signing')) throw new Error('Release signing is already configured; initialize a clean Android project.');
await writeFile(path.join(root, 'daad-release.jks'), Buffer.from(process.env.ANDROID_KEYSTORE_BASE64!, 'base64'), { mode: 0o600 });
await Bun.write(gradlePath, gradle + `
// Daad release signing: passwords are supplied only through the build environment.
android {
    signingConfigs {
        create("release") {
            storeFile = rootProject.file("daad-release.jks")
            storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
            keyAlias = System.getenv("ANDROID_KEY_ALIAS")
            keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
        }
    }
    buildTypes.getByName("release") {
        signingConfig = signingConfigs.getByName("release")
    }
}
`);
