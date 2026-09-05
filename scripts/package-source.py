"""Package corresponding source from a clean release checkout (macOS)."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import urllib.request

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
    pj = root / 'src-tauri/target/native/darwin-arm64/pjproject-2.17.tar.gz'
    assert hashlib.sha256(pj.read_bytes()).hexdigest() == '065fe06c06788d97c35f563796d59f00ce52fe9558a52d7b490a042a966facce'
    shutil.copy2(pj, deps)
    ssl_prefix = run('brew', '--prefix', 'openssl@3')
    ssl_version = run(str(Path(ssl_prefix) / 'bin/openssl'), 'version').split()[1]
    ssl_name = f'openssl-{ssl_version}.tar.gz'
    url = f'https://github.com/openssl/openssl/releases/download/openssl-{ssl_version}/{ssl_name}'
    urllib.request.urlretrieve(url, deps / ssl_name)
    urllib.request.urlretrieve(url + '.sha256', deps / (ssl_name + '.sha256'))
    expected = (deps / (ssl_name + '.sha256')).read_text().split()[0]
    assert hashlib.sha256((deps / ssl_name).read_bytes()).hexdigest() == expected
    (deps / 'openssl-homebrew-formula.json').write_text(run('brew', 'info', '--json=v2', 'openssl@3'))
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
Build/install the included OpenSSL source with ./Configure --prefix=/your/openssl && make && make install_sw.
Set DAAD_OPENSSL_PREFIX to that installation when running bun run native:prepare.
To avoid downloading PJSIP, copy dependency-sources/pjproject-2.17.tar.gz to
src-tauri/target/native/darwin-arm64/pjproject-2.17.tar.gz before native:prepare.
Then run bun run tauri build --target aarch64-apple-darwin.
See README.md, scripts/build-native.ts and THIRD_PARTY_NOTICES.md.
''')
    with tarfile.open(out / f'Daad_{version}_source.tar.gz', 'w:gz') as tar:
        tar.add(stage, arcname=stage.name)
print(out)
