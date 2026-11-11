#ifndef SourceRoot
  #error SourceRoot must identify the verified Docker delivery folder
#endif
[Setup]
AppId={{BC651AD6-D418-4899-A2D6-5826B0129010}
AppName=交付版5826信息化管理系统
AppVersion=1.2
AppVerName=交付版5826信息化管理系统v1.2
VersionInfoVersion=1.2.0.0
AppPublisher=5826
DefaultDirName=C:\5826MES\v1.2
DisableDirPage=no
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir={#OutputRoot}
OutputBaseFilename=交付版5826信息化管理系统v1.2_安装程序
Compression=lzma2/fast
SolidCompression=yes
WizardStyle=modern
WizardSizePercent=120
DisableProgramGroupPage=yes
DisableWelcomePage=no
UsePreviousAppDir=no
UsePreviousSetupType=no
UsePreviousTasks=no
Uninstallable=no
SetupLogging=yes
CloseApplications=no
RestartApplications=no
SetupIconFile={#ProjectRoot}\assets\mes-control-center.ico

[Languages]
Name: "chinesesimplified"; MessagesFile: "compiler:Default.isl"

[Messages]
SetupAppTitle=安装程序
SetupWindowTitle=安装 — %1
InformationTitle=提示
ConfirmTitle=确认
ErrorTitle=安装失败
ExitSetupTitle=确认退出安装
ExitSetupMessage=安装尚未完成。现在退出将中断安装。%n%n已解压的文件会保留。若安装目录中已生成“继续完成安装.cmd”，可通过该入口继续。%n%n确定退出安装吗？
ButtonOK=确定
ButtonYes=是(&Y)
ButtonNo=否(&N)
ButtonYesToAll=全部选是
ButtonNoToAll=全部选否
ButtonBack=< 上一步(&B)
ButtonNext=下一步(&N) >
ButtonInstall=安装(&I)
ButtonCancel=取消
ButtonFinish=完成
ButtonBrowse=浏览(&B)...
ButtonWizardBrowse=浏览(&B)...
BrowseDialogTitle=选择文件夹
BrowseDialogLabel=请选择需要的文件夹，然后点击确定。
SelectDirBrowseLabel=点击“浏览”选择自定义目录，然后点击“下一步”。
WizardPreparing=正在检查安装环境
PreparingDesc=正在检查 Docker Linux 引擎及安装条件，请稍候。
CannotContinue=当前安装条件尚未满足。请按上面的提示处理后重试，或点击取消退出。
ReadyMemoDir=安装目录：
ReadyMemoType=安装类型：
ReadyMemoComponents=已选组件：
WelcomeLabel1=欢迎安装交付版5826信息化管理系统v1.2
WelcomeLabel2=本向导将解压离线部署文件、配置现场网络，并生成选中的客户端。%n%n主机安装需要已安装并初始化的 Docker Desktop Linux 引擎。工位客户端可连接已有 MES 主机。
WizardSelectDir=选择安装目录
SelectDirDesc=将系统安装到哪个文件夹？
SelectDirLabel3=请选择新的或空的安装文件夹。部署文件、配置、日志及所选工位程序均保存在该目录中。
WizardSelectComponents=选择安装内容
SelectComponentsDesc=选择本机需要的服务与工位客户端。
SelectComponentsLabel2=主机安装包括 Docker 服务、控制中心 v2.9.0 与独立中控管理。可按需勾选试验间和其他工位，每个工位生成独立文件夹。
WizardReady=准备安装
ReadyLabel1=配置已就绪，点击“安装”开始解压和部署。
ReadyLabel2a=可返回检查安装目录、网络地址和选中的工位。
WizardInstalling=正在安装
InstallingLabel=正在解压文件，请稍候...
FinishedHeadingLabel=交付版5826信息化管理系统v1.2 安装完成
FinishedLabelNoIcons=部署文件与所选客户端已准备完成，可通过桌面快捷方式启动。%n%n工位客户端首次使用时需在本机完成管理员绑定。

[Types]
Name: "server"; Description: "MES 主机（服务、控制中心和中控管理）"
Name: "workstation"; Description: "工位电脑（连接已有 MES 主机）"
Name: "custom"; Description: "自定义安装内容"; Flags: iscustom

[Components]
Name: "server"; Description: "MES Docker 服务、两个模拟器及控制中心 v2.9.0"; Types: server
Name: "central"; Description: "独立中控管理客户端（可双击启动）"; Types: server
Name: "workstations"; Description: "试验间及其他工位客户端（按需选择）"; Types: workstation
#include WorkstationComponents

[Files]
; Keep network helpers before large solid blocks for fast wizard startup.
Source: "{#ProjectRoot}\deploy\portable\Detect-Network.ps1"; Flags: dontcopy
Source: "{#ProjectRoot}\scripts\deploy\Mes-PortableHost.ps1"; Flags: dontcopy
Source: "{#ProjectRoot}\deploy\portable\Check-Docker.ps1"; Flags: dontcopy
Source: "{#SourceRoot}\*"; DestDir: "{app}\package"; Flags: ignoreversion
Source: "{#SourceRoot}\prerequisites\*"; DestDir: "{app}\package\prerequisites"; Flags: ignoreversion solidbreak
Source: "{#SourceRoot}\release-{#ReleaseVersion}\*"; DestDir: "{app}\package\release-{#ReleaseVersion}"; Excludes: ".tmp\*"; Components: server; Flags: ignoreversion recursesubdirs createallsubdirs solidbreak
Source: "{#SourceRoot}\data-backup-{#ReleaseVersion}\*"; DestDir: "{app}\package\data-backup-{#ReleaseVersion}"; Components: server; Flags: ignoreversion recursesubdirs createallsubdirs solidbreak
Source: "{#SourceRoot}\desktop-tools\*"; DestDir: "{app}\package\desktop-tools"; Components: server; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#SourceRoot}\desktop-tools\central-client\*"; DestDir: "{app}\package\desktop-tools\central-client"; Components: central; Check: not IsServer; Flags: ignoreversion recursesubdirs createallsubdirs
#include WorkstationFiles

[Run]
Filename: "{app}\管理端\MES控制中心_Docker版.exe"; Description: "打开控制中心"; Flags: nowait postinstall skipifsilent runasoriginaluser; Check: IsServer

[Code]
var
  DockerPathPage: TInputFileWizardPage;
  NetworkPage: TInputOptionWizardPage;
  ConnectionPage: TInputQueryWizardPage;
  Addresses: TStringList;
  DeploymentReady: Boolean;

function IsServer: Boolean;
begin
  Result := WizardIsComponentSelected('server');
end;

function Quoted(const S: String): String;
begin
  Result := '"' + S + '"';
end;

procedure InitializeWizard;
var
  Code, I: Integer;
  NetworkFile: String;
begin
  WizardForm.Font.Name := 'Microsoft YaHei UI';
  Addresses := TStringList.Create;
  ExtractTemporaryFile('Detect-Network.ps1');
  ExtractTemporaryFile('Mes-PortableHost.ps1');
  NetworkFile := ExpandConstant('{tmp}\mes-network.txt');
  Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
    '-NoProfile -ExecutionPolicy Bypass -File ' + Quoted(ExpandConstant('{tmp}\Detect-Network.ps1')) + ' -OutputFile ' + Quoted(NetworkFile),
    '', SW_HIDE, ewWaitUntilTerminated, Code);
  if FileExists(NetworkFile) then Addresses.LoadFromFile(NetworkFile);
  if Addresses.Count = 0 then Addresses.Add('127.0.0.1  (仅本机)');
  DockerPathPage := CreateInputFilePage(wpSelectComponents, 'Docker Desktop 位置（可选）', '支持默认、按用户或自定义安装目录。', '留空时自动查找。也可浏览选择任意磁盘中的 Docker Desktop.exe；请先完成 Docker Desktop 和 WSL 的初始化。');
  DockerPathPage.Add('Docker Desktop.exe（可留空自动识别）：', '可执行文件|*.exe', '.exe');
  DockerPathPage.Values[0] := ExpandConstant('{param:DOCKERDESKTOP|}');
  NetworkPage := CreateInputOptionPage(DockerPathPage.ID, '选择主机网络', '选择供其他工位访问的本机地址。',
    '已排除 Docker / WSL 等虚拟网卡。若存在多块网卡，请选择现场工位能够访问的有线或 Wi-Fi 网络。', True, False);
  for I := 0 to Addresses.Count - 1 do NetworkPage.Add(Addresses[I]);
  NetworkPage.SelectedValueIndex := 0;
  ConnectionPage := CreateInputQueryPage(NetworkPage.ID, 'MES 服务器地址', '确认本机客户端将连接的 MES 地址。',
    '主机安装填写所选本机 IPv4 与 Web 端口；工位安装填写已有 MES 主机的地址。例如 http://192.168.1.20:15173');
  ConnectionPage.Add('MES 根地址（HTTP(S) 主机与端口）：', False);
  ConnectionPage.Values[0] := ExpandConstant('{param:SERVERURL|}');
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := ((PageID = NetworkPage.ID) or (PageID = DockerPathPage.ID)) and not IsServer;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Found: TFindRec;
  Code: Integer;
  StatusFile, CheckArguments: String;
  Details: TStringList;
begin
  Result := '';
  if DirExists(WizardDirValue) and FindFirst(AddBackslash(WizardDirValue) + '*', Found) then begin
    try
      repeat
        if (Found.Name <> '.') and (Found.Name <> '..') then begin
          Result := '安装目录已有文件，请选择新的或空的文件夹，保留原部署与数据。'; Break;
        end;
      until not FindNext(Found);
    finally FindClose(Found); end;
  end;
  if (Result = '') and IsServer then begin
    ExtractTemporaryFile('Check-Docker.ps1');
    StatusFile := ExpandConstant('{tmp}\docker-check.txt');
    CheckArguments := '-NoProfile -ExecutionPolicy Bypass -File ' + Quoted(ExpandConstant('{tmp}\Check-Docker.ps1')) + ' -OutputFile ' + Quoted(StatusFile);
    if DockerPathPage.Values[0] <> '' then CheckArguments := CheckArguments + ' -DesktopExecutable ' + Quoted(DockerPathPage.Values[0]);
    if not Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
      CheckArguments,
      '', SW_HIDE, ewWaitUntilTerminated, Code) or (Code <> 0) then begin
      Result := 'Docker Linux 引擎未就绪，请先处理 Docker Desktop 的启动提示，再重新点击安装。';
      if FileExists(StatusFile) then begin
        Details := TStringList.Create;
        try Details.LoadFromFile(StatusFile); Result := Details.Text; finally Details.Free; end;
      end;
    end;
  end;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  Found: TFindRec;
  Value: String;
  P: Integer;
begin
  Result := True;
  if CurPageID = wpSelectDir then begin
    if DirExists(WizardDirValue) and FindFirst(AddBackslash(WizardDirValue) + '*', Found) then begin
      try
        repeat
          if (Found.Name <> '.') and (Found.Name <> '..') then begin
            if not WizardSilent then MsgBox('请选择新的或空的安装文件夹，以保留已有配置与数据。', mbError, MB_OK);
            Result := False; Break;
          end;
        until not FindNext(Found);
      finally FindClose(Found); end;
    end;
  end;
  if CurPageID = wpSelectComponents then begin
    if not IsServer and not WizardIsComponentSelected('central') and not WizardIsComponentSelected('workstations') then begin
      if not WizardSilent then MsgBox('请至少选择主机、中控管理或一个工位客户端。', mbError, MB_OK); Result := False;
    end;
  end;
  if CurPageID = NetworkPage.ID then begin
    Value := Addresses[NetworkPage.SelectedValueIndex]; P := Pos(' ', Value);
    if P > 0 then Value := Copy(Value, 1, P - 1);
    if ExpandConstant('{param:SERVERURL|}') = '' then ConnectionPage.Values[0] := 'http://' + Value + ':15173';
  end;
  if (CurPageID = DockerPathPage.ID) and (DockerPathPage.Values[0] <> '') and not FileExists(DockerPathPage.Values[0]) then begin
    if not WizardSilent then MsgBox('指定的 Docker Desktop.exe 不存在，请重新选择或留空自动识别。', mbError, MB_OK); Result := False;
  end;
  if CurPageID = ConnectionPage.ID then begin
    Value := Trim(ConnectionPage.Values[0]);
    if ((Pos('http://', Value) <> 1) and (Pos('https://', Value) <> 1)) or (Pos('"', Value) > 0) or (Pos(#13, Value) > 0) or (Pos(#10, Value) > 0) then begin
      if not WizardSilent then MsgBox('请填写完整 HTTP(S) 根地址，例如 http://192.168.1.20:15173。', mbError, MB_OK); Result := False;
    end;
  end;
end;

function SelectedWorkstations: String;
begin
  Result := '';
  #include WorkstationSelections
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  Arguments, Role, ErrorFile: String;
  Details: TStringList;
  Code: Integer;
begin
  if CurStep = ssPostInstall then begin
    WizardForm.StatusLabel.Caption := '正在校验、配置并部署所选组件，请等待完成...';
    if IsServer then Role := 'server' else Role := 'client';
    Arguments := '-NoProfile -ExecutionPolicy Bypass -File ' + Quoted(ExpandConstant('{app}\package\Install-Delivery.ps1'))
      + ' -PackageRoot ' + Quoted(ExpandConstant('{app}\package')) + ' -InstallDirectory ' + Quoted(WizardDirValue)
      + ' -Role ' + Role + ' -ServerUrl ' + Quoted(ConnectionPage.Values[0]);
    if SelectedWorkstations <> '' then Arguments := Arguments + ' -Workstations ' + Quoted(SelectedWorkstations);
    if WizardIsComponentSelected('central') then Arguments := Arguments + ' -CentralClient';
    if DockerPathPage.Values[0] <> '' then Arguments := Arguments + ' -DockerDesktopPath ' + Quoted(DockerPathPage.Values[0]);
    Arguments := Arguments + ' -PortOffset ' + ExpandConstant('{param:PORTOFFSET|0}');
    if ExpandConstant('{param:DESKTOPDIR|}') <> '' then Arguments := Arguments + ' -DesktopDirectory ' + Quoted(ExpandConstant('{param:DESKTOPDIR}'));
    if not Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'), Arguments, '', SW_HIDE, ewWaitUntilTerminated, Code) or (Code <> 0) then begin
      ErrorFile := ExpandConstant('{app}\package\.local\logs\last-install-error.txt');
      Role := '部署失败（退出码 ' + IntToStr(Code) + '）。请查看 package\.local\logs，或双击“继续完成安装.cmd”。';
      if FileExists(ErrorFile) then begin
        Details := TStringList.Create;
        try Details.LoadFromFile(ErrorFile); Role := Details.Text; finally Details.Free; end;
      end;
      Log(Role);
      if not WizardSilent then MsgBox(Role, mbError, MB_OK);
      Abort;
    end;
    DeploymentReady := True;
  end;
end;

function GetCustomSetupExitCode: Integer;
begin
  if DeploymentReady then Result := 0 else Result := 1;
end;
