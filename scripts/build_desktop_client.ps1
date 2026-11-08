[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$OutputDirectory,
    [string]$ServerUrl = '',
    [ValidateSet('central','lims','upper-computer','laboratory','visual','handover','staging','appearance')][string]$Module = 'central',
    [string]$LaboratoryCode = '',
    [switch]$CombineSimulators,
    [string]$LimsUrl = 'http://127.0.0.1:8900',
    [string]$UpperComputerUrl = 'http://127.0.0.1:8899',
    [string]$SdkPackagePath = '',
    [string]$RuntimeInstallerPath = '',
    [string]$FixedRuntimeDirectory = '',
    [switch]$Offline
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$project = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$roles = @{
    'central' = @{Title='MES 中控管理'; Executable='MES中控管理.exe'; Server='http://127.0.0.1:15173'}
    'lims' = @{Title='MES LIMS 模拟器'; Executable='MES_LIMS模拟器.exe'; Server='http://127.0.0.1:8900'}
    'upper-computer' = @{Title='MES 上位机模拟器'; Executable='MES上位机模拟器.exe'; Server='http://127.0.0.1:8899'}
    'laboratory' = @{Title='MES 实验间'; Executable='MES实验间.exe'; Server='http://127.0.0.1:15173'; Entry='/laboratory'}
    'visual' = @{Title='MES 可视化管理'; Executable='MES可视化管理.exe'; Server='http://127.0.0.1:15173'; Entry='/visualization'}
    'handover' = @{Title='MES 接驳区系统'; Executable='MES接驳区系统.exe'; Server='http://127.0.0.1:15173'; Entry='/handover-system'}
    'staging' = @{Title='MES 暂存间系统'; Executable='MES暂存间系统.exe'; Server='http://127.0.0.1:15173'; Entry='/staging-management'}
    'appearance' = @{Title='MES 外观检测间系统'; Executable='MES外观检测间系统.exe'; Server='http://127.0.0.1:15173'; Entry='/appearance-inspection'}
}
$role = $roles[$Module]
$labName = ''
$entryPath = if ($role.ContainsKey('Entry')) { $role.Entry } else { '/' }
if ($Module -eq 'laboratory') {
    $catalog = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $project 'tools/desktop-client/workstations.json') | ConvertFrom-Json
    $rooms = @($catalog | Where-Object { $_.module -eq 'laboratory' -and $_.labCode -ceq $LaboratoryCode })
    if ($rooms.Count -ne 1) { throw 'Laboratory clients require a known -LaboratoryCode from workstations.json.' }
    $labName = $rooms[0].labName
    $role.Title = 'MES ' + $labName
    $role.Executable = 'MES' + $labName + '.exe'
    $entryPath += '?lab=' + [Uri]::EscapeDataString($LaboratoryCode)
} elseif ($LaboratoryCode) { throw 'LaboratoryCode is available on laboratory clients only.' }
if ($CombineSimulators -and $Module -ne 'central') { throw 'Combined simulator tabs are available on the central client only.' }
if (-not $ServerUrl) { $ServerUrl = $role.Server }
$server = $null
if (-not [Uri]::TryCreate($ServerUrl,[UriKind]::Absolute,[ref]$server) -or $server.Scheme -notin @('http','https') -or $server.UserInfo -or $server.Query -or $server.Fragment -or $server.AbsolutePath -ne '/') { throw 'ServerUrl must be an HTTP(S) origin without credentials or path.' }
$output = [IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $output) { throw 'Client output directory already exists; choose an empty new directory.' }
$sdk = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $project 'tools/desktop-client/webview2-sdk.json') | ConvertFrom-Json
$cache = Join-Path $project '.tmp/desktop-client-sdk'
New-Item -ItemType Directory -Force -Path $cache | Out-Null
function Get-Sha256([string]$Path) {
    $stream = [IO.File]::OpenRead($Path)
    $hash = [Security.Cryptography.SHA256]::Create()
    try { return (-join ($hash.ComputeHash($stream) | ForEach-Object { $_.ToString('x2') })) }
    finally { $hash.Dispose(); $stream.Dispose() }
}
if (-not $SdkPackagePath) {
    $SdkPackagePath = Join-Path $cache ('microsoft.web.webview2.' + $sdk.version + '.nupkg')
    if (-not (Test-Path -LiteralPath $SdkPackagePath)) {
        if ($Offline) { throw 'WebView2 SDK cache missing. Supply -SdkPackagePath with the pinned NuGet package.' }
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        $download = New-Object Net.WebClient
        try { $download.DownloadFile($sdk.url, $SdkPackagePath) } finally { $download.Dispose() }
    }
}
if ((Get-Sha256 $SdkPackagePath) -ne $sdk.sha256) { throw 'WebView2 SDK package SHA-256 does not match the pinned version.' }
if ($RuntimeInstallerPath -and $FixedRuntimeDirectory) { throw 'Select either an Evergreen installer or a fixed runtime.' }
if ($RuntimeInstallerPath -or $FixedRuntimeDirectory) {
    Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1')
    $signedFile = if ($RuntimeInstallerPath) { $RuntimeInstallerPath } else { Join-Path $FixedRuntimeDirectory 'msedgewebview2.exe' }
    $signature = Get-AuthenticodeSignature -LiteralPath $signedFile
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') {
        throw 'Runtime installer or fixed runtime must have a valid Microsoft Authenticode signature.'
    }
}
if ($FixedRuntimeDirectory -and -not (Test-Path -LiteralPath (Join-Path $FixedRuntimeDirectory 'msedgewebview2.exe'))) {
    throw 'Fixed runtime directory does not contain msedgewebview2.exe.'
}
$csc = @('C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe','C:/Windows/Microsoft.NET/Framework/v4.0.30319/csc.exe') | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $csc) { throw '.NET Framework C# compiler was not found.' }
$staging = Join-Path $cache ('build-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $staging,$output | Out-Null
try {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::ExtractToDirectory([IO.Path]::GetFullPath($SdkPackagePath), $staging)
    $core = Join-Path $staging 'lib/net462/Microsoft.Web.WebView2.Core.dll'
    $forms = Join-Path $staging 'lib/net462/Microsoft.Web.WebView2.WinForms.dll'
    $executable = Join-Path $output $role.Executable
    $buildSource = Join-Path $staging 'ClientBuild.cs'
    $buildText = 'namespace MESDesktopClient { internal static class ClientBuild { internal const string Module = "' + $Module + '"; internal const string Title = "' + $role.Title + '"; internal const string DefaultServer = "' + $role.Server + '"; internal const string LabCode = "' + $LaboratoryCode + '"; internal const string LabName = "' + $labName + '"; internal const string EntryPath = "' + $entryPath + '"; } }'
    [IO.File]::WriteAllText($buildSource, $buildText, (New-Object Text.UTF8Encoding($true)))
    $arguments = @('/nologo','/target:winexe','/platform:x64','/optimize+','/codepage:65001',
        '/reference:System.Windows.Forms.dll','/reference:System.Drawing.dll','/reference:System.Web.Extensions.dll','/reference:System.Core.dll','/reference:System.Security.dll',
        ('/reference:' + $core),('/reference:' + $forms),('/win32icon:' + (Join-Path $project 'assets/mes-control-center.ico')),('/out:' + $executable))
    $arguments += @('ClientConfiguration.cs','ClientHostInfo.cs','ClientInstance.cs','ClientTerminalAuth.cs','ExitConfirmationDialog.cs','ClientForm.cs','Program.cs') | ForEach-Object { Join-Path $project ('tools/desktop-client/' + $_) }
    $arguments += $buildSource
    & $csc @arguments
    if ($LASTEXITCODE -ne 0) { throw 'MES desktop client compilation failed.' }
    foreach ($path in @($core,$forms,(Join-Path $staging 'runtimes/win-x64/native/WebView2Loader.dll'))) {
        Copy-Item -LiteralPath $path -Destination $output
    }
    $encoding = New-Object Text.UTF8Encoding($false)
    [IO.File]::WriteAllText(($executable + '.config'), '<?xml version="1.0" encoding="utf-8"?><configuration><startup><supportedRuntime version="v4.0" sku=".NETFramework,Version=v4.8" /></startup></configuration>', $encoding)
    $config = [ordered]@{serverUrl=$ServerUrl.TrimEnd('/'); module=$Module; title=$role.Title; startMaximized=$true}
    if ($Module -notin @('central','lims','upper-computer')) { $config.autoLogin=$true }
    if ($labName) { $config.labCode=$LaboratoryCode; $config.labName=$labName }
    if ($CombineSimulators) {
        $config.simulatorsEnabled = $true
        $config.limsUrl = $LimsUrl.TrimEnd('/')
        $config.upperComputerUrl = $UpperComputerUrl.TrimEnd('/')
    }
    if ($FixedRuntimeDirectory) {
        Copy-Item -LiteralPath $FixedRuntimeDirectory -Destination (Join-Path $output 'WebView2Runtime') -Recurse
        $config.runtimeDirectory = 'WebView2Runtime'
    }
    if ($RuntimeInstallerPath) {
        New-Item -ItemType Directory -Path (Join-Path $output 'prerequisites') | Out-Null
        Copy-Item -LiteralPath $RuntimeInstallerPath -Destination (Join-Path $output 'prerequisites/MicrosoftEdgeWebView2RuntimeInstallerX64.exe')
    }
    [IO.File]::WriteAllText((Join-Path $output 'mes-client.json'), ($config | ConvertTo-Json), $encoding)
    Copy-Item -LiteralPath (Join-Path $project 'docs/desktop-client.md') -Destination (Join-Path $output '使用说明.md')
    $license = Join-Path $staging 'LICENSE.txt'
    if (Test-Path -LiteralPath $license) { Copy-Item -LiteralPath $license -Destination (Join-Path $output 'WebView2-LICENSE.txt') }
    $inventory = @(foreach ($file in Get-ChildItem -LiteralPath $output -File -Recurse) {
        [ordered]@{path=$file.FullName.Substring($output.Length + 1).Replace('\','/'); bytes=$file.Length; sha256=(Get-Sha256 $file.FullName)}
    })
    $manifest = [ordered]@{format='mes-desktop-client'; version='1.7.0'; platform='windows-x64-net48'; module=$Module; labCode=$LaboratoryCode; labName=$labName; executable=$role.Executable; entryPath=$entryPath; simulatorsEnabled=[bool]$CombineSimulators; sdkVersion=$sdk.version; runtimeBundled=[bool]($RuntimeInstallerPath -or $FixedRuntimeDirectory); files=$inventory}
    [IO.File]::WriteAllText((Join-Path $output 'client-manifest.json'), ($manifest | ConvertTo-Json -Depth 5), $encoding)
    Write-Output ('MES ' + $Module + ' client built: ' + $output)
} finally {
    $resolved = [IO.Path]::GetFullPath($staging)
    $cachePrefix = [IO.Path]::GetFullPath($cache).TrimEnd('\') + '\'
    if (-not $resolved.StartsWith($cachePrefix,[StringComparison]::OrdinalIgnoreCase) -or (Split-Path -Leaf $resolved) -notlike 'build-*') { throw 'Refused to remove unexpected SDK staging directory.' }
    if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
