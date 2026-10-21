$projectRoot=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$tokens=$null;$parseErrors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $projectRoot 'start-dev.ps1'),[ref]$tokens,[ref]$parseErrors)
foreach($name in @('Get-LocalIpv4Interfaces','Select-SingleLanIpv4','Resolve-PrimaryLanIpv4','Get-FrontendRunCommand')) {
    $definition=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name},$true)
    if($definition){Invoke-Expression $definition.Extent.Text}
}

Describe 'Startup speed and ordering' {
    It 'uses a sole physical gateway without importing NetTCPIP, including a gateway-free Docker adapter' {
        Mock Get-LocalIpv4Interfaces {
            @([pscustomobject]@{Address='192.0.2.10';HasGateway=$true;IsPhysical=$true;HasVpnRoutes=$false},
              [pscustomobject]@{Address='172.20.0.1';HasGateway=$false;IsPhysical=$false;HasVpnRoutes=$false})
        }
        Mock Get-NetRoute { throw 'Single-adapter startup must not load NetTCPIP' }
        Resolve-PrimaryLanIpv4 | Should Be '192.0.2.10'
        Assert-MockCalled Get-NetRoute -Times 0 -Exactly
    }

    It 'keeps route-based selection for multiple gateways, VPNs and ambiguous addresses' {
        $primary=[pscustomobject]@{Address='192.0.2.10';HasGateway=$true;IsPhysical=$true;HasVpnRoutes=$false}
        $second=[pscustomobject]@{Address='198.51.100.10';HasGateway=$true;IsPhysical=$true;HasVpnRoutes=$false}
        $vpn=[pscustomobject]@{Address='10.0.0.2';HasGateway=$false;IsPhysical=$false;HasVpnRoutes=$true}
        (Select-SingleLanIpv4 @($primary,$second)) | Should BeNullOrEmpty
        (Select-SingleLanIpv4 @($primary,$vpn)) | Should BeNullOrEmpty
        (Select-SingleLanIpv4 @()) | Should BeNullOrEmpty
        Mock Get-LocalIpv4Interfaces { @($primary,$second) }
        Mock Get-NetRoute { [pscustomobject]@{InterfaceIndex=77;RouteMetric=10;InterfaceMetric=5} }
        Mock Get-NetIPConfiguration { [pscustomobject]@{IPv4Address=@([pscustomobject]@{IPAddress='198.51.100.10'})} }
        Resolve-PrimaryLanIpv4 | Should Be '198.51.100.10'
        Assert-MockCalled Get-NetRoute -Times 1 -Exactly
    }

    It 'builds before waiting for the backend and serves only after both steps succeed' {
        $npm=Join-Path $TestDrive 'npm.cmd'
        $gate=Join-Path $TestDrive 'backend-ready.cmd'
        $log=Join-Path $TestDrive 'ordering.log'
        @'
@echo off
echo %*>>"%MES_STARTUP_TEST_LOG%"
if "%~2"=="build:production" exit /b %MES_STARTUP_TEST_BUILD_EXIT%
exit /b 0
'@ | Set-Content -LiteralPath $npm -Encoding ASCII
        @'
@echo off
echo backend-ready>>"%MES_STARTUP_TEST_LOG%"
exit /b %MES_STARTUP_TEST_GATE_EXIT%
'@ | Set-Content -LiteralPath $gate -Encoding ASCII
        $previousPath=$env:PATH
        try {
            $env:PATH=[string]$TestDrive+';'+$previousPath
            $env:MES_STARTUP_TEST_LOG=$log
            foreach($scenario in @(
                @{Build=0;Gate=0;Count=3},
                @{Build=1;Gate=0;Count=1},
                @{Build=0;Gate=1;Count=2}
            )) {
                if(Test-Path -LiteralPath $log){Remove-Item -LiteralPath $log}
                $env:MES_STARTUP_TEST_BUILD_EXIT=[string]$scenario.Build
                $env:MES_STARTUP_TEST_GATE_EXIT=[string]$scenario.Gate
                $command=Get-FrontendRunCommand -BuildProduction $true -BackendWaitCommand ('call "'+$gate+'"') -ListenHost '127.0.0.1' -ListenPort 25173
                & $env:ComSpec /d /s /c $command
                $lines=@(Get-Content -LiteralPath $log)
                $lines.Count | Should Be $scenario.Count
                $lines[0] | Should Be 'run build:production'
                if($scenario.Count -ge 2){$lines[1] | Should Be 'backend-ready'}
                if($scenario.Count -eq 3){$lines[2] | Should Be 'run serve:public -- --host 127.0.0.1 --port 25173'}
            }
        } finally {
            $env:PATH=$previousPath
            foreach($name in @('MES_STARTUP_TEST_LOG','MES_STARTUP_TEST_BUILD_EXIT','MES_STARTUP_TEST_GATE_EXIT')){[Environment]::SetEnvironmentVariable($name,$null,'Process')}
        }
    }

    It 'keeps development-server startup behind the backend check without a production build' {
        $command=Get-FrontendRunCommand -BuildProduction $false -BackendWaitCommand 'wait-for-backend' -ListenHost '0.0.0.0' -ListenPort 5173
        $command | Should Be 'wait-for-backend && npm run dev -- --host 0.0.0.0 --port 5173'
    }
}
