param([Parameter(Mandatory=$true)][string]$Source, [Parameter(Mandatory=$true)][string]$Prefix)
$ErrorActionPreference = 'Stop'
function Run([string]$Program, [string[]]$Arguments) {
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Program failed with exit code $LASTEXITCODE" }
}
if (!(Get-Command cl.exe -ErrorAction SilentlyContinue)) { throw 'Run native:prepare in an x64 Visual Studio Developer shell.' }
$base = Split-Path $Source
$ssl = Join-Path $base 'openssl'
if (!(Test-Path "$ssl/lib/libssl.lib")) {
    $archive = Join-Path $base 'openssl-3.6.3.tar.gz'
    if (!(Test-Path $archive)) {
        Invoke-WebRequest 'https://github.com/openssl/openssl/releases/download/openssl-3.6.3/openssl-3.6.3.tar.gz' -OutFile $archive
    }
    if ((Get-FileHash $archive -Algorithm SHA256).Hash.ToLower() -ne '243a86649cf6f23eeb6a2ff2456e09e5d77dd9018a54d3d96b0c6bdd6ba6c7f1') { throw 'OpenSSL checksum mismatch' }
    Run 'tar' @('-xzf', $archive, '-C', $base)
    Push-Location (Join-Path $base 'openssl-3.6.3')
    try {
        $perl = if (Test-Path 'C:/Strawberry/perl/bin/perl.exe') { 'C:/Strawberry/perl/bin/perl.exe' } else { 'perl' }
        Run $perl @('Configure', 'VC-WIN64A', 'no-shared', 'no-tests', 'no-asm', '-MD', "--prefix=$ssl", '--libdir=lib')
        Run 'nmake' @('/nologo')
        Run 'nmake' @('/nologo', 'install_sw')
    } finally { Pop-Location }
}
@'
#define PJMEDIA_HAS_VIDEO 0
#define PJ_HAS_SSL_SOCK 1
#define PJ_SSL_SOCK_IMP PJ_SSL_SOCK_IMP_OPENSSL
#define PJMEDIA_HAS_SRTP 1
'@ | Set-Content -Encoding ascii "$Source/pjlib/include/pj/config_site.h"
# Match Rust's dynamic MSVC runtime. /I comes through the compiler environment
# so every upstream VS project sees the same OpenSSL headers.
$oldCL = $env:CL
$env:CL = "$oldCL /I`"$ssl/include`""
try {
    # The standalone pjsua_lib target has no project references. The upstream
    # aggregate project builds its complete dependency graph.
    Run 'msbuild' @("$Source/pjproject-vs14.sln", '/m', '/t:libpjproject', '/p:Configuration=Release', '/p:Platform=x64', '/p:BuildToolset=v143', '/p:WindowsTargetPlatformVersion=10.0', '/verbosity:minimal')
} finally { $env:CL = $oldCL }
New-Item -ItemType Directory -Force $Prefix | Out-Null
$libs = @(Get-ChildItem $Source -Recurse -Filter '*-x64-vc14-Release.lib')
if ($libs.Count -lt 10) { throw 'PJSIP library build is incomplete' }
$manifest = @{
    includes = @('pjlib', 'pjlib-util', 'pjnath', 'pjmedia', 'pjsip') | ForEach-Object { "$Source/$_/include" }
    search = @($libs.DirectoryName | Sort-Object -Unique) + @("$ssl/lib")
    libraries = @($libs.BaseName | Sort-Object -Unique) + @('libssl', 'libcrypto')
}
$manifest.includes += "$ssl/include"
$manifest | ConvertTo-Json -Depth 4 | Set-Content -Encoding ascii "$Prefix/link.json"
