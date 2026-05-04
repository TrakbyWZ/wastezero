#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Registers WasteZero.WindowsUploadService as a Windows Service.

.PARAMETER InstallPath
  Folder containing the published executable and appsettings*.json (no trailing backslash).

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

.EXAMPLE
  .\Install-Service.ps1 -InstallPath "C:\Program Files\WasteZero\WindowsUploadService"
#>
param(
    [Parameter(Mandatory = $true)]
    [string] $InstallPath,

    [string] $ServiceName = "WasteZeroUpload",

    [string] $DisplayName = "WasteZero Windows Upload",

    [string] $ServiceAccount = "LocalSystem",

    [string] $Description = "Watches log directories and uploads .txt/.csv files to the WasteZero ingest API."
)

$ErrorActionPreference = "Stop"
$InstallPath = $InstallPath.TrimEnd('\', '/')
$exe = Join-Path $InstallPath "WasteZero.WindowsUploadService.exe"

if (-not (Test-Path -LiteralPath $exe)) {
    throw "Executable not found: $exe. Publish the project to this folder first."
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

Write-Host "Starting service..."
Start-Service -Name $ServiceName
Write-Host "Done. Service '$ServiceName' is running. Logs: $(Join-Path $InstallPath 'logs\service.log'). Configure UploadService in appsettings or env vars."
Write-Host "Event Viewer: Windows Logs -> Application (source WasteZeroUpload when registered)."
