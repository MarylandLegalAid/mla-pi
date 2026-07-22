<#
.SYNOPSIS
  Prepares a Windows machine for mla-pi by enabling WSL2 and pre-fetching Ubuntu.

.DESCRIPTION
  For an M365/Intune admin, not a developer. Deploy this as an Intune
  "Devices > Scripts and remediations > Platform script" (Windows 10/11), set to
  run as SYSTEM, 64-bit PowerShell host. It does the one step staff cannot do
  themselves without admin rights: enabling the WSL and Virtual Machine
  Platform Windows features and installing the Ubuntu distro image.

  It does NOT run the mla-pi installer itself, and it cannot - the very last
  step (creating the Linux user account) only happens the first time the
  actual person opens "Ubuntu" from the Start menu, which is inherently
  interactive and cannot run as SYSTEM. After this script has run (and the
  machine rebooted if it asked to), tell staff:

    1. Open "Ubuntu" from the Start menu. Set a Linux username and password
       when prompted (this can be anything - it does not need to match their
       Windows login).
    2. Paste this into that window:
         curl -fsSL https://raw.githubusercontent.com/MarylandLegalAid/mla-pi/main/install.sh | bash

  Enabling Windows features can require a reboot before WSL actually works.
  This script tracks its own progress in the registry so it picks up where it
  left off on a re-run - assign it to "rerun until successful" (or a daily
  schedule) in Intune rather than "run once", so the post-reboot half
  completes without you doing anything.

.NOTES
  Exit codes: 0 = done, nothing more needed.
              1641 = done for now, but a reboot is required before WSL will
                     work - Intune's standard "soft reboot required" code.
              1 = failed; check the script's Intune run output for the reason.
#>

$ErrorActionPreference = 'Stop'
$MarkerKey = 'HKLM:\SOFTWARE\MLA\mla-pi-wsl'

function Write-Log {
    param([string]$Message)
    Write-Output "[mla-pi-wsl] $Message"
}

function Set-Marker {
    param([string]$Name)
    if (-not (Test-Path $MarkerKey)) {
        New-Item -Path $MarkerKey -Force | Out-Null
    }
    Set-ItemProperty -Path $MarkerKey -Name $Name -Value (Get-Date -Format o)
}

function Test-Marker {
    param([string]$Name)
    if (-not (Test-Path $MarkerKey)) { return $false }
    return $null -ne (Get-ItemProperty -Path $MarkerKey -Name $Name -ErrorAction SilentlyContinue)
}

try {
    # ------------------------------------------------------------- 1. features
    $features = @('Microsoft-Windows-Subsystem-Linux', 'VirtualMachinePlatform')
    $needsReboot = $false

    foreach ($feature in $features) {
        $state = (Get-WindowsOptionalFeature -Online -FeatureName $feature).State
        if ($state -eq 'Enabled') {
            Write-Log "already enabled: $feature"
        } else {
            Write-Log "enabling: $feature"
            $result = Enable-WindowsOptionalFeature -Online -FeatureName $feature -All -NoRestart
            if ($result.RestartNeeded) { $needsReboot = $true }
        }
    }

    if ($needsReboot -and -not (Test-Marker 'FeaturesEnabledAt')) {
        Set-Marker 'FeaturesEnabledAt'
        Write-Log 'Windows features enabled; a reboot is required before WSL will work.'
        Write-Log 'Re-running this script after reboot will continue with the Ubuntu install.'
        exit 1641
    }
    Set-Marker 'FeaturesEnabledAt'

    # -------------------------------------------------------- 2. wsl available
    $wslCmd = Get-Command wsl.exe -ErrorAction SilentlyContinue
    if (-not $wslCmd) {
        Write-Log 'wsl.exe not yet on PATH - the feature enable likely still needs a reboot to take effect.'
        exit 1641
    }

    # ---------------------------------------------------- 3. wsl2 as default
    Write-Log 'setting WSL2 as the default version'
    & wsl.exe --set-default-version 2 | Out-Null

    # ------------------------------------------------------- 4. ubuntu image
    $distros = (& wsl.exe -l -q 2>$null) -replace "`0", ''
    if ($distros -match 'Ubuntu') {
        Write-Log 'already present: Ubuntu distro'
    } else {
        Write-Log 'installing Ubuntu (this fetches the distro image; no user interaction happens here)'
        & wsl.exe --install -d Ubuntu --no-launch
        if ($LASTEXITCODE -ne 0) {
            throw "wsl --install -d Ubuntu exited with code $LASTEXITCODE"
        }
    }

    Set-Marker 'UbuntuInstalledAt'
    Write-Log 'done. Tell the user to open "Ubuntu" from the Start menu to finish setup, then run the mla-pi install command (see this script''s header comment).'
    exit 0
}
catch {
    Write-Log "FAILED: $($_.Exception.Message)"
    exit 1
}
