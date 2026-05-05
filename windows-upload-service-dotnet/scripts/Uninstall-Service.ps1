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
if ($LASTEXITCODE -ne 0) {
    throw "sc.exe delete failed with exit code $LASTEXITCODE"
}

Start-Sleep -Milliseconds 300
$remaining = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($remaining) {
    throw "Service '$ServiceName' still appears to exist after delete. Try again in a few seconds and verify with `sc.exe query $ServiceName`."
}

Write-Host "Service '$ServiceName' removed."
