$ErrorActionPreference = 'Stop'

$packageRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$distRoot = Join-Path $packageRoot 'dist'
if (-not (Test-Path -LiteralPath $distRoot -PathType Container)) {
  Write-Host 'Missing dist folder. Rebuild the shared package before starting it.' -ForegroundColor Red
  Read-Host 'Press Enter to close'
  exit 1
}

$prefix = 'http://127.0.0.1:4173/'
$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add($prefix)

$contentTypes = @{
  '.css' = 'text/css; charset=utf-8'
  '.html' = 'text/html; charset=utf-8'
  '.ico' = 'image/x-icon'
  '.js' = 'text/javascript; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.svg' = 'image/svg+xml'
  '.webp' = 'image/webp'
  '.woff2' = 'font/woff2'
}

try {
  $listener.Start()
  Start-Process $prefix
  Write-Host 'the BRO drive is running at http://127.0.0.1:4173/' -ForegroundColor Green
  Write-Host 'Keep this window open while playing. Press Ctrl+C to stop the game.'

  $basePath = [System.IO.Path]::GetFullPath($distRoot)
  if (-not $basePath.EndsWith([System.IO.Path]::DirectorySeparatorChar)) {
    $basePath += [System.IO.Path]::DirectorySeparatorChar
  }

  while ($listener.IsListening) {
    $context = $listener.GetContext()
    $relative = [System.Uri]::UnescapeDataString($context.Request.Url.AbsolutePath.TrimStart('/'))
    if ([string]::IsNullOrWhiteSpace($relative)) { $relative = 'index.html' }
    $relative = $relative.Replace('/', [System.IO.Path]::DirectorySeparatorChar)
    $filePath = [System.IO.Path]::GetFullPath((Join-Path $distRoot $relative))

    if (-not $filePath.StartsWith($basePath, [System.StringComparison]::OrdinalIgnoreCase)) {
      $context.Response.StatusCode = 403
      $context.Response.Close()
      continue
    }
    if (-not (Test-Path -LiteralPath $filePath -PathType Leaf)) {
      $context.Response.StatusCode = 404
      $context.Response.Close()
      continue
    }

    $bytes = [System.IO.File]::ReadAllBytes($filePath)
    $extension = [System.IO.Path]::GetExtension($filePath).ToLowerInvariant()
    $contentType = $contentTypes[$extension]
    if ($null -eq $contentType) { $contentType = 'application/octet-stream' }
    $context.Response.ContentType = $contentType
    $context.Response.ContentLength64 = $bytes.Length
    $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    $context.Response.Close()
  }
} finally {
  if ($listener.IsListening) { $listener.Stop() }
  $listener.Close()
}
