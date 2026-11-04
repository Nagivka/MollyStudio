# Runs only inside the disposable, network-disabled guest created by the host.
$ErrorActionPreference = 'Stop'
$run = Get-Content -LiteralPath 'C:\MollySmoke\launch.json' -Raw | ConvertFrom-Json
$installed = 'C:\MollyInstalled'
$output = 'C:\MollyResults'
function Report($stage, $data) {
    [ordered]@{stage=$stage;at=[DateTime]::UtcNow.ToString('o');data=$data} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath "$output\$stage.json" -Encoding UTF8
}
function Await-Request($name) {
    $deadline=[DateTime]::UtcNow.AddMinutes(40)
    while (!(Test-Path -LiteralPath "$output\$name.request")) {
        Report 'processes' @(Get-Process -Name MollyStudio -ErrorAction SilentlyContinue | Select-Object Id,MainWindowTitle,Responding,CPU,WorkingSet64)
        foreach ($png in @(Get-ChildItem -LiteralPath ([Environment]::GetFolderPath('MyDocuments')) -Filter '*.png' -File -ErrorAction SilentlyContinue)) {
            if (!(Test-Path -LiteralPath (Join-Path $output $png.Name))) { Copy-Item -LiteralPath $png.FullName -Destination (Join-Path $output $png.Name) }
        }
        if ([DateTime]::UtcNow -gt $deadline) { throw "Timed out waiting for $name" }
        Start-Sleep -Milliseconds 500
    }
}
function Close-GuestApp {
    $processes=@(Get-Process -Name MollyStudio -ErrorAction SilentlyContinue)
    foreach ($process in $processes | Where-Object MainWindowHandle -ne 0) { $null=$process.CloseMainWindow() }
    Start-Sleep -Seconds 8
    $remaining=@(Get-Process -Name MollyStudio -ErrorAction SilentlyContinue)
    if ($remaining.Count) { Report 'forced-guest-close' @{processes=@($remaining | Select-Object Id,MainWindowTitle,Responding)};$remaining | Stop-Process -Force }
}
function Install($name) {
    $file=Join-Path 'C:\MollyStudio' $name
    $digest=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($digest -ne $run.hashes.$name) { throw 'Installer checksum mismatch' }
    $process=Start-Process -FilePath $file -ArgumentList '/S','/CURRENTUSER',"/D=$installed" -PassThru -Wait -WindowStyle Hidden
    if ($process.ExitCode -ne 0) { throw "Installer exit: $($process.ExitCode)" }
    $exe=Join-Path $installed 'MollyStudio.exe'
    if (!(Test-Path -LiteralPath $exe)) { throw 'Installed executable is missing' }
    return [ordered]@{installer=$name;sha256=$digest;version=(Get-Item -LiteralPath $exe).VersionInfo.FileVersion;directory=$installed}
}
try {
    Report 'environment' ([ordered]@{startedAt=$run.preparedAt;os=[Environment]::OSVersion.Version.ToString();network=@(Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object Status -eq 'Up' | Select-Object Name);externalRuntimes=@(Get-Command node.exe,npm.cmd,java.exe -ErrorAction SilentlyContinue | Select-Object Name,Source)})
    Copy-Item -LiteralPath 'C:\MollySmoke\fixture.mlst' -Destination "$output\fixture.mlst"
    if (!$run.currentOnly) {
    Report 'installed-old' (Install $run.old)
    $null=Start-Process -FilePath "$installed\MollyStudio.exe" -ArgumentList '"C:\MollyResults\fixture.mlst"','--enable-logging','--log-file=C:\MollyResults\old-chromium.log' -PassThru
    Report 'ready-old' @{association=(Get-ItemProperty -LiteralPath 'HKCU:\Software\Classes\MollyStudio.Project\shell\open\command' -ErrorAction SilentlyContinue).'(default)'}
    Await-Request 'upgrade'
    Close-GuestApp
    $settings=Get-ChildItem -LiteralPath "$env:APPDATA\MollyStudio" -Recurse -File -ErrorAction SilentlyContinue | Where-Object Name -match 'settings|preferences'
    Report 'profile-before-upgrade' @($settings | Select-Object FullName,Length)
    }
    Report 'installed-new' (Install $run.current)
    $null=Start-Process -FilePath "$output\fixture.mlst" -WorkingDirectory $output -PassThru
    Report 'ready-new' @{association=(Get-ItemProperty -LiteralPath 'HKCU:\Software\Classes\MollyStudio.Project\shell\open\command' -ErrorAction SilentlyContinue).'(default)';projectSha256=(Get-FileHash "$output\fixture.mlst" -Algorithm SHA256).Hash}
    Await-Request 'uninstall'
    Close-GuestApp
    $uninstaller=Get-ChildItem -LiteralPath $installed -Filter '*Uninstall*.exe' -File | Select-Object -First 1
    if (!$uninstaller) { throw 'Uninstaller not found' }
    $process=Start-Process -FilePath $uninstaller.FullName -ArgumentList '/S',"_?=$installed" -PassThru -Wait -WindowStyle Hidden
    Start-Sleep -Seconds 3
    Report 'uninstalled' @{exitCode=$process.ExitCode;executableStillPresent=(Test-Path "$installed\MollyStudio.exe");projectStillPresent=(Test-Path "$output\fixture.mlst");profileStillPresent=(Test-Path "$env:APPDATA\MollyStudio");association=(Get-ItemProperty -LiteralPath 'HKCU:\Software\Classes\MollyStudio.Project\shell\open\command' -ErrorAction SilentlyContinue).'(default)'}
} catch { Report 'error' @{message=$_.Exception.Message;stack=$_.ScriptStackTrace};exit 1 }
