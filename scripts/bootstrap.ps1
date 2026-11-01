<#
  PayLab 环境检查与安装脚本
  - 检查 Node.js（>= 18），缺失或过旧时安装官方 LTS 便携版到 .runtime\node
  - 检查项目文件、数据目录、数据文件与端口
  - 全程不修改系统环境变量，不写入注册表
#>
[CmdletBinding()]
param(
  [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$Root = Split-Path -Parent $PSScriptRoot
$RuntimeDir = Join-Path $Root '.runtime'
$NodeDir = Join-Path $RuntimeDir 'node'
$NodeExe = Join-Path $NodeDir 'node.exe'
$NodeExecFile = Join-Path $RuntimeDir 'node-exec.txt'
$PortFile = Join-Path $RuntimeDir 'port.txt'
$DataDir = Join-Path $Root 'data'
$StateFile = Join-Path $DataDir 'state.json'
$MinMajor = 18
$DefaultPort = 5178

function Write-Title([string]$Text) {
  Write-Host ''
  Write-Host "  $Text" -ForegroundColor Cyan
}

function Write-Rule {
  Write-Host '  ========================================' -ForegroundColor DarkCyan
}

function Write-Ok([string]$Text) {
  Write-Host '  [OK]   ' -ForegroundColor Green -NoNewline
  Write-Host $Text
}

function Write-Warn([string]$Text) {
  Write-Host '  [WARN] ' -ForegroundColor Yellow -NoNewline
  Write-Host $Text
}

function Write-Fail([string]$Text) {
  Write-Host '  [FAIL] ' -ForegroundColor Red -NoNewline
  Write-Host $Text
}

function Write-Info([string]$Text) {
  Write-Host "         $Text" -ForegroundColor DarkGray
}

function Get-NodeInfo([string]$Exe) {
  if (-not $Exe) { return $null }
  if (-not (Test-Path -LiteralPath $Exe)) { return $null }
  try {
    $version = & $Exe -v 2>$null | Select-Object -First 1
    if ($LASTEXITCODE -ne 0 -or -not $version) { return $null }
    $version = ([string]$version).Trim()
    if ($version -match '^v(\d+)\.') {
      return [pscustomobject]@{
        Path    = $Exe
        Version = $version
        Major   = [int]$Matches[1]
      }
    }
  } catch {
    return $null
  }
  return $null
}

function Find-Node {
  $candidates = New-Object System.Collections.Generic.List[string]
  if (Test-Path -LiteralPath $NodeExe) { $candidates.Add($NodeExe) }

  $command = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($command -and $command.Source) { $candidates.Add($command.Source) }

  $standard = @()
  if ($env:ProgramFiles) { $standard += (Join-Path $env:ProgramFiles 'nodejs\node.exe') }
  if (${env:ProgramFiles(x86)}) { $standard += (Join-Path ${env:ProgramFiles(x86)} 'nodejs\node.exe') }
  if ($env:LOCALAPPDATA) { $standard += (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe') }
  foreach ($path in $standard) { $candidates.Add($path) }

  $old = $null
  foreach ($candidate in $candidates) {
    $info = Get-NodeInfo $candidate
    if (-not $info) { continue }
    if ($info.Major -ge $MinMajor) { return [pscustomobject]@{ Current = $info; Old = $old } }
    if (-not $old) { $old = $info }
  }
  return [pscustomobject]@{ Current = $null; Old = $old }
}

function Install-NodePortable {
  Write-Title '安装 Node.js 便携版'
  Write-Info '未检测到可用的 Node.js（要求 18 或以上），准备下载官方 LTS 版本。'
  Write-Info '仅解压到项目 .runtime\node 目录，不修改系统环境变量，可能需要几分钟。'

  if (-not (Test-Path -LiteralPath $NodeDir)) {
    New-Item -ItemType Directory -Path $NodeDir -Force | Out-Null
  }

  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  } catch {
    # PowerShell 7 已默认启用现代 TLS，忽略即可
  }

  $url = $null
  try {
    $index = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json' -TimeoutSec 30
    $lts = $index | Where-Object { $_.lts -ne $false -and ($_.files -contains 'win-x64-exe') } | Select-Object -First 1
    if ($lts) {
      $url = "https://nodejs.org/dist/$($lts.version)/win-x64/node.exe"
    }
  } catch {
    Write-Warn "获取 LTS 版本列表失败：$($_.Exception.Message)"
  }
  if (-not $url) {
    $url = 'https://nodejs.org/dist/latest-v24.x/win-x64/node.exe'
  }

  Write-Info "下载地址：$url"
  $tempFile = Join-Path $RuntimeDir 'node-download.exe'
  try {
    Invoke-WebRequest -Uri $url -OutFile $tempFile -UseBasicParsing -TimeoutSec 600
  } catch {
    if (Test-Path -LiteralPath $tempFile) { Remove-Item -LiteralPath $tempFile -Force -ErrorAction SilentlyContinue }
    Write-Fail "Node.js 下载失败：$($_.Exception.Message)"
    Write-Info '请检查网络或代理，也可以手动安装 Node.js 18+：https://nodejs.org/'
    Write-Info '安装完成后重新双击 start.cmd。'
    return $false
  }

  $size = (Get-Item -LiteralPath $tempFile).Length
  if ($size -lt 20MB) {
    Remove-Item -LiteralPath $tempFile -Force -ErrorAction SilentlyContinue
    Write-Fail "下载文件大小异常（$([math]::Round($size / 1MB, 1)) MB），请重试。"
    return $false
  }

  Move-Item -LiteralPath $tempFile -Destination $NodeExe -Force
  $info = Get-NodeInfo $NodeExe
  if (-not $info -or $info.Major -lt $MinMajor) {
    Write-Fail '便携版 Node.js 安装失败或版本过低。'
    Write-Info '请手动安装 Node.js 18+：https://nodejs.org/'
    return $false
  }

  Write-Ok "Node.js 便携版安装完成：$($info.Version)"
  return $true
}

function Test-PortFree([int]$Port) {
  try {
    $existing = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if ($existing) { return $false }
  } catch {
    # 旧系统没有 Get-NetTCPConnection 时，退回到独占绑定检测
  }

  $listener = $null
  try {
    $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Port)
    $listener.ExclusiveAddressUse = $true
    $listener.Start()
    return $true
  } catch {
    return $false
  } finally {
    if ($listener) {
      try { $listener.Stop() } catch { }
    }
  }
}

function Test-PayLabRunning([int]$Port) {
  try {
    $response = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/meta" -TimeoutSec 2
    if ($response.ok -and $response.data -and $response.data.phases) { return $true }
  } catch {
    return $false
  }
  return $false
}

function Find-FreePort([int]$Preferred) {
  $limit = [Math]::Min($Preferred + 21, 65535)
  for ($port = $Preferred; $port -le $limit; $port++) {
    if (Test-PortFree $port) { return $port }
  }
  return $null
}

function Invoke-Main {
  Write-Title 'PayLab · 环境检查'
  Write-Rule

  # 1. Node.js
  $found = Find-Node
  $node = $found.Current
  if ($node) {
    if ($node.Path -eq $NodeExe) {
      Write-Ok "Node.js $($node.Version)（项目便携版）"
    } else {
      Write-Ok "Node.js $($node.Version)（$($node.Path)）"
    }
  } elseif ($CheckOnly) {
    if ($found.Old) {
      Write-Fail "Node.js 版本过低：$($found.Old.Version)（要求 >= v$MinMajor）"
    } else {
      Write-Fail '未检测到 Node.js（要求 >= 18）'
    }
    Write-Info '双击 start.cmd 可自动安装便携版，或手动安装：https://nodejs.org/'
    return 1
  } else {
    if ($found.Old) {
      Write-Warn "检测到 Node.js $($found.Old.Version)，版本低于 v$MinMajor，将使用项目便携版。"
    }
    if (-not (Install-NodePortable)) {
      return 1
    }
    $node = Get-NodeInfo $NodeExe
    if (-not $node) {
      Write-Fail '便携版 Node.js 无法运行。'
      return 1
    }
  }

  # 2. 项目文件
  $required = @(
    'server\server.js',
    'server\engine.js',
    'server\ops.js',
    'server\interbank.js',
    'server\banking.js',
    'server\store.js',
    'server\seed.js',
    'server\util.js',
    'public\index.html',
    'public\js\app.js',
    'public\css\app.css'
  )
  $missing = @()
  foreach ($item in $required) {
    if (-not (Test-Path -LiteralPath (Join-Path $Root $item))) { $missing += $item }
  }
  if ($missing.Count -gt 0) {
    Write-Fail "项目文件不完整，缺少 $($missing.Count) 个文件："
    foreach ($item in $missing) { Write-Info $item }
    Write-Info '请重新下载或克隆完整项目。'
    return 1
  }
  Write-Ok "项目文件完整（$($required.Count) 项）"

  # 3. 是否已在运行（避免重复启动共用同一份数据）
  $preferred = $DefaultPort
  if ($env:PORT) {
    $parsedPort = 0
    if ([int]::TryParse($env:PORT, [ref]$parsedPort) -and $parsedPort -gt 0 -and $parsedPort -le 65535) {
      $preferred = $parsedPort
    }
  }
  $existingPort = $null
  if (Test-Path -LiteralPath $PortFile) {
    try {
      $lastPort = 0
      if ([int]::TryParse((Get-Content -LiteralPath $PortFile -Raw).Trim(), [ref]$lastPort) -and $lastPort -gt 0) {
        $existingPort = $lastPort
      }
    } catch {
      $existingPort = $null
    }
  }
  $runningPort = $null
  if (Test-PayLabRunning $preferred) {
    $runningPort = $preferred
  } elseif ($existingPort -and $existingPort -ne $preferred -and (Test-PayLabRunning $existingPort)) {
    $runningPort = $existingPort
  }
  if ($runningPort) {
    Write-Ok "PayLab 已在运行（端口 $runningPort）"
    Write-Info "http://localhost:$runningPort"
    if (-not $CheckOnly) {
      if (-not (Test-Path -LiteralPath $RuntimeDir)) {
        New-Item -ItemType Directory -Path $RuntimeDir -Force | Out-Null
      }
      $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
      [System.IO.File]::WriteAllText($NodeExecFile, $node.Path, $utf8NoBom)
      [System.IO.File]::WriteAllText($PortFile, [string]$runningPort, $utf8NoBom)
      Write-Info '不会重复启动，避免两个进程同时写 data\state.json。'
    }
    Write-Rule
    Write-Host '  已有 PayLab 服务在运行，无需重新启动。' -ForegroundColor Yellow
    Write-Host ''
    if ($CheckOnly) { return 0 }
    return 2
  }

  # 4. 数据目录与数据文件
  if (-not (Test-Path -LiteralPath $DataDir)) {
    if ($CheckOnly) {
      Write-Ok '数据目录不存在（首次启动会自动创建）'
    } else {
      New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
      Write-Ok '数据目录已创建'
    }
  } else {
    Write-Ok '数据目录正常'
  }

  if (Test-Path -LiteralPath $StateFile) {
    $stateOk = $false
    try {
      $parsed = Get-Content -LiteralPath $StateFile -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($parsed -and $parsed.meta -and $parsed.payments) { $stateOk = $true }
    } catch {
      $stateOk = $false
    }
    if ($stateOk) {
      Write-Ok '数据文件可正常解析'
    } else {
      Write-Warn 'data\state.json 无法解析。'
      if ($CheckOnly) {
        Write-Info '启动时会备份损坏文件并重新生成演示数据。'
      } else {
        $backup = "$StateFile.corrupt-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
        try {
          Move-Item -LiteralPath $StateFile -Destination $backup -Force
          Write-Info "已备份为 $(Split-Path -Leaf $backup)，启动时将重新生成演示数据。"
        } catch {
          Write-Fail "备份损坏数据失败：$($_.Exception.Message)"
          Write-Info '请手动移走 data\state.json 后重试。'
          return 1
        }
      }
    }
  } else {
    Write-Ok '尚未生成数据文件（首次启动会自动初始化演示数据）'
  }

  # 5. 端口
  $port = Find-FreePort $preferred
  if (-not $port) {
    Write-Fail "端口 $preferred–$([Math]::Min($preferred + 21, 65535)) 均被占用。"
    Write-Info '请关闭占用端口的程序，或设置环境变量 PORT 后重试。'
    return 1
  }
  if ($port -ne $preferred) {
    Write-Warn "端口 $preferred 已被占用，将使用 $port"
  } else {
    Write-Ok "端口 $port 可用"
  }

  # 6. 写入运行时信息（仅完整模式）
  if (-not $CheckOnly) {
    if (-not (Test-Path -LiteralPath $RuntimeDir)) {
      New-Item -ItemType Directory -Path $RuntimeDir -Force | Out-Null
    }
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($NodeExecFile, $node.Path, $utf8NoBom)
    [System.IO.File]::WriteAllText($PortFile, [string]$port, $utf8NoBom)
    Write-Ok '运行时信息已写入 .runtime'
  }

  Write-Rule
  if ($CheckOnly) {
    Write-Host '  环境检查通过。' -ForegroundColor Green
    Write-Host '  双击 start.cmd 即可启动服务。' -ForegroundColor Gray
  } else {
    Write-Host '  环境就绪，正在启动 PayLab...' -ForegroundColor Green
  }
  Write-Host ''
  return 0
}

try {
  $code = Invoke-Main
  exit $code
} catch {
  Write-Host ''
  Write-Fail "环境检查失败：$($_.Exception.Message)"
  Write-Info '可将上面的错误信息反馈给项目维护者。'
  exit 1
}
