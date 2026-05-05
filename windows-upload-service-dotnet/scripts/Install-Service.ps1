#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Registers WasteZero.WindowsUploadService as a Windows Service (optionally publish+copy first).

.PARAMETER InstallPath
  Folder containing the published executable and appsettings*.json (no trailing backslash).
  Defaults to: C:\Program Files\WasteZero\WindowsUploadService

.PARAMETER ServiceName
  Internal service name (sc.exe / Get-Service name).

.PARAMETER DisplayName
  Friendly name shown in services.msc.

.PARAMETER ServiceAccount
  Account the service runs as. Examples:
    LocalSystem (default): "LocalSystem"
    Local Service: "NT AUTHORITY\LOCAL SERVICE"
    Network Service: "NT AUTHORITY\NETWORK SERVICE"
    Virtual service account: "NT SERVICE\WasteZeroUpload" (must match ServiceName for clarity)

.PARAMETER SkipFailureRecovery
  When set, skips sc.exe failure configuration. By default the script configures Windows to restart
  the service after the process exits unexpectedly (crash, unhandled exception, kill).

.PARAMETER DelayedAutoStart
  When true, sets start type to delayed-auto so the service starts after other automatic services
  (useful if outbound HTTPS or DNS must be ready right after machine boot).

.PARAMETER PublishAndCopy
  When set, runs `dotnet publish` and copies publish output to InstallPath before service registration.
  Use this for one-command non-development installs/updates.

.PARAMETER ProjectPath
  Path to WasteZero.WindowsUploadService.csproj used with -PublishAndCopy.
  Defaults to the project path relative to this scripts folder.

.PARAMETER PublishConfiguration
  Build configuration for publish when -PublishAndCopy is used. Default: Release.

.PARAMETER Runtime
  Runtime identifier used for publish when -PublishAndCopy is used. Default: win-x64.

.PARAMETER SelfContained
  Publish self-contained output (no runtime preinstall needed) when -PublishAndCopy is used.
  When omitted, publish is framework-dependent.

.EXAMPLE
  .\Install-Service.ps1

.EXAMPLE
  .\Install-Service.ps1 -InstallPath "D:\Apps\WasteZero\WindowsUploadService"

.EXAMPLE
  .\Install-Service.ps1 -PublishAndCopy
#>
param(
    [string] $InstallPath = "C:\Program Files\WasteZero\WindowsUploadService",

    [string] $ServiceName = "WasteZeroUpload",

    [string] $DisplayName = "WasteZero Windows Upload",

    [string] $ServiceAccount = "LocalSystem",

    [string] $Description = "Watches log directories and uploads .txt/.csv files to the WasteZero ingest API.",

    [switch] $SkipFailureRecovery,

    [switch] $DelayedAutoStart,

    [switch] $PublishAndCopy,

    [string] $ProjectPath = (Join-Path $PSScriptRoot "..\src\WasteZero.WindowsUploadService\WasteZero.WindowsUploadService.csproj"),

    [string] $PublishConfiguration = "Release",

    [string] $Runtime = "win-x64",

    [switch] $SelfContained
)

$ErrorActionPreference = "Stop"
$InstallPath = $InstallPath.TrimEnd('\', '/')
$exe = Join-Path $InstallPath "WasteZero.WindowsUploadService.exe"

if ($PublishAndCopy) {
    if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) {
        throw "dotnet SDK not found in PATH. Install .NET SDK or publish on another machine and copy output to InstallPath."
    }

    $resolvedProjectPath = [System.IO.Path]::GetFullPath($ProjectPath)
    if (-not (Test-Path -LiteralPath $resolvedProjectPath)) {
        throw "Project file not found: $resolvedProjectPath. Pass -ProjectPath to WasteZero.WindowsUploadService.csproj."
    }

    $publishOut = Join-Path ([System.IO.Path]::GetTempPath()) "WasteZero.WindowsUploadService.publish"
    if (Test-Path -LiteralPath $publishOut) {
        Remove-Item -LiteralPath $publishOut -Recurse -Force
    }
    New-Item -ItemType Directory -Path $publishOut -Force | Out-Null
    New-Item -ItemType Directory -Path $InstallPath -Force | Out-Null

    $selfContainedValue = if ($SelfContained) { "true" } else { "false" }
    Write-Host "Publishing service..."
    & dotnet publish $resolvedProjectPath -c $PublishConfiguration -r $Runtime --self-contained $selfContainedValue -o $publishOut
    if ($LASTEXITCODE -ne 0) {
        throw "dotnet publish failed with exit code $LASTEXITCODE"
    }

    Write-Host "Copying published output to $InstallPath..."
    Copy-Item (Join-Path $publishOut "*") $InstallPath -Recurse -Force
}

if (-not (Test-Path -LiteralPath $exe)) {
    throw "Executable not found: $exe. Publish/copy the service output there first, or run this script with -PublishAndCopy."
}

$binPath = "`"$exe`""
$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
    throw "Service '$ServiceName' already exists. Stop it, then run Uninstall-Service.ps1, or pick a different -ServiceName."
}

Write-Host "Creating service $ServiceName..."
New-Service -Name $ServiceName `
    -BinaryPathName $binPath `
    -DisplayName $DisplayName `
    -Description $Description `
    -StartupType Automatic | Out-Null

# Run as specified account (LocalSystem is the default for New-Service when not using -Credential)
if ($ServiceAccount -and $ServiceAccount -ne "LocalSystem") {
    # sc.exe requires a space after '='. Built-in and virtual service accounts use an empty password.
    & sc.exe config $ServiceName obj= "$ServiceAccount" password= ""
    if ($LASTEXITCODE -ne 0) {
        throw "sc.exe config failed with exit code $LASTEXITCODE. If you use a domain account, set the password via Services.msc or sc.exe manually."
    }
}

if ($DelayedAutoStart) {
    Write-Host "Setting start type to delayed-auto..."
    & sc.exe config $ServiceName start= delayed-auto
    if ($LASTEXITCODE -ne 0) {
        throw "sc.exe config start= delayed-auto failed with exit code $LASTEXITCODE"
    }
}

if (-not $SkipFailureRecovery) {
    # Restart after unexpected process exit. Delays in milliseconds. reset= seconds before failure count resets.
    Write-Host "Configuring service recovery (restart on failure)..."
    & sc.exe failure $ServiceName reset= 86400 actions= restart/60000/restart/120000/restart/300000
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "sc.exe failure returned exit code $LASTEXITCODE. Set recovery manually: services.msc -> $DisplayName -> Recovery."
    }
    else {
        & sc.exe failureflag $ServiceName 1 | Out-Null
        if ($LASTEXITCODE -ne 0) {
            Write-Warning "sc.exe failureflag returned exit code $LASTEXITCODE (recovery restarts are usually still active)."
        }
    }
}

Write-Host "Starting service..."
Start-Service -Name $ServiceName
Write-Host "Done. Service '$ServiceName' is running. Logs: $(Join-Path $InstallPath 'logs\service.log'). Configure UploadService in appsettings or env vars."
if (-not $SkipFailureRecovery) {
    Write-Host "Recovery: first three process failures trigger automatic restart (see app docs: Windows Upload Service)."
}
Write-Host "Event Viewer: Windows Logs -> Application (source WasteZeroUpload when registered)."
