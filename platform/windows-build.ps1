$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
cargo build --locked --release --target x86_64-pc-windows-msvc
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Output 'Built target/x86_64-pc-windows-msvc/release/dangerous-gabe.exe'
