$ErrorActionPreference = 'Stop'
$token = [Environment]::GetEnvironmentVariable('BINDER_GITHUB_TOKEN', 'User')
if (-not $token) {
    $secure = Read-Host 'Enter GitHub token (input hidden)' -AsSecureString
    if (-not $secure -or $secure.Length -eq 0) {
        throw 'No token entered.'
    }

    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
        [Environment]::SetEnvironmentVariable('BINDER_GITHUB_TOKEN', $token, 'User')
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
    }
}

[Environment]::SetEnvironmentVariable('BINDER_UPDATE_REPO', 'fledotexe/babybinder', 'User')
$env:BINDER_GITHUB_TOKEN = $token
$env:BINDER_UPDATE_REPO = 'fledotexe/babybinder'

$launcher = Join-Path $PSScriptRoot 'Start_Binder.bat'
if (-not (Test-Path -LiteralPath $launcher)) {
    throw 'Start_Binder.bat was not found.'
}

Write-Host 'Token saved. Starting Binder Town with token-based manual updates.'
$arguments = '/c ""' + $launcher + '""'
$process = Start-Process -FilePath $env:ComSpec -ArgumentList $arguments -WorkingDirectory $PSScriptRoot -PassThru -Wait
if ($process.ExitCode -ne 0) {
    throw "Start_Binder.bat exited with code $($process.ExitCode)."
}
