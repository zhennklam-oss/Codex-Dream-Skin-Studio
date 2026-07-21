$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$manifestPath = Join-Path $projectRoot 'src-tauri\Cargo.toml'
$packagedNode = Join-Path $projectRoot 'src-tauri\resources\dream-skin-engine\runtime\node.exe'
$nodeNames = @(
  'NODE_BINARY', 'NVM_HOME', 'NVM_SYMLINK', 'FNM_DIR', 'FNM_MULTISHELL_PATH',
  'NODE_HOME', 'NODEJS_HOME', 'VOLTA_HOME'
)

function Get-NodeRegistrySnapshot {
  $locations = @(
    @{ Hive = [Microsoft.Win32.RegistryHive]::CurrentUser; View = [Microsoft.Win32.RegistryView]::Default; Path = 'Environment' },
    @{ Hive = [Microsoft.Win32.RegistryHive]::LocalMachine; View = [Microsoft.Win32.RegistryView]::Default; Path = 'SYSTEM\CurrentControlSet\Control\Session Manager\Environment' }
  )
  $snapshot = [System.Collections.Generic.List[object]]::new()
  foreach ($location in $locations) {
    $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey($location.Hive, $location.View)
    try {
      $key = $base.OpenSubKey($location.Path, $false)
      try {
        foreach ($name in @('Path') + $nodeNames) {
          $exists = $null -ne $key -and $key.GetValueNames() -contains $name
          $value = if ($exists) {
            $key.GetValue($name, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
          } else { $null }
          $kind = if ($exists) { "$($key.GetValueKind($name))" } else { $null }
          $snapshot.Add([ordered]@{
            hive = "$($location.Hive)"
            path = $location.Path
            name = $name
            exists = $exists
            kind = $kind
            value = if ($value -is [array]) { @($value) } elseif ($null -ne $value) { "$value" } else { $null }
          })
        }
      } finally {
        if ($null -ne $key) { $key.Dispose() }
      }
    } finally {
      $base.Dispose()
    }
  }
  return @($snapshot)
}

function Get-ExistingNodeSnapshot {
  $candidates = [System.Collections.Generic.List[string]]::new()
  foreach ($command in @(Get-Command node.exe -All -ErrorAction SilentlyContinue)) {
    if ($command.Source) { $candidates.Add("$($command.Source)") }
  }
  foreach ($pathValue in @(
      [Environment]::GetEnvironmentVariable('Path', 'Process'),
      [Environment]::GetEnvironmentVariable('Path', 'User'),
      [Environment]::GetEnvironmentVariable('Path', 'Machine')
    )) {
    foreach ($directory in @($pathValue -split ';')) {
      if ($directory) { $candidates.Add((Join-Path $directory 'node.exe')) }
    }
  }
  foreach ($name in $nodeNames) {
    foreach ($scope in @('Process', 'User', 'Machine')) {
      $value = [Environment]::GetEnvironmentVariable($name, $scope)
      if (-not $value) { continue }
      if ($name -eq 'NODE_BINARY') { $candidates.Add($value); continue }
      if ($name -eq 'VOLTA_HOME') { $candidates.Add((Join-Path $value 'bin\node.exe')); continue }
      $candidates.Add((Join-Path $value 'node.exe'))
    }
  }
  foreach ($common in @(
      $(if ($env:ProgramFiles) { Join-Path $env:ProgramFiles 'nodejs\node.exe' }),
      $(if (${env:ProgramFiles(x86)}) { Join-Path ${env:ProgramFiles(x86)} 'nodejs\node.exe' }),
      $(if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe' }),
      $(if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'Volta\bin\node.exe' }),
      $(if ($env:USERPROFILE) { Join-Path $env:USERPROFILE '.volta\bin\node.exe' }),
      $(if ($env:USERPROFILE) { Join-Path $env:USERPROFILE 'scoop\apps\nodejs\current\node.exe' }),
      $(if ($env:USERPROFILE) { Join-Path $env:USERPROFILE 'scoop\apps\nodejs-lts\current\node.exe' })
    )) {
    if ($common) { $candidates.Add($common) }
  }

  $seen = @{}
  $snapshot = [System.Collections.Generic.List[object]]::new()
  foreach ($candidate in $candidates) {
    if (-not $candidate) { continue }
    try { $full = [System.IO.Path]::GetFullPath($candidate) } catch { continue }
    $key = $full.ToLowerInvariant()
    if ($seen.ContainsKey($key) -or -not (Test-Path -LiteralPath $full -PathType Leaf)) { continue }
    $seen[$key] = $true
    $item = Get-Item -LiteralPath $full -Force
    $snapshot.Add([ordered]@{
      path = $full
      length = $item.Length
      lastWriteTimeUtc = $item.LastWriteTimeUtc.ToString('O')
      sha256 = (Get-FileHash -LiteralPath $full -Algorithm SHA256).Hash
    })
  }
  return @($snapshot | Sort-Object path)
}

function Get-MachineSnapshot {
  [ordered]@{
    processPath = [Environment]::GetEnvironmentVariable('Path', 'Process')
    userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    registry = @(Get-NodeRegistrySnapshot)
    nodeExecutables = @(Get-ExistingNodeSnapshot)
  }
}

function Build-PrivateNodeRuntimeTest {
  $cargo = (Get-Command cargo.exe -ErrorAction Stop).Source
  $cargoArguments = @(
    'test', '--manifest-path', $manifestPath, '--test', 'private_node_runtime',
    '--no-run', '--message-format=json'
  )
  $previousPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $output = @(& $cargo @cargoArguments 2>&1)
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousPreference
  }
  if ($exitCode -ne 0) {
    throw "Failed to compile the private Node runtime integration test:`n$($output -join "`n")"
  }

  $testBinary = $null
  foreach ($line in $output) {
    try { $message = "$line" | ConvertFrom-Json -ErrorAction Stop } catch { continue }
    if ($message.reason -eq 'compiler-artifact' -and
      $message.target.name -eq 'private_node_runtime' -and $message.executable) {
      $testBinary = "$($message.executable)"
    }
  }
  if (-not $testBinary -or -not (Test-Path -LiteralPath $testBinary -PathType Leaf)) {
    throw 'Cargo did not report the private Node runtime integration test executable.'
  }
  return [System.IO.Path]::GetFullPath($testBinary)
}

function Invoke-IsolatedRustProbe {
  param(
    [Parameter(Mandatory = $true)][string]$TestBinary,
    [Parameter(Mandatory = $true)][ValidateSet('bundled', 'external')][string]$Scenario,
    [string]$ExternalNode
  )
  $start = [System.Diagnostics.ProcessStartInfo]::new()
  $start.FileName = $TestBinary
  $start.Arguments = '"installed_environment_probe_resolves_node_runtime" "--exact" "--ignored" "--nocapture"'
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $start.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true

  $corePath = "$env:SystemRoot\System32;$env:SystemRoot;$env:SystemRoot\System32\Wbem;$PSHOME"
  $start.EnvironmentVariables['PATH'] = if ($Scenario -eq 'external') {
    (Split-Path -Parent $ExternalNode) + ";$corePath"
  } else { $corePath }
  $start.EnvironmentVariables['DREAM_SKIN_NODE_SCENARIO'] = $Scenario
  if ($ExternalNode) {
    $start.EnvironmentVariables['DREAM_SKIN_EXPECTED_EXTERNAL_NODE'] = $ExternalNode
  } else {
    $start.EnvironmentVariables.Remove('DREAM_SKIN_EXPECTED_EXTERNAL_NODE')
  }
  foreach ($name in $nodeNames) { $start.EnvironmentVariables.Remove($name) }

  $process = [System.Diagnostics.Process]::Start($start)
  $stdout = $process.StandardOutput.ReadToEnd()
  $stderr = $process.StandardError.ReadToEnd()
  $process.WaitForExit()
  if ($process.ExitCode -ne 0) {
    throw "Rust Studio environment probe failed for ${Scenario}:`n$stdout`n$stderr"
  }

  $match = [regex]::Match($stdout, 'DREAM_SKIN_ENV_STATUS=(\{[^\r\n]+\})')
  if (-not $match.Success) {
    throw "Rust Studio environment probe omitted its authentic status JSON for ${Scenario}:`n$stdout"
  }
  return ($match.Groups[1].Value | ConvertFrom-Json)
}

