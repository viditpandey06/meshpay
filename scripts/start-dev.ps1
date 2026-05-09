$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$NodeExe = "C:\Program Files\nodejs\node.exe"

$backend = [System.Diagnostics.ProcessStartInfo]::new()
$backend.FileName = $NodeExe
$backend.WorkingDirectory = $ProjectRoot
$backend.Arguments = "backend\src\server.js"
$backend.UseShellExecute = $false
$backend.CreateNoWindow = $false

$frontend = [System.Diagnostics.ProcessStartInfo]::new()
$frontend.FileName = $NodeExe
$frontend.WorkingDirectory = Join-Path $ProjectRoot "frontend"
$frontend.Arguments = "..\node_modules\vite\bin\vite.js --host 127.0.0.1"
$frontend.UseShellExecute = $false
$frontend.CreateNoWindow = $false

[System.Diagnostics.Process]::Start($backend) | Out-Null
[System.Diagnostics.Process]::Start($frontend) | Out-Null

Write-Host "Backend:  http://localhost:4000"
Write-Host "Frontend: http://127.0.0.1:5173"
