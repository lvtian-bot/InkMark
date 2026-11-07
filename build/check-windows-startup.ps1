param(
    [string]$Executable = 'dist/win-unpacked/InkMark.exe'
)

$ErrorActionPreference = 'Stop'
$exePath = (Resolve-Path -LiteralPath $Executable).ProviderPath
$profile = New-Item -ItemType Directory -Path (Join-Path ([IO.Path]::GetTempPath()) "inkmark-startup-$([guid]::NewGuid())")
$portFile = Join-Path $profile.FullName 'DevToolsActivePort'
$stderrFile = Join-Path $profile.FullName 'stderr.log'
$appProcess = $null

try {
    $appProcess = Start-Process -FilePath $exePath -ArgumentList @(
        ('--user-data-dir="{0}"' -f $profile.FullName)
        '--remote-debugging-port=0'
        '--enable-logging=stderr'
    ) -PassThru -WindowStyle Hidden -RedirectStandardError $stderrFile

    $deadline = [Diagnostics.Stopwatch]::StartNew()
    while ($deadline.Elapsed.TotalSeconds -lt 30 -and -not $appProcess.HasExited) {
        if (Test-Path -LiteralPath $portFile) {
            $port = Get-Content -LiteralPath $portFile -TotalCount 1
            $pages = Invoke-RestMethod -Uri "http://127.0.0.1:$port/json/list" -TimeoutSec 2
            if ($pages | Where-Object {
                $_.type -eq 'page' -and $_.url -like 'file://*/resources/app.asar/out/renderer/index.html*' -and $_.title -like '*InkMark'
            }) {
                Write-Output 'Packaged InkMark opened its main page.'
                return
            }
        }
        Start-Sleep -Milliseconds 250
    }

    if (Test-Path -LiteralPath $stderrFile) {
        Get-Content -LiteralPath $stderrFile -Tail 30
    }
    throw 'Packaged InkMark did not open its main page.'
} finally {
    if ($appProcess -and -not $appProcess.HasExited) {
        Stop-Process -InputObject $appProcess
        $appProcess.WaitForExit()
    }
    Remove-Item -LiteralPath $profile.FullName -Recurse -Force
}
