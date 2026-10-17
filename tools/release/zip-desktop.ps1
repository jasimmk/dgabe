param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Destination
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$sourceDirectory = Get-Item -LiteralPath $Source
if (-not $sourceDirectory.PSIsContainer) { throw 'Archive source must be a directory' }
$parentPrefix = $sourceDirectory.Parent.FullName.TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
$archive = [IO.Compression.ZipFile]::Open($Destination, [IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($file in Get-ChildItem -LiteralPath $sourceDirectory.FullName -Recurse -File -Force | Sort-Object FullName) {
        # ZIP names are portable paths, not Windows filesystem paths.
        $entryName = $file.FullName.Substring($parentPrefix.Length).Replace('\', '/')
        [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
            $archive, $file.FullName, $entryName, [IO.Compression.CompressionLevel]::Optimal)
    }
} finally {
    $archive.Dispose()
}
