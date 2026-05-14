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
  If omitted, resolves in order: (1) project-source\ next to this script (GitHub artifact bundle),
  (2) ..\src\WasteZero.WindowsUploadService\ relative to scripts folder (full repo checkout).

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

.NOTES
  Network folders: Windows services do not see user mapped drive letters (e.g. Z: from Explorer).
  Set UploadService:WatchDirectories to a UNC path (\\fileserver\share\camera-logs) in appsettings
  or environment variables. If the service runs as Local System on a domain-joined machine,
  grant the computer account (DOMAIN\COMPUTERNAME$) read access on the share and folder ACLs.
  For workgroup PCs or shares that require a specific user, install with -ServiceAccount using an
  account that has permission to the UNC path (set the password in Services.msc if needed).
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

    [string] $ProjectPath = $null,

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

    if (-not $ProjectPath -or [string]::IsNullOrWhiteSpace($ProjectPath)) {
        $candidates = @(
            (Join-Path $PSScriptRoot "project-source\WasteZero.WindowsUploadService.csproj"),
            (Join-Path $PSScriptRoot "..\src\WasteZero.WindowsUploadService\WasteZero.WindowsUploadService.csproj")
        )
        foreach ($c in $candidates) {
            $fullCandidate = [System.IO.Path]::GetFullPath($c)
            if (Test-Path -LiteralPath $fullCandidate) {
                $ProjectPath = $fullCandidate
                break
            }
        }
    }

    if (-not $ProjectPath -or [string]::IsNullOrWhiteSpace($ProjectPath)) {
        throw "Could not find WasteZero.WindowsUploadService.csproj. Expected project-source\ next to this script (artifact bundle) or ..\src\WasteZero.WindowsUploadService\ (repo layout). Pass -ProjectPath explicitly."
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
    & dotnet publish $resolvedProjectPath -c $PublishConfiguration -r $Runtime --self-contained $selfContainedValue -p:PublishSingleFile=false -o $publishOut
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

# SCM can lag briefly after New-Service; sc.exe OpenService may return 1060 until the service is queryable.
$deadline = (Get-Date).AddSeconds(20)
do {
    sc.exe query $ServiceName 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { break }
    if ($LASTEXITCODE -ne 1060) {
        throw "sc.exe query '$ServiceName' failed with exit code $LASTEXITCODE right after New-Service."
    }
    if ((Get-Date) -ge $deadline) {
        throw "Service '$ServiceName' was not visible to SCM within 20s after New-Service. Reboot and run Uninstall-Service.ps1 if a partial install exists, then retry."
    }
    Start-Sleep -Milliseconds 200
} while ($true)

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