if (-not (Test-Path -LiteralPath $packagedNode -PathType Leaf)) {
  throw "Packaged Node runtime is missing: $packagedNode"
}

$before = Get-MachineSnapshot
$beforeJson = $before | ConvertTo-Json -Depth 8 -Compress
$tempRoot = Join-Path $env:TEMP ("dream-skin-private-node-" + [guid]::NewGuid().ToString('N'))
try {
  $externalRoot = Join-Path $tempRoot 'external-node'
  New-Item -ItemType Directory -Path $externalRoot -Force | Out-Null
  $externalNode = Join-Path $externalRoot 'node.exe'
  Copy-Item -LiteralPath $packagedNode -Destination $externalNode

  $testBinary = Build-PrivateNodeRuntimeTest
  $bundled = Invoke-IsolatedRustProbe -TestBinary $testBinary -Scenario bundled
  $external = Invoke-IsolatedRustProbe -TestBinary $testBinary -Scenario external -ExternalNode $externalNode
} finally {
  $resolvedTempBase = [System.IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') + '\'
  $resolvedFixture = [System.IO.Path]::GetFullPath($tempRoot)
  if (-not $resolvedFixture.StartsWith($resolvedTempBase, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to clean an acceptance fixture outside TEMP: $resolvedFixture"
  }
  if (Test-Path -LiteralPath $resolvedFixture) {
    Remove-Item -LiteralPath $resolvedFixture -Recurse -Force
  }
}

$after = Get-MachineSnapshot
$afterJson = $after | ConvertTo-Json -Depth 8 -Compress
if ($afterJson -cne $beforeJson) {
  throw 'Private Node acceptance changed PATH, Node-related registry values, or an existing Node installation.'
}

[ordered]@{
  pass = $true
  bundled = $bundled
  external = $external
  machineStateUnchanged = $true
} | ConvertTo-Json -Depth 6
