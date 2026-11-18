using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Management;
using System.Net;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Windows.Forms;
using System.Web.Script.Serialization;
using MESTerminalManager;
using MESNetwork;

[assembly: AssemblyTitle("MES 控制中心")]
[assembly: AssemblyDescription("MES 服务控制与固定工作台终端管理")]
[assembly: AssemblyCompany("MES")]
[assembly: AssemblyProduct("MES Control Center")]
[assembly: AssemblyVersion("2.10.0.0")]
[assembly: AssemblyFileVersion("2.10.0.0")]

namespace MESControlCenter
{
    // A separate Chromium profile keeps MES windows out of the user's browser
    // process. Persist the process identity so reopening the center can close it.
    internal sealed class MESBrowserSession
    {
        private readonly string directory;
        private readonly string executable;
        private readonly object sessionLock = new object();
        private delegate bool EnumWindowCallback(IntPtr window, IntPtr parameter);
        [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowCallback callback, IntPtr parameter);
        [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
        [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
        [DllImport("user32.dll")] private static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
        [DllImport("shell32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr CommandLineToArgvW(string command, out int count);
        [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr memory);

        internal MESBrowserSession(string owner, string browserExecutable)
        {
            string key;
            using (SHA256 hash = SHA256.Create())
                key = BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(Path.GetFullPath(owner).TrimEnd('\\').ToUpperInvariant()))).Replace("-", "");
            directory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MesFastApiLauncher", "Browsers", key);
            executable = browserExecutable;
        }

        private string StatePath { get { return Path.Combine(directory, "browser.json"); } }

        private string CentralClientPath
        {
            get { return NativeClientPath("central-client", "MES中控管理.exe"); }
        }

        private string NativeClientPath(string folder, string name)
        {
            if (executable != null) return null;
            return ControlCenterPaths.ClientPath(folder,name);
        }

        private IEnumerable<string> NativeClientPaths()
        {
            foreach (string path in new[] { CentralClientPath,
                NativeClientPath("lims-client", "MES_LIMS模拟器.exe"), NativeClientPath("upper-client", "MES上位机模拟器.exe"),
                NativeClientPath("test-client", "MES综合测试终端.exe") })
                if (path != null) yield return path;
            if (executable == null) foreach (string path in ControlCenterPaths.WorkstationExecutables()) yield return path;
        }

        private bool CombinedClientEnabled()
        {
            if (CentralClientPath == null) return false;
            try
            {
                string path = Path.Combine(Path.GetDirectoryName(CentralClientPath), "mes-client.json");
                Dictionary<string, object> settings = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(File.ReadAllText(path));
                object enabled;
                return settings.TryGetValue("simulatorsEnabled", out enabled) && enabled is bool && (bool)enabled;
            }
            catch (Exception) { return false; }
        }

        private string SimulatorModule(Uri uri)
        {
            foreach (string[] item in new[] {
                new[] { "limsUrl", "http://127.0.0.1:8900", "lims" },
                new[] { "upperComputerUrl", "http://127.0.0.1:8899", "upper-computer" }
            })
            {
                Uri endpoint;
                if (Uri.TryCreate(MESDesktopSettings.Get(item[0], item[1]), UriKind.Absolute, out endpoint)
                    && String.Equals(uri.GetLeftPart(UriPartial.Authority), endpoint.GetLeftPart(UriPartial.Authority), StringComparison.OrdinalIgnoreCase)) return item[2];
            }
            return "";
        }

        private string ClientForPage(Uri uri)
        {
            if (uri.AbsolutePath != "/" || uri.Query.Length > 0 || uri.Fragment.Length > 0) return null;
            if (CombinedClientEnabled() && SimulatorModule(uri).Length > 0) return CentralClientPath;
            // Simulator endpoints have explicit origins; a verified LAN address
            // for the MES server may use another host name with the same port.
            foreach (string[] item in new[] {
                new[] { "limsUrl", "http://127.0.0.1:8900", "lims-client", "MES_LIMS模拟器.exe" },
                new[] { "upperComputerUrl", "http://127.0.0.1:8899", "upper-client", "MES上位机模拟器.exe" }
            })
            {
                Uri simulator;
                if (Uri.TryCreate(MESDesktopSettings.Get(item[0], item[1]), UriKind.Absolute, out simulator)
                    && String.Equals(uri.GetLeftPart(UriPartial.Authority), simulator.GetLeftPart(UriPartial.Authority), StringComparison.OrdinalIgnoreCase))
                    return NativeClientPath(item[2], item[3]);
            }
            Uri configured;
            return Uri.TryCreate(MESAccessInfo.InitialServerUrl(), UriKind.Absolute, out configured) && configured.Port == uri.Port ? CentralClientPath : null;
        }

        private void OpenNativeClient(string path, Uri uri, string tab = "")
        {
            using (Process process = Process.Start(new ProcessStartInfo {
                FileName = path,
                Arguments = "--server-url \"" + uri.GetLeftPart(UriPartial.Authority) + "\"" + (tab.Length > 0 ? " --show-tab " + tab : ""),
                WorkingDirectory = Path.GetDirectoryName(path), UseShellExecute = true
            }))
            {
                if (process == null) throw new InvalidOperationException("无法启动专用客户端：" + Path.GetFileNameWithoutExtension(path));
                try { process.WaitForInputIdle(3000); }
                catch (InvalidOperationException) { } // A repeated launch only activates the existing instance.
                if (process.HasExited && process.ExitCode != 0) throw new InvalidOperationException("专用客户端启动或唤起失败：" + Path.GetFileNameWithoutExtension(path));
            }
        }

        private void CloseNativeClient(string path)
        {
            bool running=false;
            foreach (Process candidate in Process.GetProcessesByName(Path.GetFileNameWithoutExtension(path)))
            using (candidate) {
                try { if (String.Equals(candidate.MainModule.FileName,path,StringComparison.OrdinalIgnoreCase)) { running=true; break; } }
                catch (System.ComponentModel.Win32Exception) { }
                catch (InvalidOperationException) { }
            }
            if (!running) return;
            using (Process process = Process.Start(new ProcessStartInfo {
                FileName = path, Arguments = "--close", WorkingDirectory = Path.GetDirectoryName(path),
                UseShellExecute = false, CreateNoWindow = true
            }))
            {
                if (process == null || !process.WaitForExit(12000)) throw new InvalidOperationException("专用客户端关闭超时：" + Path.GetFileNameWithoutExtension(path));
                if (process.ExitCode != 0) throw new InvalidOperationException("专用客户端未确认退出：" + Path.GetFileNameWithoutExtension(path));
            }
        }

        private Process ReadProcess()
        {
            Process process = null;
            try
            {
                if (!File.Exists(StatePath)) return null;
                Dictionary<string, object> state = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(File.ReadAllText(StatePath));
                process = Process.GetProcessById(Convert.ToInt32(state["pid"]));
                if (!process.HasExited && process.StartTime.ToUniversalTime().Ticks.ToString() == Convert.ToString(state["started"])
                    && String.Equals(process.MainModule.FileName, Convert.ToString(state["executable"]), StringComparison.OrdinalIgnoreCase)) return process;
            }
            catch (Exception) { } // Missing/stale/inaccessible identity never authorizes closing a process.
            if (process != null) process.Dispose();
            return null;
        }

        private static string FindBrowser()
        {
            // Prefer the default browser when it supports an isolated profile.
            using (Microsoft.Win32.RegistryKey choice = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\Shell\Associations\UrlAssociations\https\UserChoice"))
            {
                string id = choice == null ? "" : Convert.ToString(choice.GetValue("ProgId"));
                using (Microsoft.Win32.RegistryKey command = Microsoft.Win32.Registry.ClassesRoot.OpenSubKey(id + @"\shell\open\command"))
                {
                    Match match = Regex.Match(command == null ? "" : Convert.ToString(command.GetValue(null)), "^\\\"([^\\\"]+)\\\"");
                    if (match.Success && File.Exists(match.Groups[1].Value)
                        && Regex.IsMatch(Path.GetFileName(match.Groups[1].Value), @"^(msedge|chrome)\.exe$", RegexOptions.IgnoreCase)) return match.Groups[1].Value;
                }
            }
            foreach (string root in new[] { Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData) })
                foreach (string relative in new[] { @"Microsoft\Edge\Application\msedge.exe", @"Google\Chrome\Application\chrome.exe" })
                {
                    string path = Path.Combine(root, relative);
                    if (File.Exists(path)) return path;
                }
            throw new InvalidOperationException("未找到 Edge 或 Chrome，请手动访问 MES 地址。");
        }

        private static string ProfileFromCommand(string command)
        {
            if (String.IsNullOrEmpty(command)) return null;
            int count;
            IntPtr arguments = CommandLineToArgvW(command, out count);
            if (arguments == IntPtr.Zero) return null;
            try
            {
                string profile = null;
                for (int i = 1; i < count; i++)
                {
                    string argument = Marshal.PtrToStringUni(Marshal.ReadIntPtr(arguments, i * IntPtr.Size));
                    if (argument.StartsWith("--type=", StringComparison.OrdinalIgnoreCase)) return null;
                    if (argument.StartsWith("--user-data-dir=", StringComparison.OrdinalIgnoreCase)) profile = argument.Substring(16);
                }
                return profile;
            }
            finally { LocalFree(arguments); }
        }

        private Process FindProfileProcess(string browserPath)
        {
            string profile = Path.Combine(directory, "Profile");
            string name = Path.GetFileName(browserPath).Replace("'", "''");
            using (ManagementObjectSearcher search = new ManagementObjectSearcher("SELECT ProcessId, CommandLine, ExecutablePath FROM Win32_Process WHERE Name='" + name + "'"))
            {
                search.Options.Timeout = TimeSpan.FromSeconds(2);
                using (ManagementObjectCollection processes = search.Get())
                foreach (ManagementObject item in processes)
                using (item)
                {
                    string value = ProfileFromCommand(Convert.ToString(item["CommandLine"]));
                    if (!String.Equals(value, profile, StringComparison.OrdinalIgnoreCase)
                        || !String.Equals(Convert.ToString(item["ExecutablePath"]), browserPath, StringComparison.OrdinalIgnoreCase)) continue;
                    try
                    {
                        Process process = Process.GetProcessById(Convert.ToInt32(item["ProcessId"]));
                        if (!process.HasExited && Windows(process.Id).Count > 0) return process;
                        process.Dispose();
                    }
                    catch (ArgumentException) { } // Process exited during enumeration.
                }
            }
            return null;
        }

        internal void Open(string[] urls)
        {
            if (urls == null || urls.Length == 0) return;
            StringBuilder arguments = new StringBuilder();
            List<Uri> validated = new List<Uri>();
            foreach (string url in urls)
            {
                Uri uri;
                if (!Uri.TryCreate(url, UriKind.Absolute, out uri) || (uri.Scheme != "http" && uri.Scheme != "https") || uri.UserInfo.Length > 0)
                    throw new InvalidOperationException("MES 页面地址不是有效的 HTTP(S) 地址。");
                validated.Add(uri);
            }
            bool combined = CombinedClientEnabled();
            if (combined)
            {
                Uri primary = validated.Find(delegate(Uri page) { return ClientForPage(page) == CentralClientPath && SimulatorModule(page).Length == 0; });
                Uri simulator = validated.Find(delegate(Uri page) { return ClientForPage(page) == CentralClientPath && SimulatorModule(page).Length > 0; });
                if (primary != null || simulator != null)
                    OpenNativeClient(CentralClientPath, primary ?? new Uri(MESAccessInfo.InitialServerUrl()), primary != null ? "central" : SimulatorModule(simulator));
            }
            foreach (Uri uri in validated)
            {
                string client = ClientForPage(uri);
                if (combined && client == CentralClientPath) continue;
                if (client != null) { OpenNativeClient(client, uri); continue; }
                arguments.Append(" \"").Append(uri.AbsoluteUri.Replace("\"", "%22")).Append("\"");
            }
            if (arguments.Length == 0) return;
            lock (sessionLock)
            {
                Directory.CreateDirectory(directory);
                using (Process existing = ReadProcess())
                {
                    string browserPath = existing == null ? (executable ?? FindBrowser()) : existing.MainModule.FileName;
                    using (Process launched = Process.Start(new ProcessStartInfo
                    {
                        FileName = browserPath,
                        Arguments = "--user-data-dir=\"" + Path.Combine(directory, "Profile") + "\" --no-first-run --no-default-browser-check --new-window" + arguments,
                        UseShellExecute = true
                    }))
                    {
                        if (existing == null && launched != null)
                        {
                            try { launched.WaitForInputIdle(3000); }
                            catch (InvalidOperationException) { } // Browser launcher handed off to another process.
                        }
                        // Edge/Chrome can relaunch to change elevation. Identify
                        // that root by its exact private profile, never by name alone.
                        Process resolved = null;
                        try
                        {
                            Process owner = existing != null && !existing.HasExited ? existing : launched;
                            if (owner == null || owner.HasExited || Windows(owner.Id).Count == 0)
                            {
                                Stopwatch clock = Stopwatch.StartNew();
                                do
                                {
                                    resolved = FindProfileProcess(Path.GetFullPath(browserPath));
                                    if (resolved != null) break;
                                    System.Threading.Thread.Sleep(100);
                                } while (clock.ElapsedMilliseconds < 5000);
                                owner = resolved;
                            }
                            if (owner == null || owner.HasExited) throw new InvalidOperationException("MES 浏览器窗口未能启动，请手动访问 MES 地址。");
                            File.WriteAllText(StatePath, new JavaScriptSerializer().Serialize(new Dictionary<string, object>
                            {
                                { "pid", owner.Id }, { "started", owner.StartTime.ToUniversalTime().Ticks.ToString() }, { "executable", Path.GetFullPath(browserPath) }
                            }));
                        }
                        finally { if (resolved != null) resolved.Dispose(); }
                    }
                }
            }
        }

        private static List<IntPtr> Windows(int processId)
        {
            List<IntPtr> windows = new List<IntPtr>();
            EnumWindows(delegate(IntPtr window, IntPtr parameter)
            {
                uint owner;
                GetWindowThreadProcessId(window, out owner);
                if (owner == processId && IsWindowVisible(window)) windows.Add(window);
                return true;
            }, IntPtr.Zero);
            return windows;
        }

        internal void CloseNativeClients()
        {
            List<Task> tasks=new List<Task>();
            foreach (string path in NativeClientPaths())
                tasks.Add(Task.Run(delegate { CloseNativeClient(path); }));
            try { Task.WaitAll(tasks.ToArray()); }
            catch (AggregateException error) {
                List<string> messages=new List<string>();
                foreach (Exception item in error.Flatten().InnerExceptions) messages.Add(item.Message);
                throw new InvalidOperationException(String.Join("；",messages.ToArray()));
            }
        }

        internal void Close()
        {
            List<string> errors = new List<string>();
            try { CloseNativeClients(); } catch (Exception error) { errors.Add(error.Message); }
            try { CloseBrowser(); }
            catch (Exception error) { errors.Add(error.Message); }
            if (errors.Count > 0) throw new InvalidOperationException(String.Join("；", errors));
        }

        internal void CloseBrowserWindows() { CloseBrowser(); }

        private void CloseBrowser()
        {
            lock (sessionLock)
            using (Process process = ReadProcess())
            {
                if (process == null) return;
                foreach (IntPtr window in Windows(process.Id)) PostMessage(window, 0x0010, IntPtr.Zero, IntPtr.Zero);
                Stopwatch clock = Stopwatch.StartNew();
                while (!process.HasExited && Windows(process.Id).Count > 0 && clock.ElapsedMilliseconds < 3000)
                    System.Threading.Thread.Sleep(50);
                if (!process.HasExited && Windows(process.Id).Count > 0)
                    throw new InvalidOperationException("MES 浏览器窗口仍在等待关闭，请检查页面提示。");
                // Let a browser shutting down after its final window finish
                // before Restart sends it a new-window request.
                if (!process.HasExited) process.WaitForExit(1000);
                // Chromium can keep background tasks after its final window closes.
                // Keep the verified identity for the next open; never force-kill it.
            }
        }
    }

    internal sealed class ServiceIndicator
    {
        internal Label Dot;
        internal Label Status;
    }

    internal sealed class ServiceHealthSnapshot
    {
        internal bool Backend;
        internal bool Frontend;
        internal bool Lims;
        internal bool UpperComputer;

        internal int HealthyCount
        {
            get { return (Backend ? 1 : 0) + (Frontend ? 1 : 0) + (Lims ? 1 : 0) + (UpperComputer ? 1 : 0); }
        }
    }

    internal static class ControlCenterIcon
    {
        internal static Icon Load(int size)
        {
            using (Stream stream=typeof(ControlCenterIcon).Assembly.GetManifestResourceStream("MESControlCenter.Icon.ico"))
            {
                if (stream == null) throw new InvalidOperationException("控制中心图标资源缺失。");
                using (Icon icon=new Icon(stream,new Size(size,size))) return (Icon)icon.Clone();
            }
        }
    }

    internal sealed class BrandIcon : Control
    {
        private readonly Bitmap logo;
        internal BrandIcon()
        {
            DoubleBuffered=true; Size=new Size(42,42); AccessibleName="MES控制中心蓝色轨道图标";
            using (Icon icon=ControlCenterIcon.Load(128)) logo=icon.ToBitmap();
        }
        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            e.Graphics.InterpolationMode=System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
            e.Graphics.PixelOffsetMode=System.Drawing.Drawing2D.PixelOffsetMode.HighQuality;
            e.Graphics.DrawImage(logo,ClientRectangle);
        }
        protected override void Dispose(bool disposing)
        { if (disposing) logo.Dispose(); base.Dispose(disposing); }
    }

