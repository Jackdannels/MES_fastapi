#ifndef SourceRoot
  #error SourceRoot must point to the native offline delivery directory
#endif
[Setup]
AppId={{AFDCDA3C-7FD9-4D4C-9C7F-4D91A923EE20}
AppName=MES Native Offline
AppVersion=2026.10.20.2
AppPublisher=MES
DefaultDirName=C:\MESNative\releases\2026.10.20-native.1
DefaultGroupName=MES Native
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir={#SourceRoot}
OutputBaseFilename=MES-Native-Setup-20261020-r1
Compression=lzma2/fast
SolidCompression=yes
WizardStyle=modern
DisableProgramGroupPage=yes
UninstallDisplayIcon={app}\desktop-tools\MES控制中心_原生版.exe
SetupLogging=yes
CloseApplications=no
RestartApplications=no

[Types]
Name: "full"; Description: "MES server with both simulators and desktop tools"
Name: "server"; Description: "MES server without simulators"
Name: "client"; Description: "Workstation and terminal-management tools only"
Name: "custom"; Description: "Custom components"; Flags: iscustom

[Components]
Name: "server"; Description: "MES server, private runtimes, MySQL and RabbitMQ"; Types: full server
Name: "simulators"; Description: "LIMS and upper-computer simulators"; Types: full
Name: "desktop"; Description: "Windows desktop tools"; Types: full server client

[Files]
Source: "{#SourceRoot}\payload\*"; DestDir: "{app}"; Components: server; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#SourceRoot}\payload\desktop-tools\*"; DestDir: "{app}\desktop-tools"; Components: desktop; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#SourceRoot}\prerequisites\vc_redist.x64.exe"; DestDir: "{tmp}"; Components: server; Flags: deleteafterinstall

[Code]
var
  PathsPage: TInputDirWizardPage;
  SettingsPage: TInputQueryWizardPage;
  CredentialsPage: TInputQueryWizardPage;
  BackupPage: TInputFileWizardPage;
  DataSourcePage: TInputOptionWizardPage;
  DockerDeploymentPage: TInputDirWizardPage;
  DockerEnvironmentPage: TInputFileWizardPage;
  DockerBackupPage: TInputDirWizardPage;
  PreviewPage: TInputOptionWizardPage;
  InstallationReady: Boolean;
  AutoEnvironmentFile: String;

function Quoted(const Value: String): String;
begin
  Result := '"' + Value + '"';
end;

function VCRuntimeAvailable: Boolean;
var
  Installed: Cardinal;
  Minor: Cardinal;
begin
  Result := RegQueryDWordValue(HKLM64, 'SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64', 'Installed', Installed)
    and (Installed = 1)
    and RegQueryDWordValue(HKLM64, 'SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64', 'Minor', Minor)
    and (Minor >= 30);
end;

procedure NativeOutput(const S: String; const Error, FirstLine: Boolean);
begin
  Log('MES: ' + S);
end;

function RunNativeManager(const Action, Arguments: String; var Code: Integer): Boolean;
begin
  Result := ExecAndLogOutput(ExpandConstant('{app}\runtime\python\python.exe'),
    '-I -X utf8 ' + Quoted(ExpandConstant('{app}\native\native_manager.py')) + ' ' + Action + Arguments,
    ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, Code, @NativeOutput);
end;

procedure InitializeWizard;
begin
  PathsPage := CreateInputDirPage(wpSelectComponents, 'MES data directory', 'Persistent data stays here after uninstall.', 'Select a NEW empty ASCII path without spaces. Example: C:\ProgramData\MESNative', False, '');
  PathsPage.Add('Data directory:');
  PathsPage.Values[0] := ExpandConstant('{param:DATADIR|C:\ProgramData\MESNative}');
  SettingsPage := CreateInputQueryPage(PathsPage.ID, 'MES connection', 'Configure this installation.', 'For a workstation-only install, enter the server URL.');
  SettingsPage.Add('Instance name (must start with MES):', False);
  SettingsPage.Add('Public MES URL (blank = localhost):', False);
  SettingsPage.Values[0] := ExpandConstant('{param:INSTANCE|MESNative}');
  SettingsPage.Values[1] := ExpandConstant('{param:PUBLICURL|}');
  PreviewPage := CreateInputOptionPage(SettingsPage.ID, 'Parallel preview', 'Choose service ports.', 'Use isolation ports for a parallel test. MES Web becomes 25173; AMQP uses 35672.', True, False);
  PreviewPage.Add('Use normal ports (MES Web 15173)');
  PreviewPage.Add('Use isolated preview ports (MES Web 25173)');
  PreviewPage.SelectedValueIndex := 0;
  if ExpandConstant('{param:PREVIEW|0}') = '1' then PreviewPage.SelectedValueIndex := 1;
  CredentialsPage := CreateInputQueryPage(PreviewPage.ID, 'MES administrator', 'Set the MES login.', 'Leave the password blank to generate a random password saved in the protected native configuration.');
  CredentialsPage.Add('MES administrator username:', False);
  CredentialsPage.Add('MES administrator password (8+ characters or blank):', True);
  CredentialsPage.Values[0] := 'admin';
  DataSourcePage := CreateInputOptionPage(CredentialsPage.ID, '业务数据来源', '选择本次安装的数据来源。', '从 Docker 迁移时，安装器自动导出并校验最新数据。正式端口模式会在导出成功后停止旧 Docker 部署；隔离预演模式会恢复旧部署继续运行。', True, False);
  DataSourcePage.Add('新建空数据库');
  DataSourcePage.Add('从已有备份恢复（选择 data-manifest.json）');
  DataSourcePage.Add('从本机当前 Docker 部署导出并迁移');
  DataSourcePage.SelectedValueIndex := 0;
  if ExpandConstant('{param:BACKUPMANIFEST|}') <> '' then DataSourcePage.SelectedValueIndex := 1;
  if ExpandConstant('{param:DOCKERDEPLOYMENT|}') <> '' then DataSourcePage.SelectedValueIndex := 2;
  DockerDeploymentPage := CreateInputDirPage(DataSourcePage.ID, '旧 Docker 部署目录', '选择已经在本机运行的 MES Docker release 目录。', '目录中应包含 compose.portable.yml 和 compose.portable.simulators.yml。迁移前请结束试验并停止新增业务录入；Docker Desktop 必须正在运行。', False, '');
  DockerDeploymentPage.Add('Docker release 目录：');
  DockerDeploymentPage.Values[0] := ExpandConstant('{param:DOCKERDEPLOYMENT|{userdesktop}\MES_Docker迁移交付_20261019-r1\release-20261019-r1}');
  DockerEnvironmentPage := CreateInputFilePage(DockerDeploymentPage.ID, 'Docker 环境文件', '使用旧部署实际运行时的环境文件。', '默认选择 release 目录下的 .tmp\portable.env。若原部署使用其他文件，请选择该文件。');
  DockerEnvironmentPage.Add('环境文件：', 'Environment files|*.env|All files|*.*', '.env');
  AutoEnvironmentFile := AddBackslash(DockerDeploymentPage.Values[0]) + '.tmp\portable.env';
  DockerEnvironmentPage.Values[0] := ExpandConstant('{param:DOCKERENV|}') ;
  if DockerEnvironmentPage.Values[0] = '' then DockerEnvironmentPage.Values[0] := AutoEnvironmentFile;
  DockerBackupPage := CreateInputDirPage(DockerEnvironmentPage.ID, '保存迁移备份', '备份会保留在安装目录之外。', '选择尚不存在的新目录。安装器会保存 MySQL、报告、LIMS 数据和校验清单。日志保存在备份目录旁的同名 .log 文件。旧容器、镜像和数据卷均保留。', False, '');
  DockerBackupPage.Add('新的备份目录：');
  DockerBackupPage.Values[0] := 'C:\MESBackups\docker-final-' + GetDateTimeString('yyyymmdd-hhnnss', '-', ':');
  if ExpandConstant('{param:DOCKERBACKUP|}') <> '' then DockerBackupPage.Values[0] := ExpandConstant('{param:DOCKERBACKUP}');
  BackupPage := CreateInputFilePage(DockerBackupPage.ID, '恢复已有业务备份', '选择已经导出并校验的备份。', '选择备份目录中的 data-manifest.json，安装器会校验并恢复其中的数据。');
  BackupPage.Add('Data backup manifest:', 'MES data manifest|data-manifest.json', '.json');
  BackupPage.Values[0] := ExpandConstant('{param:BACKUPMANIFEST|}');
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := (not WizardIsComponentSelected('server')) and ((PageID = PathsPage.ID) or (PageID = PreviewPage.ID) or (PageID = CredentialsPage.ID) or (PageID = DataSourcePage.ID) or (PageID = BackupPage.ID) or (PageID = DockerDeploymentPage.ID) or (PageID = DockerEnvironmentPage.ID) or (PageID = DockerBackupPage.ID));
  if PageID = BackupPage.ID then Result := Result or (DataSourcePage.SelectedValueIndex <> 1);
  if (PageID = DockerDeploymentPage.ID) or (PageID = DockerEnvironmentPage.ID) or (PageID = DockerBackupPage.ID) then
    Result := Result or (DataSourcePage.SelectedValueIndex <> 2);
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  I: Integer;
  Value: String;
begin
  Result := True;
  if ((CurPageID = wpSelectDir) or (CurPageID = PathsPage.ID)) and WizardIsComponentSelected('server') then begin
    if CurPageID = wpSelectDir then Value := WizardDirValue else Value := PathsPage.Values[0];
    for I := 1 to Length(Value) do begin
      if (Ord(Value[I]) > 127) or (Value[I] = ' ') then begin
        MsgBox('Choose an ASCII installation/data path without spaces for Erlang and RabbitMQ.', mbError, MB_OK);
        Result := False;
        Exit;
      end;
    end;
  end;
  if (CurPageID = CredentialsPage.ID) and (Length(CredentialsPage.Values[1]) > 0) and (Length(CredentialsPage.Values[1]) < 8) then begin
    MsgBox('MES login password must have at least 8 characters.', mbError, MB_OK);
    Result := False;
  end;
  if CurPageID = DockerDeploymentPage.ID then begin
    Value := AddBackslash(DockerDeploymentPage.Values[0]);
    if not FileExists(Value + 'compose.portable.yml') or not FileExists(Value + 'compose.portable.simulators.yml') then begin
      MsgBox('请选择包含两个 compose.portable 配置文件的 Docker release 目录。', mbError, MB_OK);
      Result := False;
    end else begin
      if DockerEnvironmentPage.Values[0] = AutoEnvironmentFile then DockerEnvironmentPage.Values[0] := Value + '.tmp\portable.env';
      AutoEnvironmentFile := Value + '.tmp\portable.env';
    end;
  end;
  if (CurPageID = DockerEnvironmentPage.ID) and not FileExists(DockerEnvironmentPage.Values[0]) then begin
    MsgBox('请选择旧 Docker 部署实际使用的环境文件。', mbError, MB_OK);
    Result := False;
  end;
  if CurPageID = DockerBackupPage.ID then begin
    Value := RemoveBackslashUnlessRoot(DockerBackupPage.Values[0]);
    DockerBackupPage.Values[0] := Value;
    if (Value = '') or DirExists(Value) or FileExists(Value) or FileExists(Value + '.log') then begin
      MsgBox('备份目录及旁边的同名 .log 文件必须尚不存在，请选择新路径。', mbError, MB_OK);
      Result := False;
    end;
  end;
  if (CurPageID = BackupPage.ID) and not FileExists(BackupPage.Values[0]) then begin
    MsgBox('请选择备份目录中的 data-manifest.json。', mbError, MB_OK);
    Result := False;
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  Code: Integer;
  Arguments: String;
  PasswordFile: String;
  ClientJson: String;
  URL: String;
  ExportArguments: String;
  BackupDirectory: String;
  ExportLog: String;
begin
  if CurStep <> ssPostInstall then Exit;
  if WizardIsComponentSelected('server') then begin
    if WizardIsComponentSelected('simulators') and not WizardIsComponentSelected('desktop') then
      Log('Installing simulators without desktop shortcuts.');
    if not VCRuntimeAvailable then begin
      if not Exec(ExpandConstant('{tmp}\vc_redist.x64.exe'), '/install /quiet /norestart', '', SW_HIDE, ewWaitUntilTerminated, Code) or ((Code <> 0) and (Code <> 1638) and (Code <> 3010)) then
        RaiseException('VC runtime installation failed. See the installation log.');
    end;
    Arguments := ' --data-root ' + Quoted(PathsPage.Values[0]) + ' --instance ' + Quoted(SettingsPage.Values[0]);
    if not WizardIsComponentSelected('simulators') then Arguments := Arguments + ' --no-simulators';
    if PreviewPage.SelectedValueIndex = 1 then Arguments := Arguments + ' --port-offset 10000';
    if SettingsPage.Values[1] <> '' then Arguments := Arguments + ' --public-url ' + Quoted(SettingsPage.Values[1]);
    if CredentialsPage.Values[0] <> '' then Arguments := Arguments + ' --admin-user ' + Quoted(CredentialsPage.Values[0]);
    BackupDirectory := '';
    if DataSourcePage.SelectedValueIndex = 1 then begin
      BackupDirectory := ExtractFileDir(BackupPage.Values[0]);
      Arguments := Arguments + ' --backup ' + Quoted(BackupDirectory);
    end;
    PasswordFile := ExpandConstant('{tmp}\mes-native-install-password.txt');
    if CredentialsPage.Values[1] <> '' then begin
      SaveStringToFile(PasswordFile, UTF8Encode(CredentialsPage.Values[1]), False);
      Arguments := Arguments + ' --admin-password-file ' + Quoted(PasswordFile);
    end;
    try
      if DataSourcePage.SelectedValueIndex = 2 then begin
        WizardForm.StatusLabel.Caption := '检查原生安装目录、实例名和配置...';
        ExportArguments := Arguments + ' --migration-output ' + Quoted(DockerBackupPage.Values[0]);
        if PreviewPage.SelectedValueIndex = 0 then ExportArguments := ExportArguments + ' --skip-port-check';
        if not RunNativeManager('preflight', ExportArguments, Code) or (Code <> 0) then
          RaiseException('原生安装预检查失败，尚未导出或停止 Docker。请查看安装日志并修正目标目录、实例名或连接配置。');
        BackupDirectory := DockerBackupPage.Values[0];
        ExportLog := BackupDirectory + '.log';
        WizardForm.StatusLabel.Caption := '正在导出并校验 Docker 数据，请等待。进度日志：' + ExportLog;
        ExportArguments := '-I -X utf8 ' + Quoted(ExpandConstant('{app}\native\export_docker_data.py'))
          + ' --deployment ' + Quoted(DockerDeploymentPage.Values[0])
          + ' --environment-file ' + Quoted(DockerEnvironmentPage.Values[0])
          + ' --output ' + Quoted(BackupDirectory) + ' --log-file ' + Quoted(ExportLog);
        if PreviewPage.SelectedValueIndex = 0 then ExportArguments := ExportArguments + ' --leave-stopped --stop-deployment';
        if not ExecAndLogOutput(ExpandConstant('{app}\runtime\python\python.exe'), ExportArguments, ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, Code, @NativeOutput) or (Code <> 0) then
          RaiseException('Docker 数据导出或停止部署未完成，未开始原生数据库安装。请查看 ' + ExportLog + '。导出失败时工具会尝试恢复旧业务服务；若日志显示备份已校验成功，请先检查旧部署的停止状态。');
        if not FileExists(AddBackslash(BackupDirectory) + 'data-manifest.json') then
          RaiseException('未找到已导出的 data-manifest.json，原生安装已中止。请保留备份并查看 ' + ExportLog);
        Arguments := Arguments + ' --backup ' + Quoted(BackupDirectory);
      end;
      WizardForm.StatusLabel.Caption := '正在安装原生服务并恢复业务数据...';
      if not RunNativeManager('install', Arguments, Code) or (Code <> 0) then
        RaiseException('MES 原生服务安装未完成。请保留备份 ' + BackupDirectory + '，查看安装日志及数据目录中的 config/native.json 和 logs。不要向已有数据目录重复恢复。正式迁移导出成功后，旧 Docker 保持停止。');
    finally
      DeleteFile(PasswordFile);
    end;
    RegWriteStringValue(HKLM, 'Software\MESNative\' + SettingsPage.Values[0], 'DataRoot', PathsPage.Values[0]);
    if WizardIsComponentSelected('desktop') then begin
      CreateShellLink(ExpandConstant('{commondesktop}\MES控制中心_原生版.lnk'), 'MES native services', PathsPage.Values[0] + '\desktop\MES控制中心_原生版.exe', '', PathsPage.Values[0] + '\desktop', '', 0, SW_SHOWNORMAL);
      CreateShellLink(ExpandConstant('{commondesktop}\MES工作台设置_原生版.lnk'), 'MES workstation', PathsPage.Values[0] + '\desktop\MES工作台设置_原生版.exe', '', PathsPage.Values[0] + '\desktop', '', 0, SW_SHOWNORMAL);
      CreateShellLink(ExpandConstant('{commondesktop}\MES终端管理_原生版.lnk'), 'MES terminal manager', PathsPage.Values[0] + '\desktop\MES终端管理_原生版.exe', '', PathsPage.Values[0] + '\desktop', '', 0, SW_SHOWNORMAL);
    end;
    SaveStringToFile(ExpandConstant('{app}\native-install-pointer.txt'), PathsPage.Values[0] + '\config\native.json', False);
  end else begin
    URL := SettingsPage.Values[1];
    if URL = '' then URL := 'http://127.0.0.1:15173';
    ClientJson := '{"deploymentMode":"windows-service","serverUrl":"' + URL + '"}';
    SaveStringToFile(ExpandConstant('{app}\desktop-tools\mes-desktop-tools.json'), ClientJson, False);
    CreateShellLink(ExpandConstant('{commondesktop}\MES工作台设置_原生版.lnk'), 'MES workstation', ExpandConstant('{app}\desktop-tools\MES工作台设置_原生版.exe'), '', ExpandConstant('{app}\desktop-tools'), '', 0, SW_SHOWNORMAL);
    CreateShellLink(ExpandConstant('{commondesktop}\MES终端管理_原生版.lnk'), 'MES terminal manager', ExpandConstant('{app}\desktop-tools\MES终端管理_原生版.exe'), '', ExpandConstant('{app}\desktop-tools'), '', 0, SW_SHOWNORMAL);
  end;
  InstallationReady := True;
end;

function InitializeUninstall: Boolean;
var
  Config: AnsiString;
  Code: Integer;
begin
  Result := True;
  if FileExists(ExpandConstant('{app}\native-install-pointer.txt')) then begin
    if LoadStringFromFile(ExpandConstant('{app}\native-install-pointer.txt'), Config) then begin
      if not Exec(ExpandConstant('{app}\runtime\python\python.exe'), '-I -X utf8 ' + Quoted(ExpandConstant('{app}\native\native_manager.py')) + ' uninstall --config ' + Quoted(Config), ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, Code) or (Code <> 0) then begin
        MsgBox('Could not remove MES services. Files and data will be retained. Stop the services and retry.', mbError, MB_OK);
        Result := False;
      end;
    end;
  end;
end;

[UninstallDelete]
Type: files; Name: "{commondesktop}\MES控制中心_原生版.lnk"
Type: files; Name: "{commondesktop}\MES工作台设置_原生版.lnk"
Type: files; Name: "{commondesktop}\MES终端管理_原生版.lnk"
