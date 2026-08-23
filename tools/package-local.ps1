$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
& npm run build
if ($LASTEXITCODE -ne 0) { throw 'Game build failed; local package was not created.' }

$releaseRoot = Join-Path $repoRoot 'release'
$packageRoot = Join-Path $releaseRoot 'the-bro-drive'
$zipPath = Join-Path $releaseRoot 'the-bro-drive.zip'

Remove-Item -LiteralPath $packageRoot -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $packageRoot -Force | Out-Null

Copy-Item -LiteralPath (Join-Path $repoRoot 'dist') -Destination (Join-Path $packageRoot 'dist') -Recurse
Copy-Item -LiteralPath (Join-Path $repoRoot 'Start the BRO drive.bat') -Destination $packageRoot
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'start-local.ps1') -Destination (Join-Path $packageRoot 'start-local.ps1')

Compress-Archive -Path (Join-Path $packageRoot '*') -DestinationPath $zipPath -CompressionLevel Optimal
Write-Host "Created $zipPath" -ForegroundColor Green
