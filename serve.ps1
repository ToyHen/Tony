param(
    # Falls back to the PORT environment variable so two sessions can each run
    # their own preview without fighting over 5500.
    [int]$Port = $(if ($env:PORT) { [int]$env:PORT } else { 5500 }),
    [string]$Root = $PSScriptRoot
)

Add-Type -AssemblyName System.Net.HttpListener -ErrorAction SilentlyContinue

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Serving $Root at http://localhost:$Port/"

$mimeMap = @{
    ".html" = "text/html"
    ".css"  = "text/css"
    ".js"   = "application/javascript"
    ".jpg"  = "image/jpeg"
    ".jpeg" = "image/jpeg"
    ".png"  = "image/png"
    ".svg"  = "image/svg+xml"
    ".ico"  = "image/x-icon"
    ".mp4"  = "video/mp4"
    ".json" = "application/json"
}

while ($listener.IsListening) {
    $context = $listener.GetContext()
    $request = $context.Request
    $response = $context.Response
    try {
        $path = $request.Url.AbsolutePath
        if ($path -eq "/") { $path = "/index.html" }
        $filePath = Join-Path $Root ($path.TrimStart("/") -replace "/", "\")

        if (Test-Path $filePath -PathType Leaf) {
            $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
            $contentType = $mimeMap[$ext]
            if (-not $contentType) { $contentType = "application/octet-stream" }
            $bytes = [System.IO.File]::ReadAllBytes($filePath)
            $response.ContentType = $contentType

            # Byte ranges. Without these a browser will download a video happily
            # but report an EMPTY seekable range, so setting currentTime does
            # nothing and the frame stepper cannot move. GitHub Pages serves
            # ranges, so this only ever bites in local preview.
            $response.AddHeader("Accept-Ranges", "bytes")

            $start = 0
            $end = $bytes.Length - 1
            $partial = $false
            $rangeHeader = $request.Headers["Range"]
            if ($rangeHeader -match '^bytes=(\d*)-(\d*)$') {
                $s = $matches[1]
                $e = $matches[2]
                if ($s -ne '') {
                    $start = [int64]$s
                    if ($e -ne '') { $end = [int64]$e }
                } elseif ($e -ne '') {
                    $start = [Math]::Max(0, $bytes.Length - [int64]$e)   # bytes=-N
                }
                if ($end -gt $bytes.Length - 1) { $end = $bytes.Length - 1 }
                if ($start -le $end -and $start -lt $bytes.Length) { $partial = $true }
            }

            # HEAD gets the headers and nothing else — writing a body to one
            # throws, which surfaced as a 500 on every asset during a link check.
            $isHead = $request.HttpMethod -eq "HEAD"

            if ($partial) {
                $len = [int]($end - $start + 1)
                $response.StatusCode = 206
                $response.AddHeader("Content-Range", "bytes $start-$end/$($bytes.Length)")
                $response.ContentLength64 = $len
                if (-not $isHead) { $response.OutputStream.Write($bytes, [int]$start, $len) }
            } else {
                $response.ContentLength64 = $bytes.Length
                if (-not $isHead) { $response.OutputStream.Write($bytes, 0, $bytes.Length) }
            }
        } else {
            $response.StatusCode = 404
            $notFound = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found: $path")
            $response.OutputStream.Write($notFound, 0, $notFound.Length)
        }
    } catch {
        $response.StatusCode = 500
    } finally {
        $response.OutputStream.Close()
    }
}
