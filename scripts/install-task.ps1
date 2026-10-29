# Registers the "Greenfields" scheduled task: starts the app (npm start) when Windows starts, whether or
# not you are logged on, restarts it every minute if it stops, and never times it out.
# Run once from an elevated PowerShell in the repo folder:  powershell -ExecutionPolicy Bypass -File scripts\install-task.ps1

$ErrorActionPreference = "Stop"

$repo = Split-Path -Parent $PSScriptRoot
$npm = (Get-Command npm.cmd).Source
$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

$action = New-ScheduledTaskAction -Execute $npm -Argument "start" -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -AtStartup
# S4U runs without storing your password; the app only needs outbound internet access.
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType S4U -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit (New-TimeSpan -Seconds 0) `
  -StartWhenAvailable `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName "Greenfields" -Action $action -Trigger $trigger -Principal $principal `
  -Settings $settings -Description "Greenfields update pipeline (npm start)" -Force | Out-Null

Write-Host "Registered task 'Greenfields' for $user, running '$npm start' in $repo."
Write-Host "Start it now with:  Start-ScheduledTask -TaskName Greenfields"