    internal sealed class ServiceProgressBar : Control
    {
        private int value;
        public int Value
        {
            get { return value; }
            set { this.value = Math.Max(0, Math.Min(100, value)); AccessibleDescription = this.value + "%"; Invalidate(); }
        }

        internal ServiceProgressBar()
        {
            DoubleBuffered = true;
            AccessibleRole = AccessibleRole.ProgressBar;
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            e.Graphics.Clear(Theme.SurfaceStrong);
            using (SolidBrush fill = new SolidBrush(Theme.Accent))
                e.Graphics.FillRectangle(fill, 0, 0, (int)Math.Round(Width * value / 100.0), Height);
            using (Pen border = new Pen(Theme.BorderStrong))
                e.Graphics.DrawRectangle(border, 0, 0, Width - 1, Height - 1);
        }
    }

    internal sealed class ControlCenterForm : Form
    {
        private readonly string controlScript;
        private MESBrowserSession browserSession;
        private readonly TerminalManagerClient terminalClient = new TerminalManagerClient();
        private readonly Timer refreshTimer = new Timer();
        private readonly Timer serviceStatusTimer = new Timer();
        private readonly Timer serviceProgressTimer = new Timer();
        private readonly Stopwatch serviceProgressClock = new Stopwatch();
        private readonly bool automaticRefresh;
        private readonly List<Button> serviceButtons = new List<Button>();
        private Button themeButton;

        private Panel dashboardPage;
        private Panel terminalPage;
        private Panel aboutPage;
        private ConfigurationPage configurationPage;
        private Button dashboardNav;
        private Button terminalNav;
        private Button aboutNav;
        private Button configurationNav;
        private Button integrityNav;
        private ComponentIntegrityPage integrityPage;
        private Label aboutBinding;
        private Label aboutGuidance;
        private TextBox aboutLocalUrl;
        private DataGridView aboutGrid;
        private Button aboutRefreshButton;
        private Button aboutCopyButton;
        private Button aboutOpenButton;
        private bool aboutBusy;
        private bool aboutLoaded;
        private LinkLabel lanAddressLink;
        private Label lanAddressStatus;
        private string selectedLanUrl = "";
        private Label pageTitle;
        private Label pageDescription;
        private Label systemStatusLabel;
        private Label serviceStateLabel;
        private ServiceIndicator serviceBackendIndicator;
        private ServiceIndicator serviceFrontendIndicator;
        private ServiceIndicator serviceLimsIndicator;
        private ServiceIndicator serviceUpperComputerIndicator;
        private Label onlineMetricLabel;
        private Label commandMetricLabel;
        private Label offlineMetricLabel;
        private Label terminalSummaryLabel;
        private Label footerStatusLabel;
        private TextBox serverText;
        private TextBox usernameText;
        private TextBox passwordText;
        private Button connectButton;
        private Button refreshButton;
        private Button startServiceButton;
        private Button openCentralButton;
        private bool openCentralBusy;
        private Button reloadButton;
        private ToolStripMenuItem shutdownButton;
        private ToolStripMenuItem restartTerminalButton;
        private ToolStripMenuItem shutdownAllButton;
        private ToolStripMenuItem restartAllButton;
        private Button moreTerminalButton;
        private ContextMenuStrip terminalMenu;
        private Label selectedTerminalLabel;
        private Label terminalCountLabel;
        private TextBox terminalSearch;
        private ComboBox terminalFilter;
        private Panel terminalDetails;
        private TextBox terminalDetailText;
        private Button terminalDetailButton;
        private string terminalSort = "TerminalName";
        private bool terminalSortDescending;
        private bool bindingTerminals;
        private Panel connectionCard;
        private Panel connectionFields;
        private Panel connectionHead;
        private Label connectionSummary;
        private bool connectionExpanded = true;
        private DataGridView dashboardGrid;
        private DataGridView terminalGrid;
        private TerminalEnrollmentPanel enrollmentPanel;
        private Button resetBindingButton;
        private ToolStripMenuItem deleteBindingButton;
        private ToolStripMenuItem cleanupBindingsButton;
        private Panel modalOverlay;
        private Label modalTitle;
        private Label modalBody;
        private Button modalCancelButton;
        private Button modalConfirmButton;
        private Action modalConfirmAction;
        private Panel serviceProgressOverlay;
        private ServiceProgressBar serviceProgressBar;
        private Label serviceProgressTitle;
        private Label serviceProgressPercent;
        private string progressAction;
        private int serviceGeneration;

        private List<TerminalRow> rows = new List<TerminalRow>();
        private bool terminalConnected;
        private bool serviceBusy;
        private bool serviceStatusBusy;
        private bool terminalBusy;
        private bool systemRunning;
        private bool exitAllowed;
        private bool exitRequested;

        internal ControlCenterForm(string scriptPath, bool autoStart)
        {
            Theme.LoadPreference();
            controlScript = scriptPath;
            browserSession = new MESBrowserSession(Program.RuntimeRoot, null);
            automaticRefresh = autoStart;
            Text = "MES 控制中心 v2.10.0";
            Icon = ControlCenterIcon.Load(32);
            StartPosition = FormStartPosition.CenterScreen;
            MinimumSize = new Size(1160, 700);
            ClientSize = new Size(1420, 820);
            BackColor = Theme.Background;
            ForeColor = Theme.Text;
            Font = new Font("Microsoft YaHei UI", 9.5F, FontStyle.Regular, GraphicsUnit.Point);
            KeyPreview = true;

            BuildShell();
            BuildModal();
            BuildServiceProgress();
            Theme.Apply(this);
            Shown+=async delegate { if (integrityPage != null) await integrityPage.CheckAsync(false); };
            refreshTimer.Interval = 5000;
            refreshTimer.Tick += async delegate { if (!serviceBusy) await RefreshTerminals(false); };
            serviceStatusTimer.Interval = 5000;
            serviceStatusTimer.Tick += async delegate { if (!serviceBusy) await RefreshServiceStatus(false); };
            serviceProgressTimer.Interval = 160;
            serviceProgressTimer.Tick += delegate { UpdateServiceProgress(); };
            FormClosed += delegate { refreshTimer.Dispose(); serviceStatusTimer.Dispose(); serviceProgressTimer.Dispose(); if (terminalMenu != null) terminalMenu.Dispose(); };
            FormClosing += HandleControllerClosing;
            if (autoStart)
            {
                Shown += async delegate
                {
                    await RefreshServiceStatus(false);
                    if (!aboutLoaded) await RefreshAboutInfo();
                    serviceStatusTimer.Start();
                    await ConnectAndRefresh(false);
                };
            }
            KeyDown += delegate(object sender, KeyEventArgs args)
            {
                if (args.KeyCode == Keys.F5)
                {
                    args.Handled = true;
                    RefreshAll();
                }
                else if (args.KeyCode == Keys.Escape && modalOverlay.Visible)
                {
                    HideModal();
                }
            };
        }

        private void BuildShell()
        {
            Panel sidebar = new Panel { Dock = DockStyle.Left, Width = 220, BackColor = Theme.Sidebar, Padding = new Padding(14, 20, 14, 18) };
            Controls.Add(sidebar);

            Panel brand = new Panel { Dock = DockStyle.Top, Height = 70 };
            BrandIcon brandIcon = new BrandIcon { Location = new Point(6, 2) };
            Label brandTitle = new Label { AutoSize = false, Size = new Size(136, 27), ForeColor = Theme.Text, Font = new Font(Font.FontFamily, 10F, FontStyle.Bold), Location = new Point(58, 6), Text = "MES 控制中心" };
            Label brandVersion = new Label { AutoSize = true, ForeColor = Theme.Accent, BackColor = Theme.AccentSoft, Padding = new Padding(6, 2, 6, 2), Font = new Font("Segoe UI", 9F), Location = new Point(59, 34), Text = "v2.10.0" };
            brand.Controls.AddRange(new Control[] { brandIcon, brandTitle, brandVersion });
            sidebar.Controls.Add(brand);

            dashboardNav = CreateNavigationButton("控制台总览", 90);
            terminalNav = CreateNavigationButton("终端管理", 138);
            dashboardNav.Click += delegate { ShowPage(true); };
            terminalNav.Click += delegate { ShowPage(false); };
            sidebar.Controls.AddRange(new Control[] { dashboardNav, terminalNav });

            Label systemSection = new Label { AutoSize = true, ForeColor = Theme.Subtle, Font = new Font(Font.FontFamily, 8F, FontStyle.Bold), Location = new Point(24, 210), Text = "SYSTEM" };
            sidebar.Controls.Add(systemSection);
            aboutNav = CreateNavigationButton("关于与访问地址", 232);
            aboutNav.Click += async delegate { ShowAboutPage(); await RefreshAboutInfo(); };
            sidebar.Controls.Add(aboutNav);
            configurationNav = CreateNavigationButton("系统配置", 280);
            configurationNav.Click += delegate { ShowConfigurationPage(); };
            sidebar.Controls.Add(configurationNav);
            integrityNav=CreateNavigationButton("系统完整性",328);
            integrityNav.Click+=async delegate { ShowIntegrityPage(); await integrityPage.CheckAsync(false); };
            sidebar.Controls.Add(integrityNav);

            Panel nodeSummary = new Panel { Dock = DockStyle.Bottom, Height = 140, BackColor = Theme.Surface };
            nodeSummary.Padding = new Padding(13);
            Label nodeTitle = new Label { AutoSize = true, ForeColor = Theme.Text, Font = new Font(Font.FontFamily, 9F, FontStyle.Bold), Location = new Point(13, 13), Text = "控制节点状态" };
            systemStatusLabel = new Label { AutoSize = false, ForeColor = Theme.Muted, Location = new Point(13, 38), Size = new Size(166, 30), Text = "正在检测……" };
            themeButton = CreateButton(Theme.IsDark ? "切换浅色主题" : "切换深色主题", Theme.SurfaceStrong, Theme.Text, 166);
            themeButton.Name = "ThemeToggle";
            themeButton.Location = new Point(13, 84);
            themeButton.Click += delegate {
                Theme.Toggle(this);
                themeButton.Text = Theme.IsDark ? "切换浅色主题" : "切换深色主题";
                ApplyStartButtonVisual(startServiceButton.Enabled);
                terminalGrid.Invalidate(); dashboardGrid.Invalidate();
            };
            nodeSummary.Controls.AddRange(new Control[] { nodeTitle, systemStatusLabel, themeButton });
            sidebar.Controls.Add(nodeSummary);

            Panel main = new Panel { Dock = DockStyle.Fill, BackColor = Theme.Background };
            Controls.Add(main);
            main.BringToFront();

            TableLayoutPanel mainLayout = new TableLayoutPanel { Dock = DockStyle.Fill, BackColor = Theme.Background, ColumnCount = 1, RowCount = 3, Margin = new Padding(0), Padding = new Padding(0) };
            mainLayout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100F));
            mainLayout.RowStyles.Add(new RowStyle(SizeType.Absolute, 66F));
            mainLayout.RowStyles.Add(new RowStyle(SizeType.Percent, 100F));
            mainLayout.RowStyles.Add(new RowStyle(SizeType.Absolute, 34F));
            main.Controls.Add(mainLayout);

            Panel topbar = new Panel { Dock = DockStyle.Fill, BackColor = Theme.Surface, Padding = new Padding(22, 0, 22, 0), Margin = new Padding(0) };
            pageTitle = new Label { AutoSize = true, ForeColor = Theme.Text, Font = new Font(Font.FontFamily, 14F, FontStyle.Bold), Location = new Point(22, 10), Text = "控制台总览" };
            pageDescription = new Label { AutoSize = true, ForeColor = Theme.Muted, Font = new Font(Font.FontFamily, 8.5F), Location = new Point(24, 38), Text = "服务状态、快捷控制与终端概况" };
            Label shortcut = new Label { AutoSize = true, Anchor = AnchorStyles.Top | AnchorStyles.Right, ForeColor = Theme.Subtle, Font = new Font("Segoe UI", 8F), Text = "F5 刷新全部", Location = new Point(topbar.Width - 100, 26) };
            shortcut.LocationChanged += delegate { };
            topbar.Resize += delegate { shortcut.Left = topbar.ClientSize.Width - shortcut.Width - 24; };
            topbar.Controls.AddRange(new Control[] { pageTitle, pageDescription, shortcut });
            mainLayout.Controls.Add(topbar, 0, 0);

            Panel footer = new Panel { Dock = DockStyle.Fill, BackColor = Theme.SurfaceStrong, Margin = new Padding(0) };
            footerStatusLabel = new Label { AutoSize = false, Dock = DockStyle.Fill, ForeColor = Theme.Muted, TextAlign = ContentAlignment.MiddleLeft, Padding = new Padding(18, 0, 0, 0), Text = "准备就绪" };
            footer.Controls.Add(footerStatusLabel);
            mainLayout.Controls.Add(footer, 0, 2);

            Panel pageHost = new Panel { Dock = DockStyle.Fill, BackColor = Theme.Background, Padding = new Padding(20), Margin = new Padding(0) };
            mainLayout.Controls.Add(pageHost, 0, 1);

            dashboardPage = BuildDashboardPage();
            terminalPage = BuildTerminalPage();
            aboutPage = BuildAboutPage();
            string deploymentMode = MESDesktopSettings.IsNative ? "native" : MESDesktopSettings.IsDocker ? "docker" : "development";
            configurationPage = new ConfigurationPage(deploymentMode,
                delegate { return ConfigurationDocument.Locate(deploymentMode, Program.RuntimeRoot, Path.GetDirectoryName(typeof(ControlCenterForm).Assembly.Location)); },
                delegate { return serviceBusy || openCentralBusy || exitRequested; }, delegate { RequestServiceAction("Restart"); });
            configurationPage.Visible = false;
            if (MESDesktopSettings.IsDocker) configurationPage.ReadDockerTemplates = delegate { return ConfigurationDocument.DockerTemplates(Path.GetDirectoryName(typeof(ControlCenterForm).Assembly.Location)); };
            pageHost.Controls.Add(configurationPage);
            integrityPage=new ComponentIntegrityPage(ControlCenterPaths.DesktopRoot,delegate { return serviceBusy || openCentralBusy || exitRequested; });
            integrityPage.Visible=false;
            integrityPage.FindingsChanged=delegate(int count) { integrityNav.AccessibleDescription=count+" 项组件需要关注"; integrityNav.Text="  系统完整性"+(count > 0 ? "（"+count+"）" : ""); };
            pageHost.Controls.Add(integrityPage);
            pageHost.Controls.Add(aboutPage);
            pageHost.Controls.Add(terminalPage);
            pageHost.Controls.Add(dashboardPage);
            ShowPage(true);
        }

