# Start the Liftoff backend and frontend together (Windows PowerShell).
# First run creates backend\.venv and installs dependencies.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

Push-Location "$root\backend"
if (-not (Test-Path .venv)) {
    python -m venv .venv
    & .\.venv\Scripts\pip.exe install -q -r requirements.txt
}
$backend = Start-Process -FilePath ".\.venv\Scripts\python.exe" `
    -ArgumentList "-m", "uvicorn", "main:app", "--reload", "--host", "127.0.0.1", "--port", "8000" `
    -PassThru -NoNewWindow
Pop-Location

try {
    Push-Location "$root\frontend"
    if (-not (Test-Path node_modules)) { npm install }
    npm run dev
}
finally {
    Pop-Location
    if ($backend -and -not $backend.HasExited) { Stop-Process -Id $backend.Id -Force }
}
