#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Registers WasteZero.WindowsUploadService as a Windows Service.

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

.EXAMPLE
  .\Install-Service.ps1

.EXAMPLE
  .\Install-Service.ps1 -InstallPath "D:\Apps\WasteZero\WindowsUploadService"
#>
param(
    [string] $InstallPath = "C:\Program Files\WasteZero\WindowsUploadService",

    [string] $ServiceName = "WasteZeroUpload",

    [string] $DisplayName = "WasteZero Windows Upload",

    [string] $ServiceAccount = "LocalSystem",

    [string] $Description = "Watches log directories and uploads .txt/.csv files to the WasteZero ingest API.",

    [switch] $SkipFailureRecovery,

    [switch] $DelayedAutoStart
)

$ErrorActionPreference = "Stop"
$InstallPath = $InstallPath.TrimEnd('\', '/')
$exe = Join-Path $InstallPath "WasteZero.WindowsUploadService.exe"

if (-not (Test-Path -LiteralPath $exe)) {
    throw "Executable not found: $exe. Publish/copy the service output there first (recommended non-dev path: C:\Program Files\WasteZero\WindowsUploadService)."
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
