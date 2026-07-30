using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Management;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using System.Web.Script.Serialization;
using System.Xml.Serialization;
using Microsoft.Win32;

[assembly: AssemblyTitle("MES 工作台设置")]
[assembly: AssemblyDescription("MES 固定工作台配置、启动与自我检查客户端")]
[assembly: AssemblyCompany("MES")]
[assembly: AssemblyProduct("MES Workstation Configurator")]
[assembly: AssemblyVersion("2.1.0.0")]
[assembly: AssemblyFileVersion("2.1.0.0")]

namespace MESWorkstationConfigurator
{
    [Serializable]
    public class LauncherConfig
    {
        public string ServerUrl = "http://192.168.110.15:5173";
        public string StationKey = "handover";
        public int ZoomPercent = 100;
        public string TerminalId = "";
        public string ProtectedTerminalSecret = "";
        public string RegisteredServerUrl = "";
        public string RegisteredStationKey = "";
        public bool EnableStatusMonitoring = true;
        public bool AllowRemoteReload = true;
        public bool AllowRemotePowerControl = false;
    }

    public class StationOption
    {
        public string Key;
        public string Label;
        public string Route;

        public StationOption(string key, string label, string route)
        {
            Key = key;
            Label = label;
            Route = route;
        }

        public override string ToString()
        {
            return Label;
        }
    }

    internal enum WorkstationRecoveryReason
    {
        None,
        EdgeMissing,
        PageInactive
    }

    internal sealed class WorkstationWatchdog
    {
        private DateTime processGraceUntilUtc;
        private DateTime pageGraceUntilUtc;
        private DateTime nextAutomaticRestartUtc = DateTime.MinValue;
        private int automaticRestartCount;

        internal WorkstationWatchdog(DateTime launchedAtUtc)
        {
            MarkLaunch(launchedAtUtc);
        }

        internal void MarkLaunch(DateTime launchedAtUtc)
        {
            processGraceUntilUtc = launchedAtUtc.AddMilliseconds(LauncherRuntime.ProcessStartupGraceMilliseconds);
            pageGraceUntilUtc = launchedAtUtc.AddMilliseconds(LauncherRuntime.PageStartupGraceMilliseconds);
        }

        internal WorkstationRecoveryReason Evaluate(DateTime nowUtc, bool edgeRunning, bool pageActive)
        {
            if (edgeRunning && pageActive)
            {
                automaticRestartCount = 0;
                nextAutomaticRestartUtc = DateTime.MinValue;
                return WorkstationRecoveryReason.None;
            }
            if (!edgeRunning)
            {
                return nowUtc < processGraceUntilUtc
                    ? WorkstationRecoveryReason.None
                    : WorkstationRecoveryReason.EdgeMissing;
            }
            return nowUtc < pageGraceUntilUtc
                ? WorkstationRecoveryReason.None
                : WorkstationRecoveryReason.PageInactive;
        }

        internal bool CanAttemptAutomaticRestart(DateTime nowUtc)
        {
            if (nowUtc < nextAutomaticRestartUtc) return false;
            if (automaticRestartCount >= LauncherRuntime.AutomaticRestartLimit)
            {
                automaticRestartCount = 0;
            }
            return true;
        }

        internal void RecordAutomaticRestart(DateTime attemptedAtUtc, bool launched)
        {
            automaticRestartCount++;
            int delay = automaticRestartCount >= LauncherRuntime.AutomaticRestartLimit
                ? LauncherRuntime.AutomaticRestartPauseMilliseconds
                : LauncherRuntime.AutomaticRestartRetryMilliseconds;
            nextAutomaticRestartUtc = attemptedAtUtc.AddMilliseconds(delay);
            if (launched) MarkLaunch(attemptedAtUtc);
        }
    }

    internal static class LauncherRuntime
    {
        internal const string Version = "v2.1";
        internal const int HeartbeatIntervalMilliseconds = 5000;
        internal const int WatchdogCheckIntervalMilliseconds = 15000;
        internal const int StartupDesktopSettleMilliseconds = 8000;
        internal const int ProcessStartupGraceMilliseconds = 15000;
        internal const int PageStartupGraceMilliseconds = 60000;
        internal const int AutomaticRestartRetryMilliseconds = 30000;
        internal const int AutomaticRestartLimit = 3;
        internal const int AutomaticRestartPauseMilliseconds = 5 * 60 * 1000;
        internal static readonly int[] FocusRetryDelaysMilliseconds = new int[] { 500, 1500, 3000 };
        internal const int WorkstationZoomPercent = 100;
        internal const string DefaultServerUrl = "http://192.168.110.15:5173";
        internal const string RunValueName = "MESWorkstationLauncher";
        internal const string ManagedAgentMutexName = @"Local\MESWorkstationManagedAgent";
        internal static readonly string InstallDirectory = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "MESWorkstation"
        );
        internal static readonly string InstalledExePath = Path.Combine(InstallDirectory, "MES工作台启动器.exe");
        internal static readonly string ConfigPath = Path.Combine(InstallDirectory, "config.xml");
        internal static readonly string LogPath = Path.Combine(InstallDirectory, "launcher.log");
        internal static readonly string EdgeProfilePath = Path.Combine(InstallDirectory, "EdgeProfile");
        private static string lastKnownLocalIpAddress = String.Empty;
        private static readonly IntPtr WindowTopMost = new IntPtr(-1);
        private static readonly IntPtr WindowNotTopMost = new IntPtr(-2);
        private const uint ShowWindow = 5;
        private const uint SetWindowPositionNoMove = 0x0002;
        private const uint SetWindowPositionNoSize = 0x0001;
        private const uint SetWindowPositionShow = 0x0040;
        private const uint GetAncestorRoot = 2;

