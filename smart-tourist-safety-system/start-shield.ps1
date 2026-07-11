param(
    [int]$Port = 8000
)

$projectRoot = $PSScriptRoot
$backendRoot = Join-Path $projectRoot "backend-ai-service"

if (-not (Test-Path (Join-Path $backendRoot "main.py"))) {
    throw "SHIELD backend was not found at $backendRoot"
}

$pythonCandidates = @(
    (Join-Path $projectRoot ".venv\Scripts\python.exe"),
    (Join-Path $backendRoot ".venv\Scripts\python.exe")
)

$python = $pythonCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $python) {
    $systemPython = Get-Command python -ErrorAction SilentlyContinue
    if ($systemPython) {
        $python = $systemPython.Source
    }
}

# Allows the bundled Codex runtime to work without exposing its path in daily use.
if (-not $python) {
    $bundledPython = "C:\Users\HP\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
    if (Test-Path $bundledPython) {
        $python = $bundledPython
    }
}

if (-not $python) {
    throw "Python was not found. Install Python 3.11+ or create a .venv folder at the project root."
}

Write-Host "Starting SHIELD API at http://127.0.0.1:$Port"
Push-Location $backendRoot
try {
    & $python -m uvicorn main:app --host 127.0.0.1 --port $Port
}
finally {
    Pop-Location
}
