# Prompts for API keys (input hidden) and writes them into .env next to this script.
# Leave a prompt empty to keep that key's current value.
$envFile = Join-Path $PSScriptRoot '.env'
if (-not (Test-Path $envFile)) { Copy-Item (Join-Path $PSScriptRoot '.env.example') $envFile }

function Read-Secret($label) {
  $secure = Read-Host $label -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { ([Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)).Trim() }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

$values = [ordered]@{
  ANTHROPIC_API_KEY = Read-Secret 'Claude API key (hidden, Enter to skip)'
  ADZUNA_APP_ID     = Read-Secret 'Adzuna App ID (hidden, Enter to skip)'
  ADZUNA_APP_KEY    = Read-Secret 'Adzuna App Key (hidden, Enter to skip)'
}

$lines = Get-Content $envFile
foreach ($name in $values.Keys) {
  $v = $values[$name]
  if (-not $v) { continue }
  $found = $false
  $lines = foreach ($line in $lines) {
    if ($line -match "^$name=") { $found = $true; "$name=$v" } else { $line }
  }
  if (-not $found) { $lines += "$name=$v" }
}
[IO.File]::WriteAllLines($envFile, [string[]]$lines)

foreach ($name in $values.Keys) {
  $status = if ((Get-Content $envFile) -match "^$name=.+") { 'set' } else { 'empty' }
  Write-Host ("{0}: {1}" -f $name, $status)
}
Write-Host "Saved to $envFile. Tell Claude you're done."