        [DllImport("user32.dll")]
        private static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool attach);

        [DllImport("user32.dll")]
        private static extern bool BringWindowToTop(IntPtr windowHandle);

        [DllImport("user32.dll")]
        private static extern IntPtr GetAncestor(IntPtr windowHandle, uint flags);

        [DllImport("user32.dll")]
        private static extern IntPtr GetForegroundWindow();

        [DllImport("user32.dll")]
        private static extern uint GetWindowThreadProcessId(IntPtr windowHandle, IntPtr processId);

        [DllImport("user32.dll")]
        private static extern bool SetForegroundWindow(IntPtr windowHandle);

        [DllImport("user32.dll")]
        private static extern bool SetWindowPos(
            IntPtr windowHandle,
            IntPtr insertAfter,
            int x,
            int y,
            int width,
            int height,
            uint flags
        );

        [DllImport("user32.dll")]
        private static extern bool ShowWindowAsync(IntPtr windowHandle, uint command);

        [DllImport("kernel32.dll")]
        private static extern uint GetCurrentThreadId();

        internal static readonly List<StationOption> Stations = new List<StationOption>
        {
            new StationOption("handover", "接驳区系统", "/handover-system"),
            new StationOption("staging", "暂存间系统", "/staging-management"),
            new StationOption("appearance", "外观检测间系统", "/appearance-inspection"),
            new StationOption("central", "中控管理", "/"),
            new StationOption("visual", "可视化管理", "/visualization"),
            Laboratory("冲击二室", "LAB_IMPACT_2"),
            Laboratory("冲击一室", "LAB_IMPACT_1"),
            Laboratory("高低温湿热一室", "LAB_HOT_HUMID"),
            Laboratory("高低温湿热二室", "LAB_HOT_HUMID_2"),
            Laboratory("霉菌试验室", "LAB_MOLD"),
            Laboratory("四综合实验室", "LAB_COMPREHENSIVE"),
            Laboratory("温度冲击二室", "LAB_TEMP_SHOCK_2"),
            Laboratory("温度冲击一室", "LAB_TEMP_SHOCK_1"),
            Laboratory("盐雾试验室", "LAB_SALT"),
            Laboratory("振动二室", "LAB_VIBRATION_2"),
            Laboratory("振动一室", "LAB_VIBRATION_1")
        };

        private static StationOption Laboratory(string name, string labCode)
        {
            return new StationOption("laboratory:" + name, name + "操作台", "/laboratory?lab=" + labCode);
        }

        internal static LauncherConfig LoadConfig()
        {
            try
            {
                if (!File.Exists(ConfigPath))
                {
                    return new LauncherConfig();
                }
                using (FileStream stream = File.OpenRead(ConfigPath))
                {
                    LauncherConfig config = (LauncherConfig)new XmlSerializer(typeof(LauncherConfig)).Deserialize(stream);
                    if (String.IsNullOrWhiteSpace(config.ServerUrl) || String.Equals(config.ServerUrl.TrimEnd('/'), "http://192.168.110.90:5173", StringComparison.OrdinalIgnoreCase))
                    {
                        config.ServerUrl = DefaultServerUrl;
                    }
                    config.ZoomPercent = WorkstationZoomPercent;
                    return config;
                }
            }
            catch (Exception exception)
            {
                Log("读取配置失败，将使用默认配置。" + exception.Message);
                return new LauncherConfig();
            }
        }

        internal static void SaveConfig(LauncherConfig config)
        {
            Directory.CreateDirectory(InstallDirectory);
            using (FileStream stream = File.Create(ConfigPath))
            {
                new XmlSerializer(typeof(LauncherConfig)).Serialize(stream, config);
            }
        }

        internal static StationOption FindStation(string key)
        {
            foreach (StationOption station in Stations)
            {
                if (String.Equals(station.Key, key, StringComparison.OrdinalIgnoreCase))
                {
                    return station;
                }
            }
            return Stations[0];
        }

        internal static string NormalizeServerUrl(string value)
        {
            string normalized = (value ?? String.Empty).Trim().TrimEnd('/');
            if (normalized.Length == 0)
            {
                throw new InvalidOperationException("MES 地址不能为空。");
            }
            if (!normalized.StartsWith("http://", StringComparison.OrdinalIgnoreCase)
                && !normalized.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
            {
                normalized = "http://" + normalized;
            }
            Uri uri;
            if (!Uri.TryCreate(normalized, UriKind.Absolute, out uri)
                || (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
            {
                throw new InvalidOperationException("MES 地址格式不正确，例如：http://192.168.110.15:5173");
            }
            bool hasExplicitPort = uri.Authority.LastIndexOf(':') > uri.Authority.LastIndexOf(']');
            if (!hasExplicitPort && uri.Scheme == Uri.UriSchemeHttp)
            {
                UriBuilder builder = new UriBuilder(uri);
                builder.Port = 5173;
                normalized = builder.Uri.GetLeftPart(UriPartial.Authority).TrimEnd('/');
            }
            else
            {
                normalized = uri.GetLeftPart(UriPartial.Authority).TrimEnd('/');
            }
            return normalized;
        }

        internal static string BuildTargetUrl(LauncherConfig config)
        {
            return NormalizeServerUrl(config.ServerUrl) + FindStation(config.StationKey).Route;
        }

        private static string ProtectTerminalSecret(string secret)
        {
            byte[] protectedBytes = ProtectedData.Protect(
                Encoding.UTF8.GetBytes(secret ?? String.Empty),
                Encoding.UTF8.GetBytes("MES-Fixed-Terminal-v1"),
                DataProtectionScope.CurrentUser
            );
            return Convert.ToBase64String(protectedBytes);
        }

        private static string UnprotectTerminalSecret(string protectedSecret)
        {
            if (String.IsNullOrWhiteSpace(protectedSecret)) return String.Empty;
            byte[] clearBytes = ProtectedData.Unprotect(
                Convert.FromBase64String(protectedSecret),
                Encoding.UTF8.GetBytes("MES-Fixed-Terminal-v1"),
                DataProtectionScope.CurrentUser
            );
            return Encoding.UTF8.GetString(clearBytes);
        }

        private static Dictionary<string, object> PostJson(string url, Dictionary<string, object> payload)
        {
            JavaScriptSerializer serializer = new JavaScriptSerializer();
            byte[] body = Encoding.UTF8.GetBytes(serializer.Serialize(payload));
            HttpWebRequest request = (HttpWebRequest)WebRequest.Create(url);
            request.Method = "POST";
            request.ContentType = "application/json; charset=utf-8";
            request.Accept = "application/json";
            request.Timeout = 10000;
            request.ReadWriteTimeout = 10000;
            request.Proxy = null;
            request.ContentLength = body.Length;
            using (Stream requestStream = request.GetRequestStream()) requestStream.Write(body, 0, body.Length);
            try
            {
                using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
                using (StreamReader reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8))
                {
                    return serializer.Deserialize<Dictionary<string, object>>(reader.ReadToEnd());
                }
            }
            catch (WebException exception)
            {
                string detail = exception.Message;
                if (exception.Response != null)
                {
                    using (StreamReader reader = new StreamReader(exception.Response.GetResponseStream(), Encoding.UTF8))
                    {
                        string responseText = reader.ReadToEnd();
                        try
                        {
                            Dictionary<string, object> error = serializer.Deserialize<Dictionary<string, object>>(responseText);
                            if (error.ContainsKey("detail")) detail = Convert.ToString(error["detail"]);
                        }
                        catch { }
                    }
                }
                throw new InvalidOperationException("固定终端认证失败：" + detail, exception);
            }
        }

        internal static void EnsureTerminalRegistration(LauncherConfig config)
        {
            string normalizedServerUrl = NormalizeServerUrl(config.ServerUrl);
            string currentSecret = String.Empty;
            try { currentSecret = UnprotectTerminalSecret(config.ProtectedTerminalSecret); } catch { }
            if (
                currentSecret.Length > 0
                && String.Equals(config.RegisteredServerUrl, normalizedServerUrl, StringComparison.OrdinalIgnoreCase)
                && String.Equals(config.RegisteredStationKey, config.StationKey, StringComparison.Ordinal)
            )
            {
                return;
            }

            if (String.IsNullOrWhiteSpace(config.TerminalId))
            {
                config.TerminalId = Environment.MachineName + "-" + Guid.NewGuid().ToString("N").Substring(0, 12);
            }
            StationOption station = FindStation(config.StationKey);
            bool laboratory = station.Key.StartsWith("laboratory:", StringComparison.Ordinal);
            string module = laboratory ? "laboratory" : station.Key;
            string labName = laboratory ? station.Key.Substring("laboratory:".Length) : String.Empty;
            Dictionary<string, object> response = PostJson(
                normalizedServerUrl + "/auth/terminal/register",
                new Dictionary<string, object>
                {
                    { "username", "admin" },
                    { "password", "123" },
                    { "terminal_id", config.TerminalId },
                    { "terminal_name", Environment.MachineName + " - " + station.Label },
                    { "module", module },
                    { "lab_name", labName }
                }
            );
            string terminalSecret = response.ContainsKey("terminalSecret") ? Convert.ToString(response["terminalSecret"]) : String.Empty;
            if (String.IsNullOrWhiteSpace(terminalSecret))
            {
                throw new InvalidOperationException("服务端没有返回固定终端密钥。");
            }
            config.ProtectedTerminalSecret = ProtectTerminalSecret(terminalSecret);
            config.RegisteredServerUrl = normalizedServerUrl;
            config.RegisteredStationKey = config.StationKey;
            Log("固定终端注册成功，terminalId=" + config.TerminalId + "，目标=" + BuildTargetUrl(config));
        }

        private static string BuildTerminalBootstrapUrl(LauncherConfig config)
        {
            string terminalSecret = UnprotectTerminalSecret(config.ProtectedTerminalSecret);
            if (String.IsNullOrWhiteSpace(config.TerminalId) || String.IsNullOrWhiteSpace(terminalSecret))
            {
                throw new InvalidOperationException("该电脑尚未注册为固定终端，请先打开设置程序并保存配置。");
            }
            Dictionary<string, object> response = PostJson(
                NormalizeServerUrl(config.ServerUrl) + "/auth/terminal/ticket",
                new Dictionary<string, object>
                {
                    { "terminal_id", config.TerminalId },
                    { "terminal_secret", terminalSecret }
                }
            );
            string ticket = response.ContainsKey("ticket") ? Convert.ToString(response["ticket"]) : String.Empty;
            if (String.IsNullOrWhiteSpace(ticket))
            {
                throw new InvalidOperationException("服务端没有返回固定终端登录票据。");
            }
            return NormalizeServerUrl(config.ServerUrl) + "/auth/terminal/consume?ticket=" + Uri.EscapeDataString(ticket);
        }

        internal static string ResolveEdgePath()
        {
            string[] candidates = new string[]
            {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Microsoft", "Edge", "Application", "msedge.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Microsoft", "Edge", "Application", "msedge.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Microsoft", "Edge", "Application", "msedge.exe")
            };
            foreach (string candidate in candidates)
            {
                if (File.Exists(candidate))
                {
                    return candidate;
                }
            }
            throw new FileNotFoundException("未找到 Microsoft Edge，请先安装 Edge。", "msedge.exe");
        }

        internal static void InstallAutoStart(LauncherConfig config)
        {
            Directory.CreateDirectory(InstallDirectory);
            string currentExe = Application.ExecutablePath;
            if (!String.Equals(Path.GetFullPath(currentExe), Path.GetFullPath(InstalledExePath), StringComparison.OrdinalIgnoreCase))
            {
                File.Copy(currentExe, InstalledExePath, true);
            }
            SaveConfig(config);
            using (RegistryKey runKey = Registry.CurrentUser.OpenSubKey(
                @"Software\Microsoft\Windows\CurrentVersion\Run",
                true
            ))
            {
                if (runKey == null)
                {
                    throw new InvalidOperationException("无法写入当前用户的开机启动配置。");
                }
                runKey.SetValue(RunValueName, "\"" + InstalledExePath + "\" --launch", RegistryValueKind.String);
            }
            RemoveLegacyStartup();
            Log("已启用开机自启动，目标=" + BuildTargetUrl(config));
        }

        internal static void RemoveAutoStart()
        {
            using (RegistryKey runKey = Registry.CurrentUser.OpenSubKey(
                @"Software\Microsoft\Windows\CurrentVersion\Run",
                true
            ))
            {
                if (runKey != null)
                {
                    runKey.DeleteValue(RunValueName, false);
                }
            }
            RemoveLegacyStartup();
            Log("已取消开机自启动。");
        }

        private static void RemoveLegacyStartup()
        {
            string startup = Environment.GetFolderPath(Environment.SpecialFolder.Startup);
            string legacyShortcut = Path.Combine(startup, "MES Workstation.lnk");
            string legacyScript = Path.Combine(InstallDirectory, "MES-Workstation-AutoStart.ps1");
            try { if (File.Exists(legacyShortcut)) File.Delete(legacyShortcut); } catch { }
            try { if (File.Exists(legacyScript)) File.Delete(legacyScript); } catch { }
        }

        internal static bool IsAutoStartEnabled()
        {
            using (RegistryKey runKey = Registry.CurrentUser.OpenSubKey(
                @"Software\Microsoft\Windows\CurrentVersion\Run",
                false
            ))
            {
                return runKey != null && runKey.GetValue(RunValueName) != null;
            }
        }

        internal static bool TestMes(LauncherConfig config, int timeoutMilliseconds)
        {
            string healthUrl = NormalizeServerUrl(config.ServerUrl) + "/api/system/time";
            HttpWebRequest request = (HttpWebRequest)WebRequest.Create(healthUrl);
            request.Method = "GET";
            request.Timeout = timeoutMilliseconds;
            request.ReadWriteTimeout = timeoutMilliseconds;
            request.Proxy = null;
            try
            {
                using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
                {
                    return (int)response.StatusCode >= 200 && (int)response.StatusCode < 500;
                }
            }
            catch (WebException exception)
            {
                HttpWebResponse response = exception.Response as HttpWebResponse;
                return response != null && (int)response.StatusCode < 500;
            }
        }

        internal static void LaunchConfiguredWorkstation(bool waitForMes)
        {
            LauncherConfig config = LoadConfig();
            string businessTargetUrl = BuildTargetUrl(config);
            try
            {
                if (waitForMes)
                {
                    DateTime deadline = DateTime.Now.AddMinutes(5);
                    while (DateTime.Now < deadline && !TestMes(config, 4000))
                    {
                        Thread.Sleep(3000);
                    }
                    Log("等待 Windows 桌面稳定后启动工作台。");
                    Thread.Sleep(StartupDesktopSettleMilliseconds);
                }
                string edgePath = ResolveEdgePath();
                string targetUrl = BuildTerminalBootstrapUrl(config);
                Directory.CreateDirectory(EdgeProfilePath);
                StopDedicatedEdge();
                NormalizeDedicatedEdgeZoom();

                ProcessStartInfo startInfo = new ProcessStartInfo();
                startInfo.FileName = edgePath;
                startInfo.WorkingDirectory = InstallDirectory;
                startInfo.UseShellExecute = false;
                startInfo.Arguments = "--kiosk \"" + targetUrl + "\""
                    + " --edge-kiosk-type=fullscreen"
                    + " --user-data-dir=\"" + EdgeProfilePath + "\""
                    + " --profile-directory=Default"
                    + " --no-first-run"
                    + " --no-default-browser-check"
                    + " --disable-session-crashed-bubble"
                    + " --force-device-scale-factor=1.0";
                Process.Start(startInfo);
                Log("Edge 已启动，固定终端目标=" + businessTargetUrl);
                StabilizeDedicatedEdgeForeground();
            }
            catch (Exception exception)
            {
                Log("启动失败：" + exception);
                throw;
            }
        }

        internal static void RunManagedWorkstation()
        {
            bool ownsMutex;
            using (Mutex agentMutex = new Mutex(true, ManagedAgentMutexName, out ownsMutex))
            {
                if (!ownsMutex)
                {
                    Log("终端状态监听进程已在运行，本次重复启动直接退出。");
                    return;
                }

                try
                {
                    LauncherConfig config = LoadConfig();
                    LaunchConfiguredWorkstation(true);
                    WorkstationWatchdog watchdog = new WorkstationWatchdog(DateTime.UtcNow);
                    DateTime nextWatchdogCheckUtc = DateTime.UtcNow.AddMilliseconds(WatchdogCheckIntervalMilliseconds);
                    if (!config.EnableStatusMonitoring)
                    {
                        Log("终端状态监听未启用，启动器在打开工作台后退出。");
                        return;
                    }

                    Log("终端状态监听已启动。");
                    while (true)
                    {
                        try
                        {
                            config = LoadConfig();
                            if (!config.EnableStatusMonitoring)
                            {
                                Log("终端状态监听已由配置关闭。");
                                return;
                            }
                            Dictionary<string, object> heartbeat = PostTerminalHeartbeat(config);
                            object commandValue;
                            if (heartbeat.TryGetValue("command", out commandValue) && commandValue != null)
                            {
                                Dictionary<string, object> command = commandValue as Dictionary<string, object>;
                                if (command != null && ExecuteRemoteCommand(config, command))
                                {
                                    watchdog.MarkLaunch(DateTime.UtcNow);
                                }
                            }
                            if (DateTime.UtcNow >= nextWatchdogCheckUtc)
                            {
                                RecoverWorkstationIfNeeded(config, heartbeat, watchdog);
                                nextWatchdogCheckUtc = DateTime.UtcNow.AddMilliseconds(WatchdogCheckIntervalMilliseconds);
                            }
                        }
                        catch (Exception exception)
                        {
                            Log("终端状态监听请求失败：" + exception.Message);
                        }
                        Thread.Sleep(HeartbeatIntervalMilliseconds);
                    }
                }
                finally
                {
                    agentMutex.ReleaseMutex();
                }
            }
        }

        internal static void StartInstalledManagedWorkstation()
        {
            ProcessStartInfo startInfo = new ProcessStartInfo();
            startInfo.FileName = InstalledExePath;
            startInfo.Arguments = "--launch";
            startInfo.WorkingDirectory = InstallDirectory;
            startInfo.UseShellExecute = false;
            startInfo.CreateNoWindow = true;
            Process.Start(startInfo);
        }

        private static Dictionary<string, object> PostTerminalHeartbeat(LauncherConfig config)
        {
            string terminalSecret = UnprotectTerminalSecret(config.ProtectedTerminalSecret);
            if (String.IsNullOrWhiteSpace(config.TerminalId) || String.IsNullOrWhiteSpace(terminalSecret))
            {
                throw new InvalidOperationException("固定终端凭据不完整，请重新保存设置。");
            }
            return PostJson(
                NormalizeServerUrl(config.ServerUrl) + "/api/terminal-control/heartbeat",
                new Dictionary<string, object>
                {
                    { "terminalId", config.TerminalId },
                    { "terminalSecret", terminalSecret },
                    { "machineName", Environment.MachineName },
                    { "ipAddress", ResolveLocalIpAddress(config.ServerUrl) },
                    { "configuredPath", FindStation(config.StationKey).Route },
                    { "agentVersion", Version },
                    { "allowReload", config.AllowRemoteReload },
                    { "allowPower", config.AllowRemotePowerControl }
                }
            );
        }

        private static string ResolveLocalIpAddress(string serverUrl)
        {
            if (!String.IsNullOrWhiteSpace(lastKnownLocalIpAddress)) return lastKnownLocalIpAddress;
            try
            {
                Uri server = new Uri(NormalizeServerUrl(serverUrl));
                using (TcpClient client = new TcpClient())
                {
                    IAsyncResult connection = client.BeginConnect(server.Host, server.Port, null, null);
                    if (!connection.AsyncWaitHandle.WaitOne(2000))
                    {
                        throw new TimeoutException("连接 MES 地址超时。");
                    }
                    client.EndConnect(connection);
                    IPEndPoint endpoint = client.Client.LocalEndPoint as IPEndPoint;
                    lastKnownLocalIpAddress = endpoint == null ? String.Empty : endpoint.Address.ToString();
                    return lastKnownLocalIpAddress;
                }
            }
            catch (Exception exception)
            {
                Log("获取终端局域网 IP 失败：" + exception.Message);
                return String.Empty;
            }
        }

        private static void CompleteRemoteCommand(LauncherConfig config, int commandId, bool success, string message)
        {
            PostJson(
                NormalizeServerUrl(config.ServerUrl) + "/api/terminal-control/commands/" + commandId + "/complete",
                new Dictionary<string, object>
                {
                    { "terminalId", config.TerminalId },
                    { "terminalSecret", UnprotectTerminalSecret(config.ProtectedTerminalSecret) },
                    { "success", success },
                    { "message", message }
                }
            );
        }

        private static bool ExecuteRemoteCommand(LauncherConfig config, Dictionary<string, object> command)
        {
            int commandId = Convert.ToInt32(command["commandId"]);
            string action = Convert.ToString(command["action"] ?? String.Empty).Trim().ToLowerInvariant();
            try
            {
                if (action == "reload")
                {
                    if (!config.AllowRemoteReload) throw new InvalidOperationException("终端未允许远程刷新。");
                    LaunchConfiguredWorkstation(false);
                    CompleteRemoteCommand(config, commandId, true, "Edge 已重新载入");
                    return true;
                }
                if (action == "shutdown" || action == "restart")
                {
                    if (!config.AllowRemotePowerControl) throw new InvalidOperationException("终端未允许远程电源控制。");
                    string label = action == "shutdown" ? "关机" : "重启";
                    CompleteRemoteCommand(config, commandId, true, "终端已接受" + label + "命令");
                    ProcessStartInfo shutdown = new ProcessStartInfo();
                    shutdown.FileName = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "shutdown.exe");
                    shutdown.Arguments = action == "shutdown" ? "/s /t 5 /f" : "/r /t 5 /f";
                    shutdown.UseShellExecute = false;
                    shutdown.CreateNoWindow = true;
                    Process.Start(shutdown);
                    Log("已执行远程" + label + "命令，commandId=" + commandId);
                    return false;
                }
                throw new InvalidOperationException("未知远程命令：" + action);
            }
            catch (Exception exception)
            {
                Log("远程命令执行失败，commandId=" + commandId + "：" + exception);
                try { CompleteRemoteCommand(config, commandId, false, exception.Message); } catch { }
                return false;
            }
        }

        private static void RecoverWorkstationIfNeeded(
            LauncherConfig config,
            Dictionary<string, object> heartbeat,
            WorkstationWatchdog watchdog
        )
        {
            DateTime nowUtc = DateTime.UtcNow;
            bool pageActive = false;
            object pageActiveValue;
            if (heartbeat.TryGetValue("pageActive", out pageActiveValue) && pageActiveValue != null)
            {
                try { pageActive = Convert.ToBoolean(pageActiveValue); } catch { }
            }
            bool edgeRunning = IsDedicatedEdgeRunning();
            WorkstationRecoveryReason reason = watchdog.Evaluate(nowUtc, edgeRunning, pageActive);
            if (reason == WorkstationRecoveryReason.None || !watchdog.CanAttemptAutomaticRestart(nowUtc)) return;

            string reasonLabel = reason == WorkstationRecoveryReason.EdgeMissing
                ? "专用 Edge 未运行"
                : "网页心跳已超时";
            if (!TestMes(config, 4000))
            {
                watchdog.RecordAutomaticRestart(nowUtc, false);
                Log("自我检查发现" + reasonLabel + "，但 MES 服务当前不可访问，稍后重试。");
                return;
            }

            try
            {
                Log("自我检查发现" + reasonLabel + "，正在自动重新启动工作台。");
                LaunchConfiguredWorkstation(false);
                watchdog.RecordAutomaticRestart(nowUtc, true);
                Log("工作台已由自我检查自动重新启动。");
            }
            catch (Exception exception)
            {
                watchdog.RecordAutomaticRestart(nowUtc, false);
                Log("工作台自动恢复失败：" + exception.Message);
            }
        }

        private static bool IsDedicatedEdgeRunning()
        {
            try
            {
                using (ManagementObjectSearcher searcher = new ManagementObjectSearcher(
                    "SELECT CommandLine FROM Win32_Process WHERE Name='msedge.exe'"
                ))
                {
                    foreach (ManagementObject process in searcher.Get())
                    {
                        string commandLine = Convert.ToString(process["CommandLine"]);
                        if (!String.IsNullOrWhiteSpace(commandLine)
                            && commandLine.IndexOf(EdgeProfilePath, StringComparison.OrdinalIgnoreCase) >= 0)
                        {
                            return true;
                        }
                    }
                }
            }
            catch (Exception exception)
            {
                Log("检查专用 Edge 进程失败：" + exception.Message);
                // 无法读取进程命令行时交由网页心跳继续判断，避免把权限问题误判成 Edge 已退出。
                return true;
            }
            return false;
        }

        private static void StabilizeDedicatedEdgeForeground()
        {
            bool foundWindow = false;
            for (int index = 0; index < FocusRetryDelaysMilliseconds.Length; index++)
            {
                Thread.Sleep(FocusRetryDelaysMilliseconds[index]);
                IntPtr windowHandle = FindDedicatedEdgeMainWindow();
                if (windowHandle == IntPtr.Zero) continue;
                foundWindow = true;
                bool foreground = ActivateDedicatedEdgeWindow(windowHandle);
                Log(
                    "专用 Edge 前台激活第" + (index + 1)
                    + "次：" + (foreground ? "成功" : "已请求，等待下一次确认")
                );
            }
            if (!foundWindow)
            {
                Log("专用 Edge 已启动，但在窗口聚焦周期内尚未发现主窗口；后续由自我检查继续处理。");
            }
        }

        private static IntPtr FindDedicatedEdgeMainWindow()
        {
            try
            {
                using (ManagementObjectSearcher searcher = new ManagementObjectSearcher(
                    "SELECT ProcessId, CommandLine FROM Win32_Process WHERE Name='msedge.exe'"
                ))
                {
                    foreach (ManagementObject processInfo in searcher.Get())
                    {
                        string commandLine = Convert.ToString(processInfo["CommandLine"]);
                        if (String.IsNullOrWhiteSpace(commandLine)
                            || commandLine.IndexOf(EdgeProfilePath, StringComparison.OrdinalIgnoreCase) < 0)
                        {
                            continue;
                        }
                        int processId = Convert.ToInt32(processInfo["ProcessId"]);
                        try
                        {
                            using (Process edgeProcess = Process.GetProcessById(processId))
                            {
                                edgeProcess.Refresh();
                                if (edgeProcess.MainWindowHandle != IntPtr.Zero)
                                {
                                    return edgeProcess.MainWindowHandle;
                                }
                            }
                        }
                        catch { }
                    }
                }
            }
            catch (Exception exception)
            {
                Log("查找专用 Edge 主窗口失败：" + exception.Message);
            }
            return IntPtr.Zero;
        }

        private static bool ActivateDedicatedEdgeWindow(IntPtr windowHandle)
        {
            if (windowHandle == IntPtr.Zero) return false;
            uint currentThreadId = GetCurrentThreadId();
            IntPtr foregroundWindow = GetForegroundWindow();
            uint foregroundThreadId = foregroundWindow == IntPtr.Zero
                ? 0
                : GetWindowThreadProcessId(foregroundWindow, IntPtr.Zero);
            uint targetThreadId = GetWindowThreadProcessId(windowHandle, IntPtr.Zero);
            bool attachedToForeground = false;
            bool attachedToTarget = false;
            try
            {
                if (foregroundThreadId != 0 && foregroundThreadId != currentThreadId)
                {
                    attachedToForeground = AttachThreadInput(currentThreadId, foregroundThreadId, true);
                }
                if (targetThreadId != 0 && targetThreadId != currentThreadId && targetThreadId != foregroundThreadId)
                {
                    attachedToTarget = AttachThreadInput(currentThreadId, targetThreadId, true);
                }

                uint positionFlags = SetWindowPositionNoMove | SetWindowPositionNoSize | SetWindowPositionShow;
                ShowWindowAsync(windowHandle, ShowWindow);
                SetWindowPos(windowHandle, WindowTopMost, 0, 0, 0, 0, positionFlags);
                BringWindowToTop(windowHandle);
                SetForegroundWindow(windowHandle);
                SetWindowPos(windowHandle, WindowNotTopMost, 0, 0, 0, 0, positionFlags);
                return GetAncestor(GetForegroundWindow(), GetAncestorRoot) == windowHandle;
            }
            finally
            {
                if (attachedToTarget) AttachThreadInput(currentThreadId, targetThreadId, false);
                if (attachedToForeground) AttachThreadInput(currentThreadId, foregroundThreadId, false);
            }
        }

        internal static bool RunWatchdogSelfTest()
        {
            DateTime start = new DateTime(2026, 7, 30, 0, 0, 0, DateTimeKind.Utc);
            WorkstationWatchdog watchdog = new WorkstationWatchdog(start);
            if (watchdog.Evaluate(start.AddSeconds(10), false, false) != WorkstationRecoveryReason.None) return false;
            if (watchdog.Evaluate(start.AddSeconds(16), false, false) != WorkstationRecoveryReason.EdgeMissing) return false;
            if (!watchdog.CanAttemptAutomaticRestart(start.AddSeconds(16))) return false;
            watchdog.RecordAutomaticRestart(start.AddSeconds(16), false);
            if (watchdog.CanAttemptAutomaticRestart(start.AddSeconds(20))) return false;
            if (!watchdog.CanAttemptAutomaticRestart(start.AddSeconds(47))) return false;
            watchdog.RecordAutomaticRestart(start.AddSeconds(47), false);
            if (!watchdog.CanAttemptAutomaticRestart(start.AddSeconds(78))) return false;
            watchdog.RecordAutomaticRestart(start.AddSeconds(78), false);
            if (watchdog.CanAttemptAutomaticRestart(start.AddSeconds(300))) return false;
            if (!watchdog.CanAttemptAutomaticRestart(start.AddSeconds(379))) return false;

            WorkstationWatchdog pageWatchdog = new WorkstationWatchdog(start);
            if (pageWatchdog.Evaluate(start.AddSeconds(30), true, false) != WorkstationRecoveryReason.None) return false;
            if (pageWatchdog.Evaluate(start.AddSeconds(61), true, false) != WorkstationRecoveryReason.PageInactive) return false;
            if (pageWatchdog.Evaluate(start.AddSeconds(62), true, true) != WorkstationRecoveryReason.None) return false;
            return true;
        }

        internal static bool RunWindowFocusSelfTest()
        {
            return StartupDesktopSettleMilliseconds == 8000
                && FocusRetryDelaysMilliseconds.Length == 3
                && FocusRetryDelaysMilliseconds[0] == 500
                && FocusRetryDelaysMilliseconds[1] == 1500
                && FocusRetryDelaysMilliseconds[2] == 3000;
        }

        private static void StopDedicatedEdge()
        {
            try
            {
                string escapedProfile = EdgeProfilePath.Replace("\\", "\\\\").Replace("'", "''");
                using (ManagementObjectSearcher searcher = new ManagementObjectSearcher(
                    "SELECT ProcessId, CommandLine FROM Win32_Process WHERE Name='msedge.exe'"
                ))
                {
                    foreach (ManagementObject process in searcher.Get())
                    {
                        string commandLine = Convert.ToString(process["CommandLine"]);
                        if (commandLine.IndexOf(EdgeProfilePath, StringComparison.OrdinalIgnoreCase) < 0
                            && commandLine.IndexOf(escapedProfile, StringComparison.OrdinalIgnoreCase) < 0)
                        {
                            continue;
                        }
                        int processId = Convert.ToInt32(process["ProcessId"]);
                        try { Process.GetProcessById(processId).Kill(); } catch { }
                    }
                }
                Thread.Sleep(700);
            }
            catch (Exception exception)
            {
                Log("关闭旧工作台 Edge 时忽略错误：" + exception.Message);
            }
        }

        private static void NormalizeDedicatedEdgeZoom()
        {
            try
            {
                string preferencesPath = Path.Combine(EdgeProfilePath, "Default", "Preferences");
                if (!File.Exists(preferencesPath))
                {
                    Log("专用 Edge 尚无历史缩放配置，按 100% 启动。");
                    return;
                }

                JavaScriptSerializer serializer = new JavaScriptSerializer();
                serializer.MaxJsonLength = Int32.MaxValue;
                Dictionary<string, object> preferences = serializer.DeserializeObject(
                    File.ReadAllText(preferencesPath, Encoding.UTF8)
                ) as Dictionary<string, object>;
                if (preferences == null)
                {
                    throw new InvalidOperationException("Edge Preferences 格式无法识别。");
                }

                object partitionValue;
                Dictionary<string, object> partition = null;
                if (preferences.TryGetValue("partition", out partitionValue))
                {
                    partition = partitionValue as Dictionary<string, object>;
                }
                if (partition == null)
                {
                    partition = new Dictionary<string, object>();
                    preferences["partition"] = partition;
                }
                partition["default_zoom_level"] = 0.0;
                partition["per_host_zoom_levels"] = new Dictionary<string, object>();

                File.WriteAllText(
                    preferencesPath,
                    serializer.Serialize(preferences),
                    new UTF8Encoding(false)
                );
                Log("专用 Edge 页面缩放已统一重置为 100%。");
            }
            catch (Exception exception)
            {
                Log("重置专用 Edge 页面缩放时忽略错误：" + exception.Message);
            }
        }

        internal static void Log(string message)
        {
            try
            {
                Directory.CreateDirectory(InstallDirectory);
                File.AppendAllText(LogPath, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " " + message + Environment.NewLine);
            }
            catch { }
        }
    }

    public class ConfigForm : Form
    {
        private readonly TextBox serverText = new TextBox();
        private readonly ComboBox stationCombo = new ComboBox();
        private readonly Label targetLabel = new Label();
        private readonly Label statusLabel = new Label();
        private readonly Button saveButton = new Button();
        private readonly Button testButton = new Button();
        private readonly Button removeButton = new Button();
        private readonly CheckBox monitorCheck = new CheckBox();
        private readonly CheckBox reloadCheck = new CheckBox();
        private readonly CheckBox powerCheck = new CheckBox();

        public ConfigForm()
        {
            Text = "MES 固定操作台设置 " + LauncherRuntime.Version;
            ClientSize = new Size(600, 455);
            MinimumSize = new Size(616, 494);
            StartPosition = FormStartPosition.CenterScreen;
            Font = new Font("Microsoft YaHei UI", 10F, FontStyle.Regular, GraphicsUnit.Point);
            BackColor = Color.FromArgb(245, 247, 250);

            Label title = new Label();
            title.Text = "MES 固定操作台启动设置";
            title.Font = new Font(Font.FontFamily, 16F, FontStyle.Bold);
            title.Location = new Point(28, 22);
            title.AutoSize = true;
            Controls.Add(title);

            Label hint = new Label();
            hint.Text = "注册为固定终端后，电脑开机会自动认证并进入指定操作台。";
            hint.ForeColor = Color.FromArgb(90, 100, 115);
            hint.Location = new Point(30, 59);
            hint.Size = new Size(540, 24);
            Controls.Add(hint);

            AddLabel("MES 地址", 31, 101);
            serverText.Location = new Point(150, 96);
            serverText.Size = new Size(420, 30);
            Controls.Add(serverText);

            AddLabel("固定操作台", 31, 147);
            stationCombo.Location = new Point(150, 142);
            stationCombo.Size = new Size(420, 30);
            stationCombo.DropDownStyle = ComboBoxStyle.DropDownList;
            foreach (StationOption station in LauncherRuntime.Stations) stationCombo.Items.Add(station);
            stationCombo.SelectedIndexChanged += delegate { RefreshTarget(); };
            Controls.Add(stationCombo);

            AddLabel("最终网址", 31, 193);
            targetLabel.Location = new Point(150, 190);
            targetLabel.Size = new Size(420, 38);
            targetLabel.ForeColor = Color.FromArgb(20, 90, 170);
            Controls.Add(targetLabel);

            saveButton.Text = "保存并启用开机自启动";
            AddLabel("远程管理", 31, 242);
            monitorCheck.Text = "上报在线状态和当前页面";
            monitorCheck.Location = new Point(150, 237);
            monitorCheck.Size = new Size(230, 28);
            monitorCheck.CheckedChanged += delegate
            {
                reloadCheck.Enabled = monitorCheck.Checked;
                powerCheck.Enabled = monitorCheck.Checked;
            };
            Controls.Add(monitorCheck);

            reloadCheck.Text = "允许管理端刷新界面";
            reloadCheck.Location = new Point(150, 269);
            reloadCheck.Size = new Size(200, 28);
            Controls.Add(reloadCheck);

            powerCheck.Text = "允许管理端关机/重启";
            powerCheck.Location = new Point(360, 269);
            powerCheck.Size = new Size(210, 28);
            Controls.Add(powerCheck);

            saveButton.Location = new Point(30, 318);
            saveButton.Size = new Size(220, 40);
            saveButton.BackColor = Color.FromArgb(28, 100, 210);
            saveButton.ForeColor = Color.White;
            saveButton.FlatStyle = FlatStyle.Flat;
            saveButton.Click += SaveClicked;
            Controls.Add(saveButton);

            testButton.Text = "立即测试打开 Edge";
            testButton.Location = new Point(260, 318);
            testButton.Size = new Size(170, 40);
            testButton.Click += TestClicked;
            Controls.Add(testButton);

            removeButton.Text = "取消开机自启动";
            removeButton.Location = new Point(440, 318);
            removeButton.Size = new Size(130, 40);
            removeButton.Click += RemoveClicked;
            Controls.Add(removeButton);

            statusLabel.Location = new Point(30, 380);
            statusLabel.Size = new Size(540, 30);
            statusLabel.ForeColor = Color.FromArgb(45, 115, 65);
            Controls.Add(statusLabel);

            serverText.TextChanged += delegate { RefreshTarget(); };
            LoadCurrentConfig();
        }

        private void AddLabel(string text, int x, int y)
        {
            Label label = new Label();
            label.Text = text;
            label.Location = new Point(x, y);
            label.Size = new Size(110, 26);
            Controls.Add(label);
        }

        private void LoadCurrentConfig()
        {
            LauncherConfig config = LauncherRuntime.LoadConfig();
            serverText.Text = config.ServerUrl;
            StationOption selected = LauncherRuntime.FindStation(config.StationKey);
            stationCombo.SelectedItem = selected;
            if (stationCombo.SelectedIndex < 0) stationCombo.SelectedIndex = 0;
            monitorCheck.Checked = config.EnableStatusMonitoring;
            reloadCheck.Checked = config.AllowRemoteReload;
            powerCheck.Checked = config.AllowRemotePowerControl;
            reloadCheck.Enabled = monitorCheck.Checked;
            powerCheck.Enabled = monitorCheck.Checked;
            statusLabel.Text = LauncherRuntime.IsAutoStartEnabled()
                ? "当前状态：已启用开机自启动"
                : "当前状态：尚未启用开机自启动";
            RefreshTarget();
        }

        private LauncherConfig ReadFormConfig()
        {
            StationOption selected = stationCombo.SelectedItem as StationOption;
            if (selected == null) throw new InvalidOperationException("请选择固定操作台。");
            LauncherConfig config = LauncherRuntime.LoadConfig();
            config.ServerUrl = LauncherRuntime.NormalizeServerUrl(serverText.Text);
            config.StationKey = selected.Key;
            config.ZoomPercent = LauncherRuntime.WorkstationZoomPercent;
            config.EnableStatusMonitoring = monitorCheck.Checked;
            config.AllowRemoteReload = monitorCheck.Checked && reloadCheck.Checked;
            config.AllowRemotePowerControl = monitorCheck.Checked && powerCheck.Checked;
            return config;
        }

        private void RefreshTarget()
        {
            try
            {
                LauncherConfig config = ReadFormConfig();
                targetLabel.Text = LauncherRuntime.BuildTargetUrl(config);
            }
            catch
            {
                targetLabel.Text = "请填写正确的 MES 地址并选择操作台";
            }
        }

        private void SaveClicked(object sender, EventArgs e)
        {
            try
            {
                LauncherConfig config = ReadFormConfig();
                LauncherRuntime.EnsureTerminalRegistration(config);
                LauncherRuntime.InstallAutoStart(config);
                LauncherRuntime.StartInstalledManagedWorkstation();
                statusLabel.Text = "设置成功：固定终端已绑定 " + LauncherRuntime.FindStation(config.StationKey).Label;
                MessageBox.Show(
                    "设置成功。\n\n该电脑已注册为固定终端，工作台和状态监听正在启动；以后开机会自动认证并进入绑定界面。",
                    "MES 工作台",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information
                );
            }
            catch (Exception exception)
            {
                MessageBox.Show(exception.Message, "设置失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private void TestClicked(object sender, EventArgs e)
        {
            try
            {
                LauncherConfig config = ReadFormConfig();
                LauncherRuntime.EnsureTerminalRegistration(config);
                LauncherRuntime.SaveConfig(config);
                statusLabel.Text = "正在检测 MES 地址并打开 Edge……";
                Refresh();
                if (!LauncherRuntime.TestMes(config, 5000))
                {
                    DialogResult result = MessageBox.Show(
                        "当前无法连接 MES 地址。是否仍然尝试打开？\n\n" + LauncherRuntime.BuildTargetUrl(config),
                        "MES 地址暂不可用",
                        MessageBoxButtons.YesNo,
                        MessageBoxIcon.Warning
                    );
                    if (result != DialogResult.Yes) return;
                }
                LauncherRuntime.LaunchConfiguredWorkstation(false);
                statusLabel.Text = "Edge 已打开；最终网址：" + LauncherRuntime.BuildTargetUrl(config);
            }
            catch (Exception exception)
            {
                MessageBox.Show(exception.Message, "打开失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
                statusLabel.Text = "打开失败，请检查 MES 地址和 Edge 安装状态。";
            }
        }

        private void RemoveClicked(object sender, EventArgs e)
        {
            try
            {
                LauncherRuntime.RemoveAutoStart();
                statusLabel.Text = "当前状态：已取消开机自启动";
                MessageBox.Show("已取消开机自启动。桌面设置程序仍可继续使用。", "MES 工作台");
            }
            catch (Exception exception)
            {
                MessageBox.Show(exception.Message, "取消失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }
    }

    internal static class Program
    {
        [STAThread]
        private static int Main(string[] args)
        {
            if (args.Length > 0 && String.Equals(args[0], "--window-focus-self-test", StringComparison.OrdinalIgnoreCase))
            {
                return LauncherRuntime.RunWindowFocusSelfTest() ? 0 : 5;
            }

            if (args.Length > 0 && String.Equals(args[0], "--watchdog-self-test", StringComparison.OrdinalIgnoreCase))
            {
                return LauncherRuntime.RunWatchdogSelfTest() ? 0 : 4;
            }

            if (args.Length > 0 && String.Equals(args[0], "--self-test", StringComparison.OrdinalIgnoreCase))
            {
                try
                {
                    LauncherConfig config = LauncherRuntime.LoadConfig();
                    LauncherRuntime.BuildTargetUrl(config);
                    LauncherRuntime.ResolveEdgePath();
                    LauncherRuntime.Log("自检通过，版本=" + LauncherRuntime.Version);
                    return 0;
                }
                catch (Exception exception)
                {
                    LauncherRuntime.Log("自检失败：" + exception);
                    return 2;
                }
            }

            if (args.Length > 0 && String.Equals(args[0], "--launch", StringComparison.OrdinalIgnoreCase))
            {
                try
                {
                    LauncherRuntime.RunManagedWorkstation();
                    return 0;
                }
                catch
                {
                    return 3;
                }
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new ConfigForm());
            return 0;
        }
    }
}
