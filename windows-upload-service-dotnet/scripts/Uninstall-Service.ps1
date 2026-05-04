#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Stops and removes the WasteZero Windows upload Windows Service.

.PARAMETER ServiceName
  Internal service name used at install time.

.EXAMPLE
  .\Uninstall-Service.ps1
  .\Uninstall-Service.ps1 -ServiceName "WasteZeroUpload"
#>
param(
    [string] $ServiceName = "WasteZeroUpload"
)

$ErrorActionPreference = "Stop"
$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if (-not $svc) {
    Write-Host "Service '$ServiceName' is not installed."
    exit 0
}

if ($svc.Status -ne "Stopped") {
    Write-Host "Stopping $ServiceName..."
    Stop-Service -Name $ServiceName -Force
}

Write-Host "Deleting service $ServiceName..."
sc.exe delete $ServiceName | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "sc.exe delete failed with exit code $LASTEXITCODE"
}

Write-Host "Service removed."
