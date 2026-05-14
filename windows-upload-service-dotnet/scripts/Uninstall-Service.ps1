#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Stops and removes the WasteZero Windows Upload Service.

.PARAMETER ServiceName
  Internal service name used at install time.
  Default: WasteZeroUpload

.PARAMETER StopTimeoutSeconds
  Maximum seconds to wait for the service to stop before deletion.
  Default: 30

.EXAMPLE
  .\Uninstall-Service.ps1

.EXAMPLE
  .\Uninstall-Service.ps1 -ServiceName "WasteZeroUpload"
#>
param(
    [string] $ServiceName = "WasteZeroUpload",

    [int] $StopTimeoutSeconds = 30
)

$ErrorActionPreference = "Stop"
$StopTimeoutSeconds = [Math]::Max(1, $StopTimeoutSeconds)

$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if (-not $svc) {
    Write-Host "Service '$ServiceName' is not installed."
    exit 0
}

if ($svc.Status -ne "Stopped") {
    Write-Host "Stopping $ServiceName..."
    Stop-Service -Name $ServiceName -Force
    $svc.WaitForStatus("Stopped", [TimeSpan]::FromSeconds($StopTimeoutSeconds))
}

Write-Host "Deleting service $ServiceName..."
sc.exe delete $ServiceName | Out-Null
$deleteExit = $LASTEXITCODE
# 1060 = ERROR_SERVICE_DOES_NOT_EXIST — already removed or never registered under this name; treat as success.
if ($deleteExit -ne 0 -and $deleteExit -ne 1060) {
    throw "sc.exe delete failed with exit code $deleteExit"
}
if ($deleteExit -eq 1060) {
    Write-Host "SCM returned 1060 (service does not exist); nothing left to delete."
}

Start-Sleep -Milliseconds 500

# Use SCM (sc query) as source of truth — Get-Service can lag or disagree with sc.exe delete.
sc.exe query $ServiceName 2>$null | Out-Null
$queryExit = $LASTEXITCODE
if ($queryExit -eq 1060) {
    $psGhost = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if ($psGhost) {
        Write-Warning "SCM reports '$ServiceName' is gone, but Get-Service still returns an object (stale view). If services.msc no longer lists it, you are done; otherwise reboot."
    }
    Write-Host "Service '$ServiceName' removed."
    return
}

if ($queryExit -eq 0) {
    throw "Service '$ServiceName' is still registered in SCM. Close services.msc and Event Viewer if open, wait a few seconds, and run this script again, or reboot and retry."
}

throw "sc.exe query '$ServiceName' failed with exit code $queryExit"
