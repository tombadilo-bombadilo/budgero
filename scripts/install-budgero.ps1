param(
    [string]$Version,
    [string]$InstallDir,
    [switch]$Help
)

function Show-Usage {
    Write-Output @'
Budgero self-host installer (Windows)

Parameters:
  -Version <tag>     Version tag to install (e.g. v1.0.4 or 1.0.4). Defaults to latest.
  -InstallDir <dir>  Directory for budgero.exe (default: %LOCALAPPDATA%\Budgero).
  -Help              Display this help text.
'@
}

if ($Help) {
    Show-Usage
    exit 0
}

if (-not $IsWindows) {
    Write-Error "This script is intended for Windows environments."
    exit 1
}

$project = 'budgero'
$bucketHost = 'https://storage.googleapis.com/budgero_releases'
$latestPointer = "$bucketHost/latest.txt"
$versionExplicit = $false

if (-not $InstallDir -or $InstallDir.Trim().Length -eq 0) {
    $InstallDir = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Budgero'
}

if (-not $Version -or $Version.Trim().Length -eq 0) {
    Write-Output 'Determining latest version...'
    $cacheBust = [int][double]::Parse((Get-Date -UFormat %s))
    try {
        $Version = (Invoke-WebRequest -UseBasicParsing -Uri "$latestPointer?cb=$cacheBust").Content.Trim()
    } catch {
        Write-Error "Unable to determine latest version from $latestPointer"
        exit 1
    }
} else {
    $versionExplicit = $true
}

if (-not $Version) {
    Write-Error 'No version specified or discovered.'
    exit 1
}
if ($Version -notmatch '^v') {
    $Version = "v$Version"
}

$downloadPrefix = if ($versionExplicit) { "$bucketHost/$Version" } else { "$bucketHost/latest" }

$arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture
switch ($arch) {
    'X64'   { $archLabel = 'amd64' }
    'Arm64' { $archLabel = 'arm64' }
    default {
        Write-Error "Unsupported architecture: $arch"
        exit 1
    }
}

$targetBase = "${project}_windows_${archLabel}"
$suffixes = @('')
if ($archLabel -eq 'amd64') {
    $suffixes += '_v1'
} else {
    $suffixes += '_v8.0'
}

function Test-RemoteExists($url) {
    try {
        Invoke-WebRequest -UseBasicParsing -Method Head -Uri $url -ErrorAction Stop | Out-Null
        return $true
    } catch {
        return $false
    }
}

$artifact = $null
foreach ($suffix in $suffixes) {
    $candidate = "$targetBase$suffix/$project.exe"
    $url = "$downloadPrefix/$candidate"
    if (Test-RemoteExists $url) {
        $artifact = $url
        break
    }
}

if (-not $artifact) {
    Write-Error "Could not find an artifact for Windows/$archLabel at ${downloadPrefix}."
    exit 1
}

$tempFile = Join-Path ([IO.Path]::GetTempPath()) "budgero_$([guid]::NewGuid().ToString()).exe"
Write-Output "Downloading $project $Version for Windows/$archLabel..."
try {
    Invoke-WebRequest -Uri $artifact -OutFile $tempFile -UseBasicParsing
} catch {
    Write-Error "Failed to download $artifact"
    Remove-Item -ErrorAction SilentlyContinue $tempFile
    exit 1
}

if (-not (Test-Path $InstallDir)) {
    try {
        New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    } catch {
        Write-Error "Unable to create $InstallDir"
        Remove-Item -ErrorAction SilentlyContinue $tempFile
        exit 1
    }
}

$destination = Join-Path $InstallDir 'budgero.exe'
if (Test-Path $destination) {
    try {
        Remove-Item -Force $destination
    } catch {
        Write-Error "Unable to overwrite existing budgero.exe. Close any running instances and try again."
        Remove-Item -ErrorAction SilentlyContinue $tempFile
        exit 1
    }
}

try {
    Move-Item -Path $tempFile -Destination $destination -Force
} catch {
    Write-Error "Failed to install Budgero to $destination"
    Remove-Item -ErrorAction SilentlyContinue $tempFile
    exit 1
}

Write-Output "Budgero $Version installed to $destination"
Write-Output "Run 'budgero serve' from PowerShell or Command Prompt to start the server."

$pathEntries = ($env:PATH -split ';')
if (-not ($pathEntries | Where-Object { $_ -eq $InstallDir })) {
    Write-Output "Note: $InstallDir is not on your PATH. Add it to launch budgero.exe without specifying the full path."
}
