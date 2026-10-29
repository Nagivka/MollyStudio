# Runs inside a disposable Windows Sandbox; no UI automation or external runtime.
$ErrorActionPreference = 'Stop'
$taskLaunch = Get-Content -LiteralPath 'C:\MollySmoke\launch.json' -Raw | ConvertFrom-Json
$taskExecutable = Join-Path 'C:\MollyStudio' $taskLaunch.name
$taskStarted = [DateTime]::UtcNow.ToString('o')
$taskHash = (Get-FileHash -LiteralPath $taskExecutable -Algorithm SHA256).Hash.ToLowerInvariant()
if ($taskHash -ne $taskLaunch.sha256) { throw 'Portable hash does not match the prepared executable.' }
$taskEnvironment = [ordered]@{
    startedAt = $taskStarted
    osVersion = [Environment]::OSVersion.Version.ToString()
    portableSha256 = $taskHash
    launchArguments = @($taskLaunch.args)
    networkAdaptersUp = @(Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object Status -eq 'Up' | Select-Object Name)
    externalRuntimes = @(Get-Command node.exe,npm.cmd,java.exe -ErrorAction SilentlyContinue | Select-Object Name,Source)
}
$taskEnvironment | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath 'C:\MollyResults\environment.json' -Encoding UTF8
if (@($taskLaunch.args).Count) { Start-Process -FilePath $taskExecutable -ArgumentList @($taskLaunch.args) }
else { Start-Process -FilePath $taskExecutable }
$taskDeadline = [DateTime]::UtcNow.AddMinutes(30)
while ([DateTime]::UtcNow -lt $taskDeadline) {
    Start-Sleep -Seconds 3
    # Preserve files produced through the real Save dialogs in the fresh guest.
    # No documents from the host profile are mapped into this VM.
    $taskDocuments = [Environment]::GetFolderPath('MyDocuments')
    foreach ($taskSaved in @(Get-ChildItem -LiteralPath $taskDocuments -File -ErrorAction SilentlyContinue | Where-Object Extension -in '.mlst','.png')) {
        $taskCopy = Join-Path 'C:\MollyResults' $taskSaved.Name
        $taskExisting = Get-Item -LiteralPath $taskCopy -ErrorAction SilentlyContinue
        if (!$taskExisting -or $taskExisting.Length -ne $taskSaved.Length -or $taskExisting.LastWriteTimeUtc -ne $taskSaved.LastWriteTimeUtc) {
            Copy-Item -LiteralPath $taskSaved.FullName -Destination $taskCopy -Force
        }
    }
    $taskProcesses = @(Get-Process -Name MollyStudio -ErrorAction SilentlyContinue)
    $taskAssociation = Get-ItemProperty -LiteralPath 'HKCU:\Software\Classes\MollyStudio.Project\shell\open\command' -ErrorAction SilentlyContinue
    $taskReport = [ordered]@{
        checkedAt = [DateTime]::UtcNow.ToString('o')
        startedAt = $taskStarted
        portableSha256 = $taskHash
        appWindowDetected = @($taskProcesses | Where-Object MainWindowHandle -ne 0).Count -gt 0
        appProcesses = @($taskProcesses | Select-Object Id,ProcessName,MainWindowTitle,WorkingSet64)
        associationCommand = if ($taskAssociation) { $taskAssociation.'(default)' } else { $null }
        files = @(Get-ChildItem -LiteralPath 'C:\MollyResults' -File | Where-Object Extension -in '.mlst','.png' | Select-Object Name,Length)
    }
    $taskReport | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath 'C:\MollyResults\startup.json' -Encoding UTF8
    if (Test-Path -LiteralPath 'C:\MollyResults\reopen.request') {
        $taskProject = Get-ChildItem -LiteralPath 'C:\MollyResults' -Filter '*.mlst' -File | Select-Object -First 1
        if ($taskProject) {
            Start-Process -FilePath $taskProject.FullName
            Move-Item -LiteralPath 'C:\MollyResults\reopen.request' -Destination 'C:\MollyResults\reopen.done'
        }
    }
}