        private Panel BuildDashboardPage()
        {
            Panel page = new Panel { Dock = DockStyle.Fill, BackColor = Theme.Background };
            TableLayoutPanel layout = new TableLayoutPanel { Dock = DockStyle.Fill, BackColor = Theme.Background, ColumnCount = 2, RowCount = 2, Padding = new Padding(0) };
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 44F));
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 56F));
            layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 268F));
            layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100F));
            page.Controls.Add(layout);

            Panel serviceCard = CreateCard(new Padding(0, 0, 7, 7));
            BuildServiceCard(serviceCard);
            layout.Controls.Add(serviceCard, 0, 0);

            Panel metrics = new Panel { Dock = DockStyle.Fill, BackColor = Theme.Background, Padding = new Padding(7, 0, 0, 7) };
            TableLayoutPanel metricLayout = new TableLayoutPanel { Dock = DockStyle.Fill, BackColor = Theme.Background, ColumnCount = 3, RowCount = 1 };
            metricLayout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 33.33F));
            metricLayout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 33.33F));
            metricLayout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 33.34F));
            onlineMetricLabel = AddMetric(metricLayout, 0, "在线终端", "0", "等待连接", Theme.Accent);
            commandMetricLabel = AddMetric(metricLayout, 1, "待执行命令", "0", "队列状态", Theme.Warning);
            offlineMetricLabel = AddMetric(metricLayout, 2, "异常终端", "0", "离线或未上报", Theme.Danger);
            metrics.Controls.Add(metricLayout);
            layout.Controls.Add(metrics, 1, 0);

            Panel tableCard = CreateCard(new Padding(0, 7, 0, 0));
            layout.SetColumnSpan(tableCard, 2);
            TableLayoutPanel tableHead = new TableLayoutPanel { Dock = DockStyle.Top, Height = 58, BackColor = Theme.Surface, Padding = new Padding(16, 8, 12, 8), ColumnCount = 3, RowCount = 1 };
            tableHead.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100F));
            tableHead.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
            tableHead.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
            Label tableTitle = new Label { AutoSize = true, Anchor = AnchorStyles.Left, ForeColor = Theme.Text, Font = new Font(Font.FontFamily, 10F, FontStyle.Bold), Text = "终端概况" };
            terminalSummaryLabel = new Label { AutoSize = true, Anchor = AnchorStyles.Right, Margin = new Padding(8, 0, 18, 0), ForeColor = Theme.Muted, Text = "尚未连接" };
            Button manageButton = CreateButton("进入终端管理", Theme.AccentSoft, Theme.Accent, 126);
            manageButton.Anchor = AnchorStyles.Right;
            manageButton.Name = "ManageTerminals";
            manageButton.Click += delegate { ShowPage(false); };
            tableHead.Controls.Add(tableTitle, 0, 0);
            tableHead.Controls.Add(terminalSummaryLabel, 1, 0);
            tableHead.Controls.Add(manageButton, 2, 0);
            dashboardGrid = CreateTerminalGrid(false);
            tableCard.Controls.Add(dashboardGrid);
            tableCard.Controls.Add(tableHead);
            layout.Controls.Add(tableCard, 0, 1);
            TableLayoutPanel accessBar = new TableLayoutPanel { Dock = DockStyle.Top, Height = 98, BackColor = Theme.Surface, Padding = new Padding(16, 8, 16, 8), ColumnCount = 3, RowCount = 1 };
            accessBar.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100F));
            accessBar.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
            accessBar.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
            Panel addressInfo = new Panel { Dock = DockStyle.Fill, Margin = new Padding(0, 0, 16, 0) };
            Label accessTitle = new Label { Dock = DockStyle.Top, Height = 22, ForeColor = Theme.Muted, Text = "MES 局域网访问地址" };
            lanAddressLink = new LinkLabel { AutoSize = false, Dock = DockStyle.Top, Height = 30, AutoEllipsis = true, LinkColor = Theme.Accent, ActiveLinkColor = Theme.AccentStrong, VisitedLinkColor = Theme.Accent, Font = new Font("Consolas", 12F, FontStyle.Bold), Text = "正在检测主机地址……", AccessibleName = "MES 局域网访问地址" };
            lanAddressLink.LinkClicked += async delegate { ShowAboutPage(); await RefreshAboutInfo(); };
            lanAddressStatus = new Label { AutoSize = false, Dock = DockStyle.Top, Height = 24, AutoEllipsis = true, ForeColor = Theme.Muted, Text = "等待服务就绪" };
            Button copyAddress = CreateButton("复制地址", Theme.AccentSoft, Theme.Accent, 108);
            openCentralButton = CreateButton("打开中控管理", Theme.AccentSoft, Theme.Accent, 140);
            openCentralButton.AccessibleName = "打开中控管理";
            openCentralButton.Anchor = AnchorStyles.Right;
            openCentralButton.Click += async delegate { await OpenCentralManagement(); };
            copyAddress.Anchor = AnchorStyles.Right;
            copyAddress.Click += delegate
            {
                if (selectedLanUrl.Length == 0) return;
                try { Clipboard.SetText(selectedLanUrl); footerStatusLabel.Text = "已复制：" + selectedLanUrl + "；请从工作站验证访问"; }
                catch (Exception exception) { ShowModal("复制失败", exception.Message, false, null, true); }
            };
            addressInfo.Controls.Add(lanAddressStatus); addressInfo.Controls.Add(lanAddressLink); addressInfo.Controls.Add(accessTitle);
            accessBar.Controls.Add(addressInfo, 0, 0); accessBar.Controls.Add(openCentralButton, 1, 0); accessBar.Controls.Add(copyAddress, 2, 0);
            page.Controls.Add(accessBar);
            return page;
        }

        private void BuildServiceCard(Panel card)
        {
            Panel head = new Panel { Dock = DockStyle.Top, Height = 52, BackColor = Theme.Surface };
            Label title = new Label { AutoSize = true, ForeColor = Theme.Text, Font = new Font(Font.FontFamily, 10F, FontStyle.Bold), Location = new Point(16, 16), Text = "MES 服务组" };
            serviceStateLabel = new Label { AutoSize = true, Anchor = AnchorStyles.Top | AnchorStyles.Right, ForeColor = Theme.Muted, Location = new Point(300, 17), Text = "正在检测" };
            EventHandler placeState = delegate { serviceStateLabel.Left = head.ClientSize.Width - serviceStateLabel.Width - 16; };
            head.Resize += placeState; serviceStateLabel.TextChanged += placeState;
            head.Controls.AddRange(new Control[] { title, serviceStateLabel });

            TableLayoutPanel actionBar = new TableLayoutPanel { Dock = DockStyle.Bottom, Height = 62, BackColor = Theme.Surface, Padding = new Padding(10, 8, 10, 8), ColumnCount = 3, RowCount = 1 };
            for (int i = 0; i < 3; i++) actionBar.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 33.333F));
            Button stop = CreateButton("关闭系统", Theme.DangerSoft, Theme.Danger, 106);
            Button restart = CreateButton("重启系统", Theme.WarningSoft, Theme.Warning, 106);
            startServiceButton = CreateButton("启动系统", Theme.AccentStrong, Theme.OnAccent, 106);
            stop.Click += delegate { RequestServiceAction("Stop"); };
            restart.Click += delegate { RequestServiceAction("Restart"); };
            startServiceButton.Click += delegate { RequestServiceAction("Start"); };
            serviceButtons.AddRange(new Button[] { stop, restart, startServiceButton });
            int column = 0;
            foreach (Button button in serviceButtons) { button.Dock = DockStyle.Fill; button.Margin = new Padding(4, 0, 4, 0); actionBar.Controls.Add(button, column++, 0); }

            Panel lines = new Panel { Dock = DockStyle.Fill, BackColor = Theme.Surface };
            serviceUpperComputerIndicator = AddServiceLine(lines, "上位机服务", MESDesktopSettings.PortLabel("upperComputerUrl", "http://127.0.0.1:8899"));
            serviceLimsIndicator = AddServiceLine(lines, "LIMS 模拟器", MESDesktopSettings.PortLabel("limsUrl", "http://127.0.0.1:8900"));
            serviceFrontendIndicator = AddServiceLine(lines, "前端服务", MESDesktopSettings.PortLabel("serverUrl", "http://127.0.0.1:5173"));
            serviceBackendIndicator = AddServiceLine(lines, "后端服务", MESDesktopSettings.PortLabel("apiUrl", "http://127.0.0.1:8000"));
            card.Controls.Add(lines);
            card.Controls.Add(actionBar);
            card.Controls.Add(head);
        }

        private ServiceIndicator AddServiceLine(Control parent, string name, string port)
        {
            Panel line = new Panel { Dock = DockStyle.Top, Height = 36, BackColor = Theme.Surface };
            Label dot = new Label { AutoSize = false, BackColor = Theme.Danger, Location = new Point(16, 14), Size = new Size(8, 8), AccessibleName = name + "状态灯" };
            Label label = new Label { AutoSize = true, ForeColor = Theme.Text, Location = new Point(34, 9), Text = name };
            Label status = new Label { AutoSize = true, Anchor = AnchorStyles.Top | AnchorStyles.Right, ForeColor = Theme.Danger, Location = new Point(260, 9), Text = "未运行", AccessibleName = name + "状态" };
            Label value = new Label { AutoSize = true, Anchor = AnchorStyles.Top | AnchorStyles.Right, ForeColor = Theme.Subtle, Font = new Font("Consolas", 8.5F), Location = new Point(340, 9), Text = port };
            line.Resize += delegate
            {
                value.Left = line.ClientSize.Width - value.Width - 16;
                status.Left = value.Left - status.Width - 18;
            };
            status.TextChanged += delegate { value.Left = line.ClientSize.Width - value.Width - 16; status.Left = value.Left - status.Width - 18; };
            line.Controls.AddRange(new Control[] { dot, label, status, value });
            parent.Controls.Add(line);
            return new ServiceIndicator { Dot = dot, Status = status };
        }

        private Label AddMetric(TableLayoutPanel parent, int column, string title, string value, string note, Color color)
        {
            Panel wrapper = new Panel { Dock = DockStyle.Fill, BackColor = Theme.Background, Padding = new Padding(column == 0 ? 0 : 6, 0, column == 2 ? 0 : 6, 0) };
            Panel card = new Panel { Dock = DockStyle.Fill, BackColor = Theme.Surface, Padding = new Padding(16) };
            Label titleLabel = new Label { AutoSize = true, ForeColor = Theme.Muted, Location = new Point(16, 18), Text = title };
            Label valueLabel = new Label { AutoSize = true, ForeColor = Theme.Text, Font = new Font("Segoe UI", 24F, FontStyle.Bold), Location = new Point(14, 52), Text = value };
            Label noteLabel = new Label { AutoSize = false, ForeColor = Theme.Subtle, Location = new Point(16, 104), Size = new Size(150, 36), Text = note };
            Panel marker = new Panel { BackColor = color, Location = new Point(16, 150), Size = new Size(28, 3) };
            card.Controls.AddRange(new Control[] { titleLabel, valueLabel, noteLabel, marker });
            card.Resize += delegate { noteLabel.Width = Math.Max(50, card.ClientSize.Width - 32); };
            wrapper.Controls.Add(card);
            parent.Controls.Add(wrapper, column, 0);
            return valueLabel;
        }

        private Panel BuildTerminalPage()
        {
            Panel page = new Panel { Dock = DockStyle.Fill, BackColor = Theme.Background, Visible = false };
            connectionCard = new Panel { Dock = DockStyle.Top, Height = 142, BackColor = Theme.Surface };
            TableLayoutPanel head = new TableLayoutPanel { Dock = DockStyle.Top, Height = 50, ColumnCount = 2, Padding = new Padding(12, 5, 12, 5) };
            connectionHead = head;
            head.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100F)); head.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
            connectionSummary = new Label { Dock = DockStyle.Fill, ForeColor = Theme.Muted, TextAlign = ContentAlignment.MiddleLeft, AutoEllipsis = true, Text = "未连接 · 使用管理员账号管理终端与绑定申请" };
            Button settings = CreateButton("连接设置", Theme.SurfaceStrong, Theme.Text, 108);
            head.Controls.Add(connectionSummary, 0, 0); head.Controls.Add(settings, 1, 0);
            connectionFields = new Panel { Dock = DockStyle.Top, Height = 92, BackColor = Theme.Surface };
            TableLayoutPanel credentials = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 5, RowCount = 1, Padding = new Padding(12, 0, 12, 10) };
            credentials.RowStyles.Add(new RowStyle(SizeType.Percent, 100F));
            credentials.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 46F)); credentials.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 27F)); credentials.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 27F));
            credentials.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize)); credentials.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
            serverText = AddInputField(credentials, "MES 地址", MESAccessInfo.InitialServerUrl(), 0, false);
            usernameText = AddInputField(credentials, "管理员", "admin", 1, false);
            passwordText = AddInputField(credentials, "密码", MESDesktopSettings.RequiresAdministratorLogin ? "" : "123", 2, true);
            connectButton = CreateButton("连接", Theme.AccentStrong, Theme.OnAccent, 88);
            connectButton.Anchor = AnchorStyles.Bottom;
            connectButton.Click += async delegate { await ConnectAndRefresh(true); };
            refreshButton = CreateButton("刷新状态", Theme.AccentSoft, Theme.Accent, 108);
            refreshButton.Anchor = AnchorStyles.Bottom;
            refreshButton.Click += async delegate { await RefreshTerminals(true); };
            credentials.Controls.Add(connectButton, 3, 0); credentials.Controls.Add(refreshButton, 4, 0);
            connectionFields.Controls.Add(credentials); connectionCard.Controls.Add(connectionFields); connectionCard.Controls.Add(head);
            settings.Click += delegate { SetConnectionExpanded(!connectionExpanded); };

            TableLayoutPanel actions = new TableLayoutPanel { Dock = DockStyle.Bottom, Height = 106, BackColor = Theme.Surface, Padding = new Padding(12, 8, 12, 8), ColumnCount = 2, RowCount = 2 };
            actions.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100F)); actions.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
            actions.RowStyles.Add(new RowStyle(SizeType.Absolute, 36F)); actions.RowStyles.Add(new RowStyle(SizeType.Percent, 100F));
            selectedTerminalLabel = new Label { Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleLeft, AutoEllipsis = true, ForeColor = Theme.Text, Text = "请选择终端" };
            terminalDetailButton = CreateButton("查看详情", Theme.SurfaceStrong, Theme.Text, 108); terminalDetailButton.Height = 30;
            terminalDetailButton.Click += delegate { terminalDetails.Visible = !terminalDetails.Visible; terminalDetailButton.Text = terminalDetails.Visible ? "收起详情" : "查看详情"; };
            actions.Controls.Add(selectedTerminalLabel, 0, 0); actions.Controls.Add(terminalDetailButton, 1, 0);
            FlowLayoutPanel common = new FlowLayoutPanel { Dock = DockStyle.Fill, WrapContents = false, Margin = new Padding(0), Padding = new Padding(0) };
            actions.Controls.Add(common, 0, 1); actions.SetColumnSpan(common, 2);
            reloadButton = CreateButton("刷新界面", Theme.AccentSoft, Theme.Accent, 128);
            resetBindingButton = CreateButton("重置绑定", Theme.AccentStrong, Theme.OnAccent, 128);
            moreTerminalButton = CreateButton("更多操作 ▾", Theme.SurfaceStrong, Theme.Text, 136);
            common.Controls.AddRange(new Control[] { reloadButton, resetBindingButton, moreTerminalButton });
            terminalMenu = new ContextMenuStrip { ShowImageMargin = false, Font = Font };
            moreTerminalButton.ContextMenuStrip = terminalMenu;
            restartTerminalButton = new ToolStripMenuItem("重启终端"); shutdownButton = new ToolStripMenuItem("关闭终端");
            deleteBindingButton = new ToolStripMenuItem("删除终端") { ForeColor = Theme.Danger };
            restartAllButton = new ToolStripMenuItem("重启全部"); shutdownAllButton = new ToolStripMenuItem("关闭全部");
            cleanupBindingsButton = new ToolStripMenuItem("清理历史终端") { ForeColor = Theme.Danger };
            terminalMenu.Items.AddRange(new ToolStripItem[] { new ToolStripLabel("当前终端") { ForeColor = Theme.Muted }, restartTerminalButton, shutdownButton, deleteBindingButton, new ToolStripSeparator(), new ToolStripLabel("批量与维护") { ForeColor = Theme.Muted }, restartAllButton, shutdownAllButton, cleanupBindingsButton });
            moreTerminalButton.Click += delegate { terminalMenu.Show(moreTerminalButton, new Point(0, moreTerminalButton.Height)); };
            reloadButton.Click += async delegate { await SendSelectedCommand("reload", "刷新界面"); };
            shutdownButton.Click += delegate { RequestSelectedTerminalCommand("shutdown", "关闭"); };
            restartTerminalButton.Click += delegate { RequestSelectedTerminalCommand("restart", "重启"); };
            shutdownAllButton.Click += delegate { RequestBatchCommand("shutdown", "关闭"); };
            restartAllButton.Click += delegate { RequestBatchCommand("restart", "重启"); };
            resetBindingButton.Click += delegate { RequestBindingAction(false); };
            deleteBindingButton.Click += delegate { RequestBindingAction(true); };
            cleanupBindingsButton.Click += async delegate { await PreviewLegacyCleanup(); };

            terminalDetails = new Panel { Dock = DockStyle.Bottom, Height = 144, BackColor = Theme.Surface, Padding = new Padding(14, 8, 14, 8), Visible = false };
            terminalDetailText = new ThemeTextBox { Dock = DockStyle.Fill, Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical, BorderStyle = BorderStyle.None, BackColor = Theme.Surface, ForeColor = Theme.Muted, AccessibleName = "选中终端详细信息" };
            terminalDetails.Controls.Add(terminalDetailText);
            TableLayoutPanel filters = new TableLayoutPanel { Dock = DockStyle.Top, Height = 54, ColumnCount = 4, Padding = new Padding(12, 8, 12, 8), BackColor = Theme.Surface };
            filters.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize)); filters.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100F)); filters.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 140F)); filters.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
            Label searchCaption = new Label { AutoSize = true, Anchor = AnchorStyles.Left, Text = "搜索终端 / 工位 / IP", ForeColor = Theme.Muted, Margin = new Padding(0, 0, 10, 0) };
            terminalSearch = new ThemeTextBox { Dock = DockStyle.Fill, BorderStyle = BorderStyle.FixedSingle, BackColor = Theme.SurfaceStrong, ForeColor = Theme.Text, AccessibleName = "搜索终端、主机或IP地址", Margin = new Padding(0, 4, 12, 0) };
            terminalFilter = new ThemeComboBox { Dock = DockStyle.Fill, DropDownStyle = ComboBoxStyle.DropDownList, BackColor = Theme.SurfaceStrong, ForeColor = Theme.Text, Margin = new Padding(0, 4, 12, 0), AccessibleName = "终端在线状态筛选" };
            terminalFilter.Items.AddRange(new object[] { "全部状态", "在线", "离线" }); terminalFilter.SelectedIndex = 0;
            terminalCountLabel = new Label { AutoSize = true, Anchor = AnchorStyles.Right, ForeColor = Theme.Muted, Text = "尚未连接" };
            filters.Controls.Add(searchCaption, 0, 0); filters.Controls.Add(terminalSearch, 1, 0); filters.Controls.Add(terminalFilter, 2, 0); filters.Controls.Add(terminalCountLabel, 3, 0);
            terminalGrid = CreateTerminalGrid(true);
            terminalGrid.SelectionChanged += delegate { UpdateTerminalActionState(); };
            terminalSearch.TextChanged += delegate { BindGrid(terminalGrid); }; terminalFilter.SelectedIndexChanged += delegate { BindGrid(terminalGrid); };
            TabControl tabs = new ThemeTabControl { Dock = DockStyle.Fill };
            TabPage registered = new TabPage("已绑定终端") { BackColor = Theme.Background };
            registered.Controls.Add(terminalGrid); registered.Controls.Add(terminalDetails); registered.Controls.Add(actions); registered.Controls.Add(filters);
            TabPage requests = new TabPage("绑定申请与记录") { BackColor = Theme.Background };
            enrollmentPanel = new TerminalEnrollmentPanel(terminalClient, async delegate { await LoadRows(); });
            enrollmentPanel.PendingChanged = delegate(int count) {
                requests.Text = "绑定申请与记录" + (count > 0 ? "（" + count + "）" : "");
                terminalNav.Text = "  终端管理" + (count > 0 ? "（" + count + "）" : "");
                terminalNav.AccessibleDescription = count + " 项终端绑定申请待审批";
            };
            requests.Controls.Add(enrollmentPanel); tabs.TabPages.Add(registered); tabs.TabPages.Add(requests);
            page.Controls.Add(tabs); page.Controls.Add(connectionCard);
            UpdateTerminalActionState();
            return page;
        }

        private void SetConnectionExpanded(bool expanded)
        {
            connectionExpanded = expanded; connectionFields.Visible = expanded;
            connectionCard.Height = connectionHead.Height + (expanded ? connectionFields.Height : 0);
        }

        private TextBox AddInputField(TableLayoutPanel parent, string caption, string value, int column, bool secret)
        {
            TableLayoutPanel field = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 2, Margin = new Padding(0, 0, 12, 0) };
            field.RowStyles.Add(new RowStyle(SizeType.Absolute, 26F)); field.RowStyles.Add(new RowStyle(SizeType.Percent, 100F));
            field.Controls.Add(new Label { Dock = DockStyle.Fill, Text = caption, TextAlign = ContentAlignment.BottomLeft, ForeColor = Theme.Muted }, 0, 0);
            TextBox input = new ThemeTextBox { Dock = DockStyle.Top, BackColor = Theme.SurfaceStrong, ForeColor = Theme.Text, BorderStyle = BorderStyle.FixedSingle, Text = value, UseSystemPasswordChar = secret, AccessibleName = caption };
            field.Controls.Add(input, 0, 1); parent.Controls.Add(field, column, 0); return input;
        }

        private DataGridView CreateTerminalGrid(bool detailed)
        {
            DataGridView grid = new DataGridView
            {
                Font = new Font(Font.FontFamily, 10F),
                Dock = DockStyle.Fill,
                BackgroundColor = Theme.Surface,
                BorderStyle = BorderStyle.None,
                AllowUserToAddRows = false,
                AllowUserToDeleteRows = false,
                AllowUserToResizeRows = false,
                AutoGenerateColumns = false,
                MultiSelect = false,
                ReadOnly = true,
                RowHeadersVisible = false,
                SelectionMode = DataGridViewSelectionMode.FullRowSelect,
                EnableHeadersVisualStyles = false,
                ColumnHeadersHeight = 42,
                RowTemplate = { Height = 48 }
            };
            grid.ColumnHeadersDefaultCellStyle = new DataGridViewCellStyle { BackColor = Theme.SurfaceStrong, ForeColor = Theme.Text, Font = new Font(grid.Font, FontStyle.Bold), SelectionBackColor = Theme.SurfaceStrong, Alignment = DataGridViewContentAlignment.MiddleLeft, Padding = new Padding(8, 0, 0, 0) };
            grid.DefaultCellStyle = new DataGridViewCellStyle { BackColor = Theme.Surface, ForeColor = Theme.Text, SelectionBackColor = Theme.AccentSoft, SelectionForeColor = Theme.Text, Padding = new Padding(5), WrapMode = DataGridViewTriState.False };
            grid.AlternatingRowsDefaultCellStyle = new DataGridViewCellStyle { BackColor = Theme.AlternateSurface };
            grid.GridColor = Theme.Border;
            AddColumn(grid, "状态", "Online", 80);
            AddColumn(grid, "终端 / 工位", "TerminalName", 200);
            AddColumn(grid, "IP 地址", "IpAddress", 140);
            AddColumn(grid, "当前页面", "CurrentPage", 170);
            AddColumn(grid, "最后心跳", "LastSeenAt", 140);
            AddColumn(grid, "最近命令", "CommandLabel", 160);
            grid.Columns["IpAddress"].DefaultCellStyle.Font = new Font("Consolas", 9F);
            grid.Columns["TerminalName"].DefaultCellStyle.WrapMode = DataGridViewTriState.True;
            grid.RowTemplate.Height = 52;
            Theme.StyleGrid(grid);
            grid.CellFormatting += GridCellFormatting;
            grid.CellToolTipTextNeeded += delegate(object sender, DataGridViewCellToolTipTextNeededEventArgs args) {
                if (args.RowIndex < 0 || args.ColumnIndex < 0) return;
                TerminalRow row = grid.Rows[args.RowIndex].DataBoundItem as TerminalRow;
                if (row != null) args.ToolTipText = row.TerminalName + "\n主机：" + row.MachineName + "\n路径：" + row.CurrentPath + "\n心跳：" + row.LastSeenAt + "\n权限：" + row.PermissionLabel + "\n命令：" + row.CommandLabel;
            };
            grid.Paint += delegate(object sender, PaintEventArgs args) {
                if (grid.Rows.Count > 0) return;
                string message = grid.Tag as string;
                if (String.IsNullOrEmpty(message)) message = !terminalConnected ? "尚未连接终端服务，请在终端管理中使用管理员账号连接。" : rows.Count == 0 ? "暂无已绑定终端。工作机提交申请后，请在“绑定申请与记录”中审批。" : "没有符合筛选条件的终端，请调整搜索或在线状态。";
                Rectangle area = new Rectangle(24, grid.ColumnHeadersHeight + 24, Math.Max(1, grid.ClientSize.Width - 48), Math.Max(1, grid.ClientSize.Height - grid.ColumnHeadersHeight - 48));
                TextRenderer.DrawText(args.Graphics, message, grid.Font, area, Theme.Muted, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.WordBreak | TextFormatFlags.NoPrefix);
            };
            if (detailed) grid.ColumnHeaderMouseClick += delegate(object sender, DataGridViewCellMouseEventArgs args) {
                if (args.ColumnIndex < 0) return;
                string property = grid.Columns[args.ColumnIndex].Name;
                terminalSortDescending = property == terminalSort && !terminalSortDescending;
                terminalSort = property; BindGrid(grid);
            };
            return grid;
        }

        private void AddColumn(DataGridView grid, string header, string property, int width)
        {
            grid.Columns.Add(new DataGridViewTextBoxColumn { HeaderText = header, DataPropertyName = property, Name = property, Width = width, FillWeight = width, AutoSizeMode = DataGridViewAutoSizeColumnMode.Fill, MinimumWidth = property == "Online" ? 70 : property == "TerminalName" ? 130 : 110, SortMode = DataGridViewColumnSortMode.Programmatic });
        }

        private void GridCellFormatting(object sender, DataGridViewCellFormattingEventArgs args)
        {
            DataGridView grid = sender as DataGridView;
            if (grid == null || args.RowIndex < 0) return;
            TerminalRow row = grid.Rows[args.RowIndex].DataBoundItem as TerminalRow;
            if (row == null) return;
            string column = grid.Columns[args.ColumnIndex].Name;
            if (column == "Online") { args.Value = row.Online ? "● 在线" : "○ 离线"; args.CellStyle.ForeColor = row.Online ? Theme.Accent : Theme.Muted; args.FormattingApplied = true; }
            else if (column == "TerminalName") { args.Value = row.TerminalName + (String.IsNullOrEmpty(row.MachineName) ? "" : "\n" + row.MachineName); args.FormattingApplied = true; }
            else if (column == "LastSeenAt") {
                DateTimeOffset timestamp;
                if (DateTimeOffset.TryParse(row.LastSeenAt, out timestamp)) {
                    double seconds = Math.Max(0, (DateTimeOffset.UtcNow - timestamp).TotalSeconds);
                    args.Value = seconds < 60 ? Math.Max(1, (int)seconds) + " 秒前" : seconds < 3600 ? (int)(seconds / 60) + " 分钟前" : timestamp.ToLocalTime().ToString("MM-dd HH:mm");
                } else args.Value = String.IsNullOrEmpty(row.LastSeenAt) ? "未上报" : row.LastSeenAt;
                args.FormattingApplied = true;
            }
            else if (column == "CommandLabel") {
                string value = row.CommandLabel ?? "";
                args.CellStyle.ForeColor = value.Contains("失败") || value.Contains("拒绝") ? Theme.Danger : value.Contains("执行中") || value.Contains("待领取") ? Theme.Warning : value.Contains("完成") ? Theme.Accent : Theme.Muted;
            }
        }

        private Panel CreateCard(Padding marginPadding)
        {
            return new Panel { Dock = DockStyle.Fill, BackColor = Theme.Surface, Margin = marginPadding };
        }

        private Button CreateNavigationButton(string text, int top)
        {
            Button button = new ThemeButton { FlatStyle = FlatStyle.Flat, FlatAppearance = { BorderSize = 0 }, BackColor = Theme.Sidebar, ForeColor = Theme.Muted, Location = new Point(14, top), Size = new Size(192, 44), Text = "  " + text, TextAlign = ContentAlignment.MiddleLeft, Cursor = Cursors.Hand };
            return button;
        }

        private Button CreateButton(string text, Color background, Color foreground, int width)
        {
            Font font = new Font(Font.FontFamily, 9F, FontStyle.Bold);
            width = Math.Max(width, TextRenderer.MeasureText(text, font).Width + 32);
            Button button = new ThemeButton { Text = text, Size = new Size(width, 40), Margin = new Padding(0, 0, 10, 0), FlatStyle = FlatStyle.Flat, BackColor = background, ForeColor = foreground, Cursor = Cursors.Hand, Font = font, UseVisualStyleBackColor = false };
            button.FlatAppearance.BorderColor = background == Theme.AccentStrong ? Theme.AccentStrong : Theme.BorderStrong;
            button.FlatAppearance.BorderSize = 1;
            return button;
        }

        private Panel BuildAboutPage()
        {
            Panel page = new Panel { Dock = DockStyle.Fill, BackColor = Theme.Background, Visible = false };
            Panel header = new Panel { Dock = DockStyle.Top, Height = 144, BackColor = Theme.Surface };
            string mode = MESDesktopSettings.IsNative ? "Windows 原生服务" : MESDesktopSettings.IsDocker ? "Docker 容器" : "本机开发服务";
            Label title = new Label { AutoSize = true, Text = "MES 控制中心  v2.10.0", ForeColor = Theme.Text, Font = new Font(Font, FontStyle.Bold), Location = new Point(18, 16) };
            Label deployment = new Label { AutoSize = true, Text = "部署方式：" + mode + "    ·    Web、API、LIMS 与上位机服务管理", ForeColor = Theme.Muted, Location = new Point(18, 43) };
            Label local = new Label { AutoSize = true, Text = "本机访问", ForeColor = Theme.Muted, Location = new Point(18, 78) };
            aboutLocalUrl = new TextBox { ReadOnly = true, BorderStyle = BorderStyle.FixedSingle, BackColor = Theme.SurfaceStrong, ForeColor = Theme.Accent, Location = new Point(90, 74), Size = new Size(320, 28), Font = new Font("Consolas", 10F), AccessibleName = "MES 本机访问地址" };
            aboutBinding = new Label { AutoSize = false, Anchor = AnchorStyles.Left | AnchorStyles.Right | AnchorStyles.Top, Location = new Point(18, 111), Size = new Size(900, 25), ForeColor = Theme.Muted, Text = "点击刷新读取当前监听状态" };
            header.Controls.AddRange(new Control[] { title, deployment, local, aboutLocalUrl, aboutBinding });
            header.Resize += delegate { aboutBinding.Width = header.ClientSize.Width - 36; };

            Panel bottom = new Panel { Dock = DockStyle.Bottom, Height = 174, BackColor = Theme.Surface };
            aboutGuidance = new Label { AutoSize = false, Location = new Point(18, 14), Size = new Size(900, 86), ForeColor = Theme.Muted, Text = "请在 MES 主机运行本程序。局域网地址不使用容器 IP 或 127.0.0.1。" };
            aboutRefreshButton = CreateButton("刷新地址", Theme.AccentSoft, Theme.Accent, 112);
            aboutCopyButton = CreateButton("复制选中地址", Theme.AccentStrong, Theme.OnAccent, 140);
            aboutOpenButton = CreateButton("打开界面", Theme.SurfaceStrong, Theme.Text, 126);
            aboutRefreshButton.Location = new Point(18, 114);
            aboutCopyButton.Location = new Point(142, 114);
            aboutOpenButton.Location = new Point(294, 114);
            aboutRefreshButton.Click += async delegate { await RefreshAboutInfo(); };
            aboutCopyButton.Click += delegate { UseSelectedAddress(false); };
            aboutOpenButton.Click += delegate { UseSelectedAddress(true); };
            bottom.Controls.AddRange(new Control[] { aboutGuidance, aboutRefreshButton, aboutCopyButton, aboutOpenButton });
            bottom.Resize += delegate { aboutGuidance.Width = bottom.ClientSize.Width - 36; };

            Panel addressCard = new Panel { Dock = DockStyle.Fill, BackColor = Theme.Surface, Padding = new Padding(0, 12, 0, 12) };
            Label caption = new Label { Dock = DockStyle.Top, Height = 34, Padding = new Padding(18, 4, 0, 0), Text = "主机局域网地址 · 有线 / Wi-Fi", ForeColor = Theme.Text, Font = new Font(Font, FontStyle.Bold) };
            aboutGrid = CreateTerminalGrid(false);
            aboutGrid.Columns.Clear();
            AddColumn(aboutGrid, "网卡", "Adapter", 140);
            AddColumn(aboutGrid, "主机 IPv4", "Address", 150);
            AddColumn(aboutGrid, "MES 地址", "Url", 310);
            AddColumn(aboutGrid, "访问状态", "Status", 280);
            aboutGrid.Columns["Status"].AutoSizeMode = DataGridViewAutoSizeColumnMode.Fill;
            aboutGrid.Columns["Status"].MinimumWidth = 240;
            aboutGrid.SelectionChanged += delegate { UpdateAboutActions(); };
            addressCard.Controls.Add(aboutGrid);
            addressCard.Controls.Add(caption);
            page.Controls.Add(addressCard);
            page.Controls.Add(bottom);
            page.Controls.Add(header);
            UpdateAboutActions();
            return page;
        }

        private void ShowAboutPage()
        {
            HideConfigurationPage();
            dashboardPage.Visible = false;
            terminalPage.Visible = false;
            aboutPage.Visible = true;
            aboutPage.BringToFront();
            dashboardNav.BackColor = terminalNav.BackColor = Theme.Sidebar;
            dashboardNav.ForeColor = terminalNav.ForeColor = Theme.Muted;
            aboutNav.BackColor = Theme.AccentSoft;
            aboutNav.ForeColor = Theme.Accent;
            pageTitle.Text = "关于与访问地址";
            pageDescription.Text = "版本、Web 监听状态及工作站访问地址";
        }

        private async Task RefreshAboutInfo()
        {
            if (aboutBusy) return;
            aboutBusy = true;
            aboutRefreshButton.Enabled = false;
            aboutBinding.Text = "正在读取 Web 监听与主机网卡……";
            try
            {
                MesAccessReport report = await Task.Run(delegate
                {
                    Dictionary<string, object> info = null;
                    string error = "";
                    if (MESDesktopSettings.IsDocker)
                    {
                        try
                        {
                            info = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(RunControl("NetworkInfo"));
                            if (info.ContainsKey("status") && Convert.ToString(info["status"]) == "error")
                                error = Convert.ToString(info["message"]);
                        }
                        catch (Exception exception) { error = exception.Message; }
                    }
                    MesAccessReport result = MESAccessInfo.Build(MESDesktopSettings.ServerUrl("http://127.0.0.1:5173"),
                        MESDesktopSettings.IsDocker, info, MESAccessInfo.Interfaces(),
                        delegate(string url) { return TestJsonServiceReady(url + "/api/system/discovery", "service", MESServerDiscovery.ServiceMarker, false); });
                    if (error.Length > 0) result.Guidance = "无法核对 Docker 监听，以下地址仅为候选。" + error;
                    return result;
                });
                if (!IsDisposed) ApplyAboutReport(report);
            }
            catch (Exception exception) { if (!IsDisposed) aboutBinding.Text = "读取地址失败：" + exception.Message; }
            finally
            {
                aboutBusy = false;
                if (!IsDisposed) aboutRefreshButton.Enabled = true;
            }
        }

        private void ApplyAboutReport(MesAccessReport report)
        {
            aboutLoaded = true;
            aboutLocalUrl.Text = report.LocalUrl;
            aboutBinding.Text = report.BindingSummary;
            aboutGuidance.Text = report.Guidance;
            aboutGrid.DataSource = report.Rows;
            MesAccessRow primary = report.Rows.Find(delegate(MesAccessRow row) { return row.Verified; });
            if (primary == null && report.Rows.Count > 0) primary = report.Rows[0];
            selectedLanUrl = primary != null ? primary.Url : "";
            lanAddressLink.Text = primary != null ? primary.Url : "未检测到有线 / Wi-Fi 地址";
            lanAddressStatus.Text = primary != null ? primary.Status : "连接局域网后按 F5 刷新";
            lanAddressStatus.ForeColor = primary != null && primary.Verified ? Theme.Accent : Theme.Warning;
            UpdateAboutActions();
        }

        private MesAccessRow SelectedAddress()
        {
            return aboutGrid.SelectedRows.Count > 0 ? aboutGrid.SelectedRows[0].DataBoundItem as MesAccessRow : null;
        }

        private void UpdateAboutActions()
        {
            if (aboutCopyButton == null || aboutOpenButton == null || aboutGrid == null) return;
            MesAccessRow row = SelectedAddress();
            aboutCopyButton.Enabled = row != null;
            aboutCopyButton.Text = row != null && !row.Verified ? "复制候选地址" : "复制选中地址";
            aboutOpenButton.Enabled = row != null && row.Verified;
        }

        private void UseSelectedAddress(bool open)
        {
            MesAccessRow row = SelectedAddress();
            if (row == null || (open && !row.Verified)) return;
            try
            {
                if (open) browserSession.Open(new[] { row.Url });
                else Clipboard.SetText(row.Url);
                footerStatusLabel.Text = (open ? "已打开：" : "已复制：") + row.Url
                    + (row.Verified ? "；请从另一台工作站验证访问" : "；此候选地址尚未开放或验证");
            }
            catch (Exception exception) { ShowModal("地址操作失败", exception.Message, false, null, true); }
        }

        private void OpenCentralPage()
        {
            // Reopen only the interface. Do not run a Start/Restart service action.
            browserSession.Open(new[] { MESAccessInfo.InitialServerUrl().TrimEnd('/') + "/" });
        }

        private async Task OpenCentralManagement()
        {
            if (integrityPage != null && integrityPage.Repairing) { footerStatusLabel.Text="正在补全组件，请完成后打开界面。"; return; }
            if (serviceBusy || openCentralBusy) return;
            openCentralBusy = true;
            openCentralButton.Enabled = false;
            try
            {
                await Task.Run(delegate { OpenCentralPage(); });
                if (!IsDisposed) footerStatusLabel.Text = "已打开或唤起中控管理，后台服务保持运行。";
            }
            catch (Exception error)
            {
                if (!IsDisposed) ShowModal("打开中控管理失败", error.Message, false, null, true);
            }
            finally
            {
                openCentralBusy = false;
                if (!IsDisposed) openCentralButton.Enabled = !serviceBusy;
            }
        }

        private void ShowPage(bool dashboard)
        {
            HideConfigurationPage();
            aboutPage.Visible = false;
            aboutNav.BackColor = Theme.Sidebar;
            aboutNav.ForeColor = Theme.Muted;
            dashboardPage.Visible = dashboard;
            terminalPage.Visible = !dashboard;
            dashboardPage.BringToFront();
            if (!dashboard) terminalPage.BringToFront();
            dashboardNav.BackColor = dashboard ? Theme.AccentSoft : Theme.Sidebar;
            dashboardNav.ForeColor = dashboard ? Theme.Accent : Theme.Muted;
            terminalNav.BackColor = dashboard ? Theme.Sidebar : Theme.AccentSoft;
            terminalNav.ForeColor = dashboard ? Theme.Muted : Theme.Accent;
            pageTitle.Text = dashboard ? "控制台总览" : "终端管理";
            pageDescription.Text = dashboard ? "服务状态、快捷控制与终端概况" : "固定工作台状态、权限与远程命令";
        }

        private async void RefreshAll()
        {
            if (serviceBusy) return;
            if (integrityPage.Visible) { await integrityPage.CheckAsync(false); return; }
            if (configurationPage.Visible) { configurationPage.Reload(true); return; }
            if (aboutPage.Visible) { await RefreshAboutInfo(); return; }
            await RefreshServiceStatus(true);
            await RefreshAboutInfo();
            if (terminalConnected) await RefreshTerminals(true);
            else await ConnectAndRefresh(false);
        }

        private void HideConfigurationPage()
        {
            if (integrityPage != null) { integrityPage.Visible=false; integrityNav.BackColor=Theme.Sidebar; integrityNav.ForeColor=Theme.Muted; }
            configurationPage.Visible = false;
            configurationNav.BackColor = Theme.Sidebar;
            configurationNav.ForeColor = Theme.Muted;
        }

        private void ShowConfigurationPage()
        {
            if (integrityPage != null) { integrityPage.Visible=false; integrityNav.BackColor=Theme.Sidebar; integrityNav.ForeColor=Theme.Muted; }
            dashboardPage.Visible = terminalPage.Visible = aboutPage.Visible = false;
            dashboardNav.BackColor = terminalNav.BackColor = aboutNav.BackColor = Theme.Sidebar;
            dashboardNav.ForeColor = terminalNav.ForeColor = aboutNav.ForeColor = Theme.Muted;
            configurationNav.BackColor = Theme.AccentSoft;
            configurationNav.ForeColor = Theme.Accent;
            configurationPage.Visible = true;
            configurationPage.BringToFront();
            configurationPage.EnsureLoaded();
            pageTitle.Text = "系统配置";
            pageDescription.Text = "重要连接参数 · 读取实际配置文件，保存后重启生效";
        }

        private void ShowIntegrityPage()
        {
            HideConfigurationPage();
            dashboardPage.Visible=terminalPage.Visible=aboutPage.Visible=false;
            dashboardNav.BackColor=terminalNav.BackColor=aboutNav.BackColor=Theme.Sidebar;
            dashboardNav.ForeColor=terminalNav.ForeColor=aboutNav.ForeColor=Theme.Muted;
            integrityNav.BackColor=Theme.AccentSoft; integrityNav.ForeColor=Theme.Accent;
            integrityPage.Visible=true; integrityPage.BringToFront();
            pageTitle.Text="系统完整性"; pageDescription.Text="检测运行组件 · 勾选补全 · 保留原配置与绑定";
        }

        private async Task RefreshServiceStatus(bool showErrors)
        {
            if (serviceStatusBusy) return;
            if (serviceBusy) return;
            serviceStatusBusy = true;
            int generation = serviceGeneration;
            serviceStateLabel.Text = "正在检测";
            serviceStateLabel.ForeColor = Theme.Muted;
            try
            {
                Task<bool> backendTask = Task.Run(delegate { return TestJsonServiceReady(MESDesktopSettings.Get("apiUrl", "http://127.0.0.1:8000") + "/health/ready", "status", "ready", false); });
                Task<bool> frontendTask = Task.Run(delegate { return TestHttpReady(MESDesktopSettings.ServerUrl("http://127.0.0.1:5173") + "/"); });
                Task<bool> limsTask = Task.Run(delegate { return !MESDesktopSettings.SimulatorsEnabled || TestJsonServiceReady(MESDesktopSettings.Get("limsUrl", "http://127.0.0.1:8900") + "/api/state", "connected", "true", false); });
                Task<bool> upperComputerTask = Task.Run(delegate { return !MESDesktopSettings.SimulatorsEnabled || TestJsonServiceReady(MESDesktopSettings.Get("upperComputerUrl", "http://127.0.0.1:8899") + "/api/state", "connected", "true", true); });
                await Task.WhenAll(backendTask, frontendTask, limsTask, upperComputerTask);
                if (IsDisposed || generation != serviceGeneration) return;

                ServiceHealthSnapshot health = new ServiceHealthSnapshot
                {
                    Backend = backendTask.Result,
                    Frontend = frontendTask.Result,
                    Lims = limsTask.Result,
                    UpperComputer = upperComputerTask.Result
                };
                ApplyServiceIndicator(serviceBackendIndicator, health.Backend);
                ApplyServiceIndicator(serviceFrontendIndicator, health.Frontend);
                ApplyServiceIndicator(serviceLimsIndicator, health.Lims);
                ApplyServiceIndicator(serviceUpperComputerIndicator, health.UpperComputer);
                if (!MESDesktopSettings.SimulatorsEnabled)
                {
                    serviceLimsIndicator.Status.Text = "未启用";
                    serviceUpperComputerIndicator.Status.Text = "未启用";
                }
                bool wasRunning = systemRunning;
                systemRunning = health.HealthyCount == 4;

                if (systemRunning)
                {
                    systemStatusLabel.Text = "运行中 · 服务已就绪";
                    systemStatusLabel.ForeColor = Theme.Accent;
                    serviceStateLabel.Text = "全部正常";
                    serviceStateLabel.ForeColor = Theme.Accent;
                    footerStatusLabel.Text = "后端、前端、LIMS 模拟器及上位机服务均已就绪";
                }
                else if (health.HealthyCount == 0)
                {
                    systemStatusLabel.Text = "未运行 · 可启动";
                    systemStatusLabel.ForeColor = Theme.Muted;
                    serviceStateLabel.Text = "服务未启动";
                    serviceStateLabel.ForeColor = Theme.Danger;
                    footerStatusLabel.Text = "未检测到已就绪的 MES 服务";
                }
                else
                {
                    List<string> unavailable = new List<string>();
                    if (!health.Backend) unavailable.Add("后端");
                    if (!health.Frontend) unavailable.Add("前端");
                    if (!health.Lims) unavailable.Add("LIMS 模拟器");
                    if (!health.UpperComputer) unavailable.Add("上位机");
                    systemStatusLabel.Text = "部分运行 · 请检查服务";
                    systemStatusLabel.ForeColor = Theme.Warning;
                    serviceStateLabel.Text = "部分服务异常";
                    serviceStateLabel.ForeColor = Theme.Warning;
                    footerStatusLabel.Text = "未就绪服务：" + String.Join("、", unavailable.ToArray());
                }
                UpdateServiceActionState();
                if (wasRunning != systemRunning) await RefreshAboutInfo();
            }
            catch (Exception exception)
            {
                systemRunning = false;
                systemStatusLabel.Text = "状态读取失败";
                serviceStateLabel.Text = "无法检测";
                ApplyServiceIndicator(serviceBackendIndicator, false);
                ApplyServiceIndicator(serviceFrontendIndicator, false);
                ApplyServiceIndicator(serviceLimsIndicator, false);
                ApplyServiceIndicator(serviceUpperComputerIndicator, false);
                footerStatusLabel.Text = "服务状态读取失败：" + exception.Message;
                if (showErrors) ShowModal("状态读取失败", exception.Message, false, null, true);
            }
            finally
            {
                serviceStatusBusy = false;
                UpdateServiceActionState();
            }
        }

        private static void ApplyServiceIndicator(ServiceIndicator indicator, bool ready)
        {
            if (indicator == null) return;
            indicator.Dot.BackColor = ready ? Theme.Accent : Theme.Danger;
            indicator.Status.ForeColor = ready ? Theme.Accent : Theme.Danger;
            indicator.Status.Text = ready ? "运行" : "未运行";
        }

        private static bool TestHttpReady(string url)
        {
            try
            {
                HttpWebRequest request = (HttpWebRequest)WebRequest.Create(url);
                request.Method = "GET";
                request.Timeout = 2000;
                request.ReadWriteTimeout = 2000;
                request.Proxy = null;
                using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
                {
                    int statusCode = (int)response.StatusCode;
                    return statusCode >= 200 && statusCode < 300;
                }
            }
            catch { return false; }
        }

        private static bool TestJsonServiceReady(string url, string property, string expected, bool requireAutoMode)
        {
            try
            {
                HttpWebRequest request = (HttpWebRequest)WebRequest.Create(url);
                request.Method = "GET";
                request.Timeout = 2000;
                request.ReadWriteTimeout = 2000;
                request.Proxy = null;
                using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
                using (StreamReader reader = new StreamReader(response.GetResponseStream()))
                {
                    int statusCode = (int)response.StatusCode;
                    if (statusCode < 200 || statusCode >= 300) return false;
                    object rootObject = new JavaScriptSerializer().DeserializeObject(reader.ReadToEnd());
                    Dictionary<string, object> root = rootObject as Dictionary<string, object>;
                    if (root == null || !root.ContainsKey(property)) return false;
                    bool propertyReady = String.Equals(Convert.ToString(root[property]), expected, StringComparison.OrdinalIgnoreCase);
                    if (!propertyReady || !requireAutoMode) return propertyReady;
                    Dictionary<string, object> config = root.ContainsKey("config") ? root["config"] as Dictionary<string, object> : null;
                    if (config == null) return false;
                    object autoMode;
                    if (!config.TryGetValue("auto_mode", out autoMode) && !config.TryGetValue("autoMode", out autoMode)) return false;
                    return String.Equals(Convert.ToString(autoMode), "true", StringComparison.OrdinalIgnoreCase);
                }
            }
            catch { return false; }
        }

        private void RequestServiceAction(string action)
        {
            if (integrityPage != null && integrityPage.Repairing) { footerStatusLabel.Text="正在补全组件，请完成后操作服务。"; return; }
            if (serviceBusy || modalOverlay.Visible) return;
            if (action == "Start" && systemRunning) return;
            if (action == "Stop")
            {
                ShowModal("确认关闭 MES 系统", (MESDesktopSettings.IsNative
                    ? "关闭操作将停止本机 MES 原生服务，并保留数据库、报告和模拟器数据。是否继续？" : MESDesktopSettings.IsDocker
                    ? "关闭操作将停止当前 Docker 部署的全部服务，并保留业务数据卷。是否继续？"
                    : "关闭操作将终止后端、前端、LIMS 模拟器、上位机服务及其专属窗口。")
                    + "同时关闭由控制中心打开的 MES、LIMS 与上位机模拟器浏览器窗口。是否继续？", true, delegate { ExecuteServiceAction(action); }, false);
            }
            else if (action == "Restart")
            {
                ShowModal("确认重启 MES 系统", "重启会短暂中断当前页面与终端管理连接。是否继续？", true, delegate { ExecuteServiceAction(action); }, false);
            }
            else ExecuteServiceAction(action);
        }

        private async void ExecuteServiceAction(string action)
        {
            await RunServiceOperation(action);
        }

        private void HandleControllerClosing(object sender, FormClosingEventArgs args)
        {
            if (exitAllowed) return;
            args.Cancel = true;
            if (serviceBusy || openCentralBusy || exitRequested || (integrityPage != null && integrityPage.Repairing))
            {
                footerStatusLabel.Text = "正在执行界面或服务操作，请完成后再关闭控制中心。";
                return;
            }
            if (modalOverlay.Visible) return;
            ShowModal("关闭系统并退出控制中心",
                "将停止 MES 后端、前端及模拟器服务，并关闭相关界面。\n数据库、报告和业务文件会保留。确认后，系统关闭成功才会退出控制中心。"
                + (configurationPage.Dirty ? "\n系统配置中尚未保存的修改将丢弃。" : ""),
                true, async delegate { await CloseSystemAndExit(); }, false);
            modalConfirmButton.Text = "关闭并退出";
            AcceptButton = modalCancelButton;
            CancelButton = modalCancelButton;
            modalCancelButton.Focus();
        }

        private async Task CloseSystemAndExit()
        {
            if (exitRequested || serviceBusy || openCentralBusy) return;
            exitRequested = true;
            bool stopped = await RunServiceOperation("Stop");
            if (IsDisposed) return;
            if (stopped)
            {
                exitAllowed = true;
                Close();
            }
            else
            {
                exitRequested = false;
                if (automaticRefresh) serviceStatusTimer.Start();
                if (automaticRefresh && terminalConnected) refreshTimer.Start();
                footerStatusLabel.Text = "系统关闭未完成，控制中心已保留，请查看错误后重试。";
            }
        }

        internal bool CloseForMaintenance()
        {
            if (serviceBusy || openCentralBusy || (integrityPage != null && integrityPage.Repairing)) return false;
            // Only the explicit local maintenance command takes this route.
            // The uninstaller owns service shutdown; regular window close keeps its confirmation.
            exitAllowed=true; Hide(); Close(); return true;
        }

        private async Task<bool> RunServiceOperation(string action)
        {
            if (serviceBusy) return false;
            bool successful = false;
            serviceBusy = true;
            serviceGeneration++;
            int generation = serviceGeneration;
            refreshTimer.Stop();
            serviceStatusTimer.Stop();
            SetServiceButtonsEnabled(false);
            footerStatusLabel.Text = "正在" + ActionLabel(action) + " MES 系统，请稍候……";
            BeginServiceProgress(action);
            try
            {
                string result = await Task.Run(delegate { return RunControl(action); });
                if (IsDisposed) return false;
                string status = ReadResultValue(result, "status");
                string message = ReadResultValue(result, "message");
                bool serviceSucceeded = ServiceActionSucceeded(action, status);
                bool success = serviceSucceeded;
                Dictionary<string, object> operationResult = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(result);
                object interfaceResult;
                if (operationResult.TryGetValue("interfaceOperationSucceeded", out interfaceResult)
                    && interfaceResult is bool && !(bool)interfaceResult) success = false;
                successful = success;
                if (serviceSucceeded)
                {
                    systemRunning = action != "Stop" && status != "stopped" && status != "not_running";
                    if (!systemRunning)
                    {
                        terminalConnected = false;
                        UpdateTerminalActionState();
                    }
                }
                if (success) await CompleteServiceProgress(); else HideServiceProgress();
                if (IsDisposed) return false;
                footerStatusLabel.Text = message;
                if (!success) ShowModal("操作失败", message, false, null, true);
            }
            catch (Exception exception)
            {
                if (!IsDisposed)
                {
                    HideServiceProgress();
                    footerStatusLabel.Text = "操作失败：" + exception.Message;
                    ShowModal("操作失败", exception.Message, false, null, true);
                }
            }
            finally
            {
                serviceBusy = false;
                if (!IsDisposed)
                {
                    HideServiceProgress();
                    UpdateServiceActionState();
                    ResetWaitCursor();
                    if (automaticRefresh && !exitRequested) serviceStatusTimer.Start();
                    if (automaticRefresh && !exitRequested && terminalConnected) refreshTimer.Start();
                }
            }
            // Release action buttons before optional network/terminal refreshes.
            if (automaticRefresh && !exitRequested && !IsDisposed && generation == serviceGeneration)
            {
                await RefreshServiceStatus(false);
                if (IsDisposed || generation != serviceGeneration) return successful;
                await RefreshAboutInfo();
                if (!IsDisposed && generation == serviceGeneration && action != "Stop") await ConnectAndRefresh(false);
            }
            return successful;
        }

        private static string ActionLabel(string action)
        {
            return action == "Start" ? "启动" : action == "Restart" ? "重启" : "关闭";
        }

        private static bool ServiceActionSucceeded(string action, string status)
        {
            return status == "success" || (action == "Stop"
                ? status == "stopped" || status == "not_running"
                : status == "started" || status == "restarted" || status == "already_running");
        }

        private void SetServiceButtonsEnabled(bool enabled)
        {
            if (openCentralButton != null) openCentralButton.Enabled = enabled && !openCentralBusy;
            foreach (Button button in serviceButtons) button.Enabled = enabled;
            if (startServiceButton != null) ApplyStartButtonVisual(startServiceButton.Enabled);
        }

        private void UpdateServiceActionState()
        {
            bool enabled = !serviceBusy;
            if (openCentralButton != null) openCentralButton.Enabled = enabled && !openCentralBusy;
            foreach (Button button in serviceButtons) button.Enabled = enabled;
            if (startServiceButton == null) return;
            startServiceButton.Enabled = CanStartSystem(systemRunning, serviceBusy);
            ApplyStartButtonVisual(startServiceButton.Enabled);
        }

        private static bool CanStartSystem(bool running, bool busy)
        {
            return !running && !busy;
        }

        private void ApplyStartButtonVisual(bool enabled)
        {
            if (startServiceButton == null) return;
            startServiceButton.BackColor = enabled ? Theme.AccentStrong : Theme.SurfaceStrong;
            startServiceButton.ForeColor = enabled ? Theme.OnAccent : Theme.DisabledText;
            startServiceButton.FlatAppearance.BorderColor = enabled ? Theme.AccentStrong : Theme.Border;
            startServiceButton.Cursor = enabled ? Cursors.Hand : Cursors.Default;
            startServiceButton.Text = systemRunning ? "系统已运行" : "启动系统";
        }

        private async Task ConnectAndRefresh(bool showErrors)
        {
            if (terminalBusy) return;
            SetTerminalBusy(true, "正在连接 MES 终端服务……");
            try
            {
                string server = serverText.Text;
                string user = usernameText.Text;
                string password = passwordText.Text;
                await Task.Run(delegate
                {
                    terminalClient.Configure(server);
                    terminalClient.Login(user, password);
                });
                terminalConnected = true;
                connectionSummary.Text = "已连接 · " + user + " · " + server;
                connectionSummary.ForeColor = Theme.Accent;
                SetConnectionExpanded(false);
                refreshTimer.Start();
                await LoadRows();
                footerStatusLabel.Text = "终端管理已连接；状态每 5 秒自动刷新";
            }
            catch (Exception exception)
            {
                terminalConnected = false;
                connectionSummary.Text = "连接失败 · 请检查地址与管理员账号";
                connectionSummary.ForeColor = Theme.Danger;
                SetConnectionExpanded(true);
                refreshTimer.Stop();
                footerStatusLabel.Text = "终端连接失败：" + exception.Message;
                dashboardGrid.Tag = terminalGrid.Tag = "终端连接失败，请检查地址与管理员账号后重新连接。";
                dashboardGrid.Invalidate(); terminalGrid.Invalidate();
                if (showErrors) ShowModal("终端连接失败", exception.Message, false, null, true);
            }
            finally
            {
                SetTerminalBusy(false, footerStatusLabel.Text);
            }
        }

        private async Task RefreshTerminals(bool showErrors)
        {
            if (!terminalConnected || terminalBusy) return;
            SetTerminalBusy(true, "正在刷新终端状态……");
            try
            {
                await LoadRows();
                footerStatusLabel.Text = "终端状态已刷新：" + DateTime.Now.ToString("HH:mm:ss");
            }
            catch (Exception exception)
            {
                footerStatusLabel.Text = "终端状态刷新失败：" + exception.Message;
                dashboardGrid.Tag = terminalGrid.Tag = "终端状态读取失败，按 F5 重试。";
                dashboardGrid.Invalidate(); terminalGrid.Invalidate();
                if (showErrors) ShowModal("刷新失败", exception.Message, false, null, true);
            }
            finally
            {
                SetTerminalBusy(false, footerStatusLabel.Text);
            }
        }

        private async Task LoadRows()
        {
            List<TerminalRow> loaded = await Task.Run(delegate { return terminalClient.ListTerminals(); });
            rows = loaded;
            dashboardGrid.Tag = terminalGrid.Tag = null;
            BindGrid(dashboardGrid);
            BindGrid(terminalGrid);
            int online = rows.FindAll(delegate(TerminalRow row) { return row.Online; }).Count;
            int pending = rows.FindAll(delegate(TerminalRow row) { return row.CommandLabel != null && (row.CommandLabel.Contains("待领取") || row.CommandLabel.Contains("执行中")); }).Count;
            int offline = rows.Count - online;
            onlineMetricLabel.Text = online.ToString();
            commandMetricLabel.Text = pending.ToString();
            offlineMetricLabel.Text = offline.ToString();
            terminalSummaryLabel.Text = "在线 " + online + " / 共 " + rows.Count + " 台";
            UpdateTerminalActionState();
            if (enrollmentPanel != null) await enrollmentPanel.RefreshRequests();
        }

        private void BindGrid(DataGridView grid)
        {
            TerminalRow previous = grid.CurrentRow == null ? null : grid.CurrentRow.DataBoundItem as TerminalRow;
            string selectedId = previous == null ? "" : previous.TerminalId;
            int first = grid.FirstDisplayedScrollingRowIndex;
            TerminalRow top = first >= 0 ? grid.Rows[first].DataBoundItem as TerminalRow : null;
            string topId = top == null ? "" : top.TerminalId;
            List<TerminalRow> visible = new List<TerminalRow>(rows);
            if (grid == terminalGrid) {
                string query = terminalSearch.Text.Trim();
                visible = visible.FindAll(delegate(TerminalRow row) {
                    return (terminalFilter.SelectedIndex != 1 || row.Online) && (terminalFilter.SelectedIndex != 2 || !row.Online)
                        && (query.Length == 0 || ((row.TerminalName ?? "") + " " + row.MachineName + " " + row.IpAddress + " " + row.CurrentPage).IndexOf(query, StringComparison.OrdinalIgnoreCase) >= 0);
                });
                PropertyInfo property = typeof(TerminalRow).GetProperty(terminalSort);
                visible.Sort(delegate(TerminalRow left, TerminalRow right) {
                    int result = StringComparer.CurrentCultureIgnoreCase.Compare(Convert.ToString(property.GetValue(left, null)), Convert.ToString(property.GetValue(right, null)));
                    return terminalSortDescending ? -result : result;
                });
                terminalCountLabel.Text = "在线 " + rows.FindAll(delegate(TerminalRow row) { return row.Online; }).Count + " / 共 " + rows.Count + " 台";
                if (visible.Count != rows.Count) terminalCountLabel.Text += " · 筛选 " + visible.Count;
            }
            bindingTerminals = true;
            try {
                grid.DataSource = null; grid.DataSource = visible;
                if (grid == terminalGrid) foreach (DataGridViewColumn column in grid.Columns) column.HeaderCell.SortGlyphDirection = column.Name == terminalSort ? (terminalSortDescending ? SortOrder.Descending : SortOrder.Ascending) : SortOrder.None;
                foreach (DataGridViewRow row in grid.Rows) {
                    TerminalRow item = row.DataBoundItem as TerminalRow;
                    if (item != null && item.TerminalId == selectedId) { grid.CurrentCell = row.Cells[0]; row.Selected = true; break; }
                }
                if (grid.Visible && grid.Rows.Count > 0 && first >= 0) {
                    int restore = visible.FindIndex(delegate(TerminalRow row) { return row.TerminalId == topId; });
                    grid.FirstDisplayedScrollingRowIndex = Math.Min(restore >= 0 ? restore : first, grid.Rows.Count - 1);
                }
            } finally { bindingTerminals = false; }
            grid.Invalidate();
            if (grid == terminalGrid) UpdateTerminalActionState();
        }

        private TerminalRow SelectedTerminal()
        {
            if (terminalGrid == null || terminalGrid.SelectedRows.Count == 0) return null;
            return terminalGrid.SelectedRows[0].DataBoundItem as TerminalRow;
        }

        private void UpdateTerminalActionState()
        {
            if (reloadButton == null || bindingTerminals) return;
            TerminalRow selected = SelectedTerminal();
            reloadButton.Enabled = !terminalBusy && terminalConnected && selected != null && selected.Online && selected.AllowReload;
            shutdownButton.Enabled = !terminalBusy && terminalConnected && selected != null && selected.Online && selected.AllowPower;
            restartTerminalButton.Enabled = shutdownButton.Enabled;
            bool anyPower = terminalConnected && rows.Exists(delegate(TerminalRow row) { return row.Online && row.AllowPower; });
            shutdownAllButton.Enabled = !terminalBusy && anyPower;
            restartAllButton.Enabled = !terminalBusy && anyPower;
            refreshButton.Enabled = !terminalBusy && terminalConnected;
            connectButton.Enabled = !terminalBusy;
            if (resetBindingButton != null) resetBindingButton.Enabled = deleteBindingButton.Enabled = !terminalBusy && terminalConnected && selected != null;
            if (cleanupBindingsButton != null) cleanupBindingsButton.Enabled = !terminalBusy && terminalConnected;
            if (moreTerminalButton != null) moreTerminalButton.Enabled = !terminalBusy && terminalConnected;
            if (terminalDetailButton != null) terminalDetailButton.Enabled = selected != null;
            if (selectedTerminalLabel != null) selectedTerminalLabel.Text = selected == null ? "请选择终端" : "已选：" + selected.TerminalName + " · " + (selected.Online ? "在线" : "离线") + (!terminalConnected ? " · 服务未连接" : "");
            if (terminalDetailText != null) terminalDetailText.Text = selected == null ? "请选择终端查看详情。" : "终端：" + selected.TerminalName + "\r\n主机：" + selected.MachineName + "    IP：" + selected.IpAddress + "\r\n标识：" + selected.TerminalId + "\r\n页面路径：" + selected.CurrentPath + "\r\n最后心跳：" + selected.LastSeenAt + "\r\n权限：" + selected.PermissionLabel + "\r\n最近命令：" + selected.CommandLabel;
        }

        private void RequestBindingAction(bool delete)
        {
            TerminalRow selected = SelectedTerminal();
            if (selected == null || terminalBusy || !terminalConnected) return;
            string label = delete ? "删除终端" : "重置绑定";
            ShowModal("确认" + label, "终端：" + selected.TerminalName + "\n旧工位凭据及登录会话将失效，需要重新申请并经管理员批准。任务、样品和报告保留。", true, async delegate {
                SetTerminalBusy(true, "正在" + label + "……");
                try { await Task.Run(delegate { terminalClient.EnrollmentAction("terminals/" + Uri.EscapeDataString(selected.TerminalId) + (delete ? "" : "/reset"), null, delete); }); await LoadRows(); }
                catch (Exception error) { ShowModal(label + "失败", error.Message, false, null, true); }
                finally { SetTerminalBusy(false, label + "操作结束"); }
            }, false);
        }

        private async Task PreviewLegacyCleanup()
        {
            if (terminalBusy || !terminalConnected) return;
            try {
                List<Dictionary<string, object>> preview = await Task.Run(delegate { return terminalClient.EnrollmentItems("legacy-preview"); });
                if (preview.Count == 0) { ShowModal("清理历史终端", "没有符合条件的历史离线终端。", false, null, false); return; }
                List<string> identifiers = new List<string>();
                List<string> names = new List<string>();
                foreach (Dictionary<string, object> row in preview) { identifiers.Add(Convert.ToString(row["terminalId"])); names.Add(Convert.ToString(row["terminalName"])); }
                ShowModal("确认清理 " + preview.Count + " 个历史终端", String.Join("、", names.GetRange(0, Math.Min(3, names.Count))) + "\n仅清理未通过新流程接入且当前离线的终端。业务数据保留。", true, async delegate {
                    SetTerminalBusy(true, "正在清理历史终端……");
                    try { await Task.Run(delegate { terminalClient.EnrollmentAction("legacy-cleanup", new Dictionary<string, object> { { "terminalIds", identifiers.ToArray() } }); }); await LoadRows(); }
                    catch (Exception error) { ShowModal("清理失败", error.Message, false, null, true); }
                    finally { SetTerminalBusy(false, "历史终端清理结束"); }
                }, false);
            } catch (Exception error) { ShowModal("读取清理预览失败", error.Message, false, null, true); }
        }

        private void RequestSelectedTerminalCommand(string action, string label)
        {
            TerminalRow selected = SelectedTerminal();
            if (selected == null || terminalBusy) return;
            string target = selected.IpAddress.Length > 0 ? selected.IpAddress : selected.TerminalName;
            ShowModal("确认远程" + label, "确定要" + label + "终端 " + target + " 吗？", true, async delegate { await SendSelectedCommand(action, label); }, false);
        }

        private async Task SendSelectedCommand(string action, string label)
        {
            TerminalRow selected = SelectedTerminal();
            if (selected == null || terminalBusy) return;
            SetTerminalBusy(true, "正在下发" + label + "命令……");
            try
            {
                await Task.Run(delegate { terminalClient.QueueCommand(selected.TerminalId, action); });
                footerStatusLabel.Text = "已向 " + (selected.IpAddress.Length > 0 ? selected.IpAddress : selected.TerminalName) + " 下发" + label + "命令";
                await LoadRows();
            }
            catch (Exception exception)
            {
                footerStatusLabel.Text = "命令下发失败：" + exception.Message;
                ShowModal("命令下发失败", exception.Message, false, null, true);
            }
            finally
            {
                SetTerminalBusy(false, footerStatusLabel.Text);
            }
        }

        private void RequestBatchCommand(string action, string label)
        {
            if (terminalBusy) return;
            ShowModal("确认批量" + label, "确定要" + label + "所有在线且已授权的终端吗？未授权或离线终端不会收到命令。", true, async delegate { await SendBatchCommand(action, label); }, false);
        }

        private async Task SendBatchCommand(string action, string label)
        {
            if (terminalBusy) return;
            SetTerminalBusy(true, "正在批量下发命令……");
            try
            {
                int count = await Task.Run(delegate { return terminalClient.QueueBatch(action); });
                footerStatusLabel.Text = "已向 " + count + " 台终端下发" + label + "命令";
                await LoadRows();
            }
            catch (Exception exception)
            {
                footerStatusLabel.Text = "批量命令下发失败：" + exception.Message;
                ShowModal("批量命令下发失败", exception.Message, false, null, true);
            }
            finally
            {
                SetTerminalBusy(false, footerStatusLabel.Text);
            }
        }

        private void SetTerminalBusy(bool value, string message)
        {
            terminalBusy = value;
            if (value && rows.Count == 0) { dashboardGrid.Tag = terminalGrid.Tag = message; dashboardGrid.Invalidate(); terminalGrid.Invalidate(); }
            if (!String.IsNullOrWhiteSpace(message)) footerStatusLabel.Text = message;
            ResetWaitCursor();
            UpdateTerminalActionState();
        }

        private void ResetWaitCursor()
        {
            UseWaitCursor = false;
            Cursor = Cursors.Default;
            if (dashboardPage != null) dashboardPage.Cursor = Cursors.Default;
            if (dashboardGrid != null) dashboardGrid.Cursor = Cursors.Default;
            if (terminalPage != null) terminalPage.Cursor = Cursors.Default;
            if (terminalGrid != null) terminalGrid.Cursor = Cursors.Default;
        }

        private void BuildServiceProgress()
        {
            serviceProgressOverlay = new Panel { Bounds = ClientRectangle, Anchor = AnchorStyles.Top | AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right, BackColor = Theme.Background, Visible = false, AccessibleName = "MES 服务操作进度" };
            Panel border = new Panel { Size = new Size(560, 220), BackColor = Theme.BorderStrong };
            Panel card = new Panel { Location = new Point(1, 1), Size = new Size(558, 218), BackColor = Theme.Surface };
            serviceProgressTitle = new Label { Location = new Point(28, 25), Size = new Size(500, 34), ForeColor = Theme.Text, Font = new Font(Font.FontFamily, 15F, FontStyle.Bold) };
            Label note = new Label { Location = new Point(30, 67), Size = new Size(430, 26), ForeColor = Theme.Muted, Text = "预计进度 · 正在等待服务执行结果" };
            serviceProgressPercent = new Label { Location = new Point(442, 100), Size = new Size(84, 30), TextAlign = ContentAlignment.MiddleRight, ForeColor = Theme.Accent, Font = new Font("Segoe UI", 14F, FontStyle.Bold), Text = "0%" };
            serviceProgressBar = new ServiceProgressBar { Location = new Point(30, 139), Size = new Size(496, 18), AccessibleName = "预计完成进度" };
            Label finish = new Label { Location = new Point(30, 176), Size = new Size(496, 24), ForeColor = Theme.Subtle, Text = "实际完成后到达 100%，此窗口自动消失。" };
            card.Controls.AddRange(new Control[] { serviceProgressTitle, note, serviceProgressPercent, serviceProgressBar, finish });
            border.Controls.Add(card);
            serviceProgressOverlay.Controls.Add(border);
            serviceProgressOverlay.Resize += delegate
            {
                border.Left = (serviceProgressOverlay.ClientSize.Width - border.Width) / 2;
                border.Top = (serviceProgressOverlay.ClientSize.Height - border.Height) / 2;
            };
            Controls.Add(serviceProgressOverlay);
        }

        private void BeginServiceProgress(string action)
        {
            progressAction = action;
            serviceProgressTitle.Text = "正在" + ActionLabel(action) + " MES 系统";
            serviceProgressBar.Value = 0;
            serviceProgressPercent.Text = "0%";
            serviceProgressClock.Restart();
            serviceProgressOverlay.Bounds = ClientRectangle;
            serviceProgressOverlay.Visible = true;
            serviceProgressOverlay.BringToFront();
            Control card = serviceProgressOverlay.Controls[0];
            card.Left = (serviceProgressOverlay.ClientSize.Width - card.Width) / 2;
            card.Top = (serviceProgressOverlay.ClientSize.Height - card.Height) / 2;
            serviceProgressTimer.Start();
        }

        private static int EstimatedProgress(string action, double elapsedSeconds)
        {
            double expected = action == "Stop" ? 5 : action == "Start" ? 20 : 25;
            return Math.Min(95, 5 + (int)Math.Round(90 * (1 - Math.Exp(-3 * Math.Max(0, elapsedSeconds) / expected))));
        }

        private void UpdateServiceProgress()
        {
            int value = EstimatedProgress(progressAction, serviceProgressClock.Elapsed.TotalSeconds);
            serviceProgressBar.Value = value;
            serviceProgressPercent.Text = value + "%";
        }

        private async Task CompleteServiceProgress()
        {
            serviceProgressTimer.Stop();
            serviceProgressBar.Value = 100;
            serviceProgressPercent.Text = "100%";
            serviceProgressTitle.Text = "MES 系统" + ActionLabel(progressAction) + "完成";
            // Paint the completed state, then dismiss it without a second OK dialog.
            serviceProgressOverlay.Refresh();
            await Task.Delay(650);
            if (!IsDisposed) HideServiceProgress();
        }

        private void HideServiceProgress()
        {
            serviceProgressTimer.Stop();
            serviceProgressClock.Stop();
            serviceProgressOverlay.Visible = false;
        }

        private void BuildModal()
        {
            modalOverlay = new Panel { Dock = DockStyle.Fill, BackColor = Theme.Background, Visible = false };
            Panel border = new Panel { BackColor = Theme.BorderStrong, Size = new Size(480, 242) };
            Panel card = new Panel { BackColor = Theme.Surface, Location = new Point(1, 1), Size = new Size(478, 240) };
            modalTitle = new Label { AutoSize = false, ForeColor = Theme.Text, Font = new Font(Font.FontFamily, 13F, FontStyle.Bold), Location = new Point(24, 22), Size = new Size(428, 32) };
            modalBody = new Label { AutoSize = false, ForeColor = Theme.Muted, Location = new Point(24, 65), Size = new Size(428, 78) };
            modalCancelButton = CreateButton("取消", Theme.SurfaceStrong, Theme.Text, 92);
            modalConfirmButton = CreateButton("确认", Theme.AccentStrong, Theme.OnAccent, 92);
            modalCancelButton.Location = new Point(260, 172);
            modalConfirmButton.Location = new Point(362, 172);
            modalCancelButton.Click += delegate { HideModal(); };
            modalConfirmButton.Click += delegate
            {
                Action action = modalConfirmAction;
                HideModal();
                if (action != null) action();
            };
            card.Controls.AddRange(new Control[] { modalTitle, modalBody, modalCancelButton, modalConfirmButton });
            border.Controls.Add(card);
            modalOverlay.Controls.Add(border);
            modalOverlay.Resize += delegate { border.Left = (modalOverlay.ClientSize.Width - border.Width) / 2; border.Top = (modalOverlay.ClientSize.Height - border.Height) / 2; };
            Controls.Add(modalOverlay);
        }

        private void ShowModal(string title, string body, bool confirmation, Action action, bool error)
        {
            modalTitle.Text = title;
            modalBody.Text = body;
            modalConfirmAction = action;
            modalCancelButton.Visible = confirmation;
            modalConfirmButton.Text = confirmation ? "确认" : "知道了";
            modalConfirmButton.BackColor = error ? Theme.DangerSoft : Theme.AccentStrong;
            modalConfirmButton.ForeColor = error ? Theme.Danger : Theme.OnAccent;
            modalConfirmButton.Left = confirmation ? 362 : 362;
            modalOverlay.Visible = true;
            modalOverlay.BringToFront();
            modalConfirmButton.Focus();
        }

        private void HideModal()
        {
            AcceptButton = null;
            CancelButton = null;
            modalConfirmAction = null;
            modalOverlay.Visible = false;
        }

        private string RunControl(string action)
        {
            string scriptName = Path.GetFileName(controlScript);
            bool manageBrowser = scriptName == "mes-service-control.ps1" || scriptName == "docker-service-control.ps1" || scriptName == "native-service-control.ps1";
            bool suppressOpen = manageBrowser && scriptName != "native-service-control.ps1" && (action == "Start" || action == "Restart");
            string resultFile = Path.Combine(Path.GetTempPath(), "mes-control-center-result-" + Guid.NewGuid().ToString("N") + ".json");
            try
            {
                string clientCloseError="";
                Stopwatch operationClock=Stopwatch.StartNew();
                if (manageBrowser && (action == "Stop" || action == "Restart")) {
                    ReportOperationStage("正在关闭本机受管界面……");
                    try { browserSession.CloseNativeClients(); } catch (Exception error) { clientCloseError=error.Message; }
                    LogOperationStage(action,"clients.close",operationClock.ElapsedMilliseconds);
                    operationClock.Restart();
                }
                ReportOperationStage("正在"+ActionLabel(action)+"服务组，等待实际执行结果……");
                ProcessStartInfo info = new ProcessStartInfo
                {
                    FileName = "powershell.exe",
                    Arguments = "-NoProfile -ExecutionPolicy Bypass -File \"" + controlScript + "\" -Action " + action + " -ResultFile \"" + resultFile + "\"" + (suppressOpen ? " -NoOpen" : ""),
                    WorkingDirectory = Program.RuntimeRoot,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardError = true
                };
                using (Process process = Process.Start(info))
                {
                    if (process == null) throw new InvalidOperationException("无法启动 MES 控制脚本。");
                    // Descendants may inherit stderr and keep the pipe open after
                    // the controller exits. Drain concurrently, but do not await
                    // pipe EOF as the service operation's completion condition.
                    StringBuilder diagnostics = new StringBuilder();
                    object diagnosticsLock = new object();
                    Task stderrTask = DrainDiagnostics(process.StandardError, diagnostics, diagnosticsLock);
                    process.WaitForExit();
                    LogOperationStage(action,"services.execute",operationClock.ElapsedMilliseconds);
                    string result = File.Exists(resultFile) ? File.ReadAllText(resultFile) : "";
                    stderrTask.Wait(200);
                    string stderr;
                    lock (diagnosticsLock) { stderr = diagnostics.ToString().Trim(); }
                    if (!HasResultValue(result, "status"))
                    {
                        string message = "MES 控制脚本未返回执行结果，退出码：" + process.ExitCode + "。";
                        if (stderr.Length > 0) message += Environment.NewLine + stderr;
                        throw new InvalidOperationException(message);
                    }
                    string status = ReadResultValue(result, "status");
                    if (process.ExitCode != 0 && status != "error")
                        throw new InvalidOperationException("MES 控制脚本执行失败，退出码：" + process.ExitCode + "。" + ReadResultValue(result, "message"));
                    if (manageBrowser && ServiceActionSucceeded(action, status))
                    {
                        Dictionary<string, object> payload = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(result);
                        payload["interfaceOperationSucceeded"] = true;
                        try
                        {
                            if (action == "Stop" || action == "Restart") browserSession.CloseBrowserWindows();
                            object pages;
                            if ((action == "Start" || action == "Restart") && payload.TryGetValue("pageUrls", out pages))
                            {
                                List<string> urls = new List<string>();
                                foreach (object page in (System.Collections.IEnumerable)pages) urls.Add(Convert.ToString(page));
                                browserSession.Open(urls.ToArray());
                            }
                        }
                        catch (Exception exception)
                        {
                            payload["interfaceOperationSucceeded"] = false;
                            payload["message"] = Convert.ToString(payload["message"]) + "；界面：" + exception.Message;
                        }
                        result = new JavaScriptSerializer().Serialize(payload);
                        if (clientCloseError.Length > 0) {
                            payload["interfaceOperationSucceeded"]=false;
                            payload["message"]=Convert.ToString(payload["message"])+"；本机界面："+clientCloseError;
                            result=new JavaScriptSerializer().Serialize(payload);
                        }
                    }
                    return result;
                }
            }
            finally
            {
                if (File.Exists(resultFile)) File.Delete(resultFile);
            }
        }

        private void ReportOperationStage(string message)
        {
            if (!IsHandleCreated || IsDisposed) return;
            try { BeginInvoke(new Action(delegate { if (!IsDisposed && serviceBusy) { serviceProgressTitle.Text=message; footerStatusLabel.Text=message; } })); }
            catch (InvalidOperationException) { }
        }

        private static void LogOperationStage(string action, string stage, long milliseconds)
        {
            try {
                string directory=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"MesFastApiLauncher","logs");
                Directory.CreateDirectory(directory);
                File.AppendAllText(Path.Combine(directory,"control-center-operations.log"),DateTimeOffset.Now.ToString("o")+" "+action+" "+stage+" "+milliseconds+"ms"+Environment.NewLine,Encoding.UTF8);
            } catch (IOException) { } catch (UnauthorizedAccessException) { }
        }

        private static Task DrainDiagnostics(StreamReader reader, StringBuilder text, object textLock)
        {
            return Task.Run(delegate
            {
                try
                {
                    char[] chunk = new char[4096];
                    int count;
                    while ((count = reader.Read(chunk, 0, chunk.Length)) > 0)
                    {
                        lock (textLock)
                        {
                            // Retain useful failure details without growing forever.
                            int remaining = 131072 - text.Length;
                            if (remaining > 0) text.Append(chunk, 0, Math.Min(count, remaining));
                        }
                    }
                }
                catch (IOException) { }
                catch (ObjectDisposedException) { }
            });
        }

        private static bool HasResultValue(string result, string name)
        {
            return Regex.IsMatch(result ?? "", "\\\"" + name + "\\\"\\s*:\\s*\\\"[^\\\"]*\\\"");
        }

        private static string ReadResultValue(string result, string name)
        {
            Match match = Regex.Match(result ?? "", "\\\"" + name + "\\\"\\s*:\\s*\\\"([^\\\"]*)\\\"");
            return match.Success ? match.Groups[1].Value : "MES 系统状态未知";
        }

        internal bool ValidateLayout()
        {
            PerformLayout();
            return dashboardPage != null && terminalPage != null && aboutPage != null && configurationPage != null && configurationNav != null && aboutGrid != null && dashboardGrid != null && terminalGrid != null
                && IsValidServiceIndicator(serviceBackendIndicator)
                && IsValidServiceIndicator(serviceFrontendIndicator)
                && IsValidServiceIndicator(serviceLimsIndicator)
                && IsValidServiceIndicator(serviceUpperComputerIndicator)
                && CanStartSystem(false, false) && !CanStartSystem(true, false) && !CanStartSystem(false, true)
                && !UseWaitCursor && dashboardGrid.Cursor == Cursors.Default
                && dashboardNav.Height >= 44 && terminalNav.Height >= 44
                && ClientSize.Width >= MinimumSize.Width && ClientSize.Height >= MinimumSize.Height;
        }

        private static bool IsValidServiceIndicator(ServiceIndicator indicator)
        {
            return indicator != null && indicator.Dot != null && indicator.Status != null
                && indicator.Dot.Width > 0 && indicator.Status.Text.Length > 0;
        }

        internal void ShowTerminalPageForPreview()
        {
            ShowPage(false);
        }

        internal void ShowConfigurationPageForPreview() { ShowConfigurationPage(); }
        internal void ShowIntegrityPageForPreview() { ShowIntegrityPage(); }

        internal void ShowAboutPageForPreview()
        {
            ShowAboutPage();
            ApplyAboutReport(MESAccessInfo.Build(MESDesktopSettings.ServerUrl("http://127.0.0.1:5173"),
                MESDesktopSettings.IsDocker, null, MESAccessInfo.Interfaces(), delegate { return false; }));
        }

        internal void ShowDashboardPageForPreview()
        {
            ShowAboutPageForPreview();
            ShowPage(true);
        }

        internal void ShowProgressForPreview(string action)
        {
            ShowDashboardPageForPreview();
            BeginServiceProgress(action);
            serviceProgressTimer.Stop();
            serviceProgressBar.Value = 63;
            serviceProgressPercent.Text = "63%";
        }

        internal void DrawProgressPreview(Bitmap bitmap)
        {
            if (!serviceProgressOverlay.Visible) return;
            // DrawToBitmap can paint overlapping siblings in reverse order.
            Panel overlay = serviceProgressOverlay;
            using (Bitmap progress = new Bitmap(overlay.Width, overlay.Height))
            using (Graphics graphics = Graphics.FromImage(bitmap))
            {
                overlay.DrawToBitmap(progress, new Rectangle(Point.Empty, overlay.Size));
                Point origin = overlay.PointToScreen(Point.Empty);
                origin.Offset(-Left, -Top);
                graphics.DrawImageUnscaled(progress, origin);
            }
        }
    }

    // One GUI per installation and Windows user. Command-line helpers remain
    // independent so opening clients and packaging self-tests cannot consume
    // or release the running controller's ownership.
    internal sealed class ControlCenterInstance : IDisposable
    {
        internal const string AlreadyOpenMessage = "控制中心已打开。";
        private readonly System.Threading.Mutex mutex;
        private readonly System.Threading.EventWaitHandle activation;
        private readonly System.Threading.EventWaitHandle maintenance;
        private readonly System.Threading.EventWaitHandle maintenanceAck;
        internal readonly bool IsPrimary;
        [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr window, int command);
        [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr window);

        internal static string InstanceKey(string executable, string user)
        {
            string identity = user + "|" + Path.GetFullPath(executable).ToUpperInvariant();
            using (SHA256 hash = SHA256.Create())
                return "Local\\MESControlCenter-" + BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(identity))).Replace("-", "");
        }

        internal ControlCenterInstance(string executable)
        {
            string key = InstanceKey(executable, System.Security.Principal.WindowsIdentity.GetCurrent().User.Value);
            bool created;
            mutex = new System.Threading.Mutex(true, key, out created);
            if (created) IsPrimary = true;
            else
            {
                try { IsPrimary = mutex.WaitOne(0); }
                catch (System.Threading.AbandonedMutexException) { IsPrimary = true; }
            }
            activation = new System.Threading.EventWaitHandle(false, System.Threading.EventResetMode.AutoReset, key + "-Activate");
            maintenance=new System.Threading.EventWaitHandle(false,System.Threading.EventResetMode.AutoReset,key+"-Maintenance");
            maintenanceAck=new System.Threading.EventWaitHandle(false,System.Threading.EventResetMode.AutoReset,key+"-MaintenanceAck");
        }

        internal static int RequestMaintenanceClose(string executable)
        {
            string key=InstanceKey(executable,System.Security.Principal.WindowsIdentity.GetCurrent().User.Value);
            try {
                using (System.Threading.EventWaitHandle request=System.Threading.EventWaitHandle.OpenExisting(key+"-Maintenance"))
                using (System.Threading.EventWaitHandle ack=System.Threading.EventWaitHandle.OpenExisting(key+"-MaintenanceAck"))
                { ack.Reset(); request.Set(); return ack.WaitOne(5000) ? 0 : 6; }
            } catch (System.Threading.WaitHandleCannotBeOpenedException) { return 0; }
        }

        internal int Run(Func<Form> createForm, Action<Form> alreadyOpen)
        {
            if (!IsPrimary) { activation.Set(); return 0; }
            using (Form form = createForm())
            using (Timer timer = new Timer { Interval = 150 })
            {
                bool notifying = false;
                timer.Tick += delegate
                {
                    if (maintenance.WaitOne(0) && !form.IsDisposed && !form.Disposing) {
                        ControlCenterForm center=form as ControlCenterForm;
                        if (center != null && center.CloseForMaintenance()) maintenanceAck.Set();
                        return;
                    }
                    if (!activation.WaitOne(0) || form.IsDisposed || form.Disposing || notifying) return;
                    notifying = true;
                    try
                    {
                        if (form.WindowState == FormWindowState.Minimized) ShowWindow(form.Handle, 9);
                        form.Show();
                        form.Activate();
                        SetForegroundWindow(form.Handle);
                        alreadyOpen(form);
                    }
                    finally { notifying = false; }
                };
                timer.Start();
                Application.Run(form);
            }
            return 0;
        }

        public void Dispose()
        {
            activation.Dispose();
            maintenance.Dispose();maintenanceAck.Dispose();
            if (IsPrimary) mutex.ReleaseMutex();
            mutex.Dispose();
        }
    }

    internal static class Program
    {
        internal const string ProjectRoot = @"__PROJECT_ROOT__";
        internal static readonly string RuntimeRoot = MESDesktopSettings.ControlRoot(ProjectRoot);

        [STAThread]
        private static int Main(string[] args)
        {
            if (args.Length > 0 && args[0] == "--close-controller") return ControlCenterInstance.RequestMaintenanceClose(typeof(Program).Assembly.Location);
            string scriptPath = Path.Combine(RuntimeRoot, "scripts", MESDesktopSettings.IsNative ? "native-service-control.ps1" : MESDesktopSettings.IsDocker ? "docker-service-control.ps1" : "mes-service-control.ps1");
            if (args.Length > 1 && String.Equals(args[0], "--open-pages", StringComparison.OrdinalIgnoreCase))
            {
                try
                {
                    string[] urls = new string[args.Length - 1];
                    Array.Copy(args, 1, urls, 0, urls.Length);
                    new MESBrowserSession(RuntimeRoot, null).Open(urls);
                    return 0;
                }
                catch (Exception exception)
                {
                    MessageBox.Show("服务已就绪，网页打开失败：" + exception.Message, "MES 控制中心", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    return 7;
                }
            }
            if (args.Length > 0 && String.Equals(args[0], "--self-test", StringComparison.OrdinalIgnoreCase))
            {
                try
                {
                    TerminalManagerClient.NormalizeServerUrl("http://192.168.110.15:5173");
                    if (!MESServerDiscovery.RunSelfTest()) return 5;
                    if (!MESAccessInfo.RunSelfTest()) return 6;
                    if (!File.Exists(scriptPath)) return 4;
                    using (ControlCenterForm form = new ControlCenterForm(scriptPath, false)) return form.ValidateLayout() ? 0 : 3;
                }
                catch { return 2; }
            }
            if (args.Length > 1 && String.Equals(args[0], "--render-preview", StringComparison.OrdinalIgnoreCase))
            {
                try
                {
                    Application.EnableVisualStyles();
                    Application.SetCompatibleTextRenderingDefault(false);
                    using (ControlCenterForm form = new ControlCenterForm(scriptPath, false))
                    using (Bitmap bitmap = new Bitmap(form.Width, form.Height))
                    {
                        form.ShowInTaskbar = false;
                        form.StartPosition = FormStartPosition.Manual;
                        form.Location = new Point(-10000, -10000);
                        form.Show();
                        Application.DoEvents();
                        if (args.Length > 2 && String.Equals(args[2], "terminal", StringComparison.OrdinalIgnoreCase)) form.ShowTerminalPageForPreview();
                        if (args.Length > 2 && String.Equals(args[2], "about", StringComparison.OrdinalIgnoreCase)) form.ShowAboutPageForPreview();
                        if (args.Length > 2 && String.Equals(args[2], "configuration", StringComparison.OrdinalIgnoreCase)) form.ShowConfigurationPageForPreview();
                        if (args.Length <= 2 || String.Equals(args[2], "dashboard", StringComparison.OrdinalIgnoreCase)) form.ShowDashboardPageForPreview();
                        if (args.Length > 2 && args[2].StartsWith("progress-", StringComparison.OrdinalIgnoreCase)) form.ShowProgressForPreview(args[2].Substring(9));
                        form.PerformLayout();
                        Application.DoEvents();
                        form.DrawToBitmap(bitmap, new Rectangle(Point.Empty, form.Size));
                        form.DrawProgressPreview(bitmap);
                        bitmap.Save(args[1], System.Drawing.Imaging.ImageFormat.Png);
                        form.Hide();
                    }
                    return 0;
                }
                catch { return 5; }
            }
            if (!File.Exists(scriptPath))
            {
                MessageBox.Show("未找到 MES 控制脚本：" + scriptPath, "MES 控制中心", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            using (ControlCenterInstance instance = new ControlCenterInstance(typeof(Program).Assembly.Location))
                return instance.Run(delegate { return new ControlCenterForm(scriptPath, true); }, delegate(Form form) {
                    MessageBox.Show(form, ControlCenterInstance.AlreadyOpenMessage, "MES 控制中心", MessageBoxButtons.OK, MessageBoxIcon.Information);
                });
        }
    }
}
