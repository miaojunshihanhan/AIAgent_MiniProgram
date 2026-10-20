$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$backendRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$target = Join-Path $backendRoot 'cloudrun-upload.zip'
$temp = Join-Path $backendRoot 'cloudrun-upload.tmp.zip'
$files = @(Get-ChildItem -LiteralPath (Join-Path $backendRoot 'src') -Filter '*.js' -File)
foreach ($name in @('Dockerfile', '.dockerignore', 'package.json', 'package-lock.json')) {
    $files += Get-Item -LiteralPath (Join-Path $backendRoot $name)
}
if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp }
$archive = [IO.Compression.ZipFile]::Open($temp, [IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($file in $files) {
        $entry = $file.FullName.Substring($backendRoot.Length + 1).Replace('\', '/')
        [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $file.FullName, $entry) | Out-Null
    }
} finally { $archive.Dispose() }
$archive = [IO.Compression.ZipFile]::OpenRead($temp)
try {
    foreach ($required in @('src/context.js', 'src/jobs.js', 'src/server.js', 'src/model.js', 'Dockerfile')) {
        if (-not $archive.GetEntry($required)) { throw "Missing deployment file: $required" }
    }
    foreach ($name in @('src/model.js', 'src/server.js')) {
        $reader = [IO.StreamReader]::new($archive.GetEntry($name).Open())
        try {
            $source = $reader.ReadToEnd()
            $oldRefusal = -join (@(0x73B0,0x6709,0x6750,0x6599,0x4E2D,0x672A,0x68C0,0x7D22,0x5230,0x8DB3,0x591F,0x4F9D,0x636E) | ForEach-Object { [char]$_ })
            if ($source.Contains($oldRefusal)) { throw "Old refusal code in $name" }
            if ($name -eq 'src/model.js' -and -not $source.Contains('materialTools')) { throw 'Missing model material tools' }
        } finally { $reader.Dispose() }
    }
} finally { $archive.Dispose() }
Move-Item -LiteralPath $temp -Destination $target -Force
Write-Output "Deployment package verified: $target"
Write-Output ('SHA256: ' + (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash)
