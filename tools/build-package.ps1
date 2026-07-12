$ErrorActionPreference = "Stop"

$Root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$PackageJson = Get-Content -LiteralPath (Join-Path $Root "package.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$Version = [string]$PackageJson.version
if ($Version.StartsWith("v")) {
    $Version = $Version.Substring(1)
}

$LocalReleaseDirPath = Join-Path $Root "..\..\releases"
if (Test-Path -LiteralPath (Join-Path $Root "..\..\.ecosystem-root")) {
    $ReleaseDirPath = $LocalReleaseDirPath
} elseif (Test-Path -LiteralPath (Join-Path $Root "..\..\scripts\github-upload-project.ps1")) {
    $ReleaseDirPath = $LocalReleaseDirPath
} else {
    $ReleaseDirPath = Join-Path $Root "releases"
}
New-Item -ItemType Directory -Force -Path $ReleaseDirPath | Out-Null
$ReleaseDir = (Resolve-Path -LiteralPath $ReleaseDirPath).Path
$PackageDir = Join-Path $Root "package\ddys-download-bridge"
$Zip = Join-Path $ReleaseDir ("ddys-download-bridge-v{0}.zip" -f $Version)
$ShaFile = "$Zip.sha256"

function Assert-InRoot {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Base
    )

    $full = [System.IO.Path]::GetFullPath($Path)
    $separator = [System.IO.Path]::DirectorySeparatorChar
    $baseFull = [System.IO.Path]::GetFullPath($Base).TrimEnd([char[]]@("\", "/")) + $separator
    if (-not $full.StartsWith($baseFull, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to operate outside project root: $full"
    }
}

function Get-RelativePathCompat {
    param(
        [Parameter(Mandatory = $true)][string]$Base,
        [Parameter(Mandatory = $true)][string]$Path
    )

    $separator = [System.IO.Path]::DirectorySeparatorChar
    $basePath = [System.IO.Path]::GetFullPath($Base).TrimEnd([char[]]@("\", "/")) + $separator
    $baseUri = New-Object System.Uri($basePath)
    $fileUri = New-Object System.Uri([System.IO.Path]::GetFullPath($Path))
    return [System.Uri]::UnescapeDataString($baseUri.MakeRelativeUri($fileUri).ToString()).Replace("/", $separator)
}

Assert-InRoot -Path $PackageDir -Base $Root
if (Test-Path -LiteralPath $PackageDir) {
    Remove-Item -LiteralPath $PackageDir -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $PackageDir | Out-Null

$excludeSegments = @(".git", ".wrangler", "node_modules", "dist", "build", "coverage", "package", "bin-output", "obj", "releases")
$files = Get-ChildItem -LiteralPath $Root -Recurse -Force -File | Where-Object {
    $relative = (Get-RelativePathCompat -Base $Root -Path $_.FullName).Replace("\", "/")
    $segments = $relative -split "/"
    foreach ($segment in $segments) {
        if ($segment -in $excludeSegments) {
            return $false
        }
    }

    if ($_.Name -match "^\.env" -and $_.Name -ne ".env.example") {
        return $false
    }
    if ($_.Name -match "\.(log|tmp|cache|zip|tgz)$") {
        return $false
    }
    return $true
}

foreach ($file in $files) {
    $relative = Get-RelativePathCompat -Base $Root -Path $file.FullName
    $target = Join-Path $PackageDir $relative
    New-Item -ItemType Directory -Force -Path ([System.IO.Path]::GetDirectoryName($target)) | Out-Null
    Copy-Item -LiteralPath $file.FullName -Destination $target -Force
}

if (Test-Path -LiteralPath $Zip) {
    Remove-Item -LiteralPath $Zip -Force
}
if (Test-Path -LiteralPath $ShaFile) {
    Remove-Item -LiteralPath $ShaFile -Force
}

$packageItems = Get-ChildItem -LiteralPath $PackageDir -Force
Compress-Archive -Path $packageItems.FullName -DestinationPath $Zip -Force
$Hash = (Get-FileHash -LiteralPath $Zip -Algorithm SHA256).Hash
Set-Content -LiteralPath $ShaFile -Value "$Hash  $(Split-Path -Leaf $Zip)" -Encoding ASCII

[pscustomobject]@{
    ok = $true
    package = $Zip
    sha256 = $Hash
    files = @($files).Count
} | ConvertTo-Json -Depth 3
