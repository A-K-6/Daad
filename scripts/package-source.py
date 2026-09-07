"""Package corresponding source from a clean release checkout (macOS)."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile

root = Path(__file__).resolve().parents[1]
version = json.loads((root / 'package.json').read_text())['version']
out = root / 'src-tauri/target/release-sources'
out.mkdir(parents=True, exist_ok=True)

def run(*args, **kwargs):
    return subprocess.check_output(args, cwd=root, text=True, **kwargs).strip()

with tempfile.TemporaryDirectory(prefix='daad-source-') as temp:
    stage = Path(temp) / f'Daad-{version}-source'
    stage.mkdir()
    archive = Path(temp) / 'source.tar'
    subprocess.run(['git', 'archive', '--format=tar', '-o', str(archive), 'HEAD'], cwd=root, check=True)
    subprocess.run(['tar', '-xf', str(archive), '-C', str(stage)], check=True)
    config = run('cargo', 'vendor', '--locked', '--manifest-path', 'src-tauri/Cargo.toml', str(stage / 'vendor'))
    (stage / '.cargo').mkdir(exist_ok=True)
    (stage / '.cargo/config.toml').write_text(config.replace(str(stage / 'vendor'), 'vendor') + '\n')
    deps = stage / 'dependency-sources'
    deps.mkdir()
    pj = root / 'src-tauri/target/native/downloads/pjproject-2.17.tar.gz'
    assert hashlib.sha256(pj.read_bytes()).hexdigest() == '065fe06c06788d97c35f563796d59f00ce52fe9558a52d7b490a042a966facce'
    shutil.copy2(pj, deps)
    ssl_version = '3.6.3'
    ssl_name = f'openssl-{ssl_version}.tar.gz'
    ssl_source = root / 'src-tauri/target/native/downloads' / ssl_name
    expected = '243a86649cf6f23eeb6a2ff2456e09e5d77dd9018a54d3d96b0c6bdd6ba6c7f1'
    assert hashlib.sha256(ssl_source.read_bytes()).hexdigest() == expected
    shutil.copy2(ssl_source, deps / ssl_name)
    # Published npm distributions retain source, source maps, manifests and notices.
    with tarfile.open(deps / 'frontend-packages.tar.gz', 'w:gz') as tar:
        tar.add(root / 'node_modules', arcname='node_modules', filter=lambda info: None if '/.vite/' in info.name or '/.cache/' in info.name else info)
    (stage / 'SOURCE_BUILD.md').write_text(f'''# Source for Daad {version}
Commit: {run('git', 'rev-parse', 'HEAD')}

Toolchain: {run('rustc', '--version')}; Bun {run('bun', '--version')}.
OpenSSL: {ssl_version}. PJSIP: 2.17.

Rust dependencies and their licenses are in vendor; .cargo/config.toml selects them.
Frontend package distributions (including their notices) are in dependency-sources/frontend-packages.tar.gz.
Extract that archive here, or use bun install --frozen-lockfile.
Copy both dependency-sources/*.tar.gz native source archives to
src-tauri/target/native/downloads/ before native:prepare to avoid downloads.
Run bun run native:prepare <Rust-target-triple>, then the platform build command
in docs/PLATFORMS.md. The preparation script builds static OpenSSL and PJSIP.
See README.md, scripts/build-native.ts and THIRD_PARTY_NOTICES.md.
''')
    with tarfile.open(out / f'Daad_{version}_source.tar.gz', 'w:gz') as tar:
        tar.add(stage, arcname=stage.name)
print(out)
