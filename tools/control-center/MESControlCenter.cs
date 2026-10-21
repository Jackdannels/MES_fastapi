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
[assembly: AssemblyVersion("2.7.2.0")]
[assembly: AssemblyFileVersion("2.7.2.0")]

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
            foreach (string url in urls)
            {
                Uri uri;
                if (!Uri.TryCreate(url, UriKind.Absolute, out uri) || (uri.Scheme != "http" && uri.Scheme != "https") || uri.UserInfo.Length > 0)
                    throw new InvalidOperationException("MES 页面地址不是有效的 HTTP(S) 地址。");
                arguments.Append(" \"").Append(uri.AbsoluteUri.Replace("\"", "%22")).Append("\"");
            }
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

        internal void Close()
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

    internal static class Theme
    {
        internal static readonly Color Background = Color.FromArgb(7, 16, 20);
        internal static readonly Color Sidebar = Color.FromArgb(9, 22, 27);
        internal static readonly Color Surface = Color.FromArgb(12, 25, 31);
        internal static readonly Color SurfaceStrong = Color.FromArgb(17, 36, 43);
        internal static readonly Color SurfaceRaised = Color.FromArgb(23, 48, 57);
        internal static readonly Color Border = Color.FromArgb(36, 67, 75);
        internal static readonly Color BorderStrong = Color.FromArgb(53, 97, 106);
        internal static readonly Color Text = Color.FromArgb(237, 247, 246);
        internal static readonly Color Muted = Color.FromArgb(156, 179, 182);
        internal static readonly Color Subtle = Color.FromArgb(111, 139, 143);
        internal static readonly Color Accent = Color.FromArgb(82, 208, 181);
        internal static readonly Color AccentStrong = Color.FromArgb(44, 169, 137);
        internal static readonly Color AccentSoft = Color.FromArgb(18, 61, 56);
        internal static readonly Color Warning = Color.FromArgb(224, 168, 90);
        internal static readonly Color WarningSoft = Color.FromArgb(59, 44, 25);
        internal static readonly Color Danger = Color.FromArgb(236, 116, 107);
        internal static readonly Color DangerSoft = Color.FromArgb(66, 31, 32);
    }

    internal sealed class BrandIcon : Control
    {
        internal BrandIcon()
        {
            DoubleBuffered = true;
            Size = new Size(42, 42);
            AccessibleName = "MES 控制中枢图标";
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            Graphics graphics = e.Graphics;
            graphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
            Rectangle box = new Rectangle(1, 1, Width - 3, Height - 3);
            using (SolidBrush background = new SolidBrush(Theme.Accent))
            using (System.Drawing.Drawing2D.GraphicsPath path = RoundedRectangle(box, 10))
            {
                graphics.FillPath(background, path);
            }
            using (Pen pen = new Pen(Color.FromArgb(6, 34, 29), Math.Max(2F, Width / 18F)))
            {
                pen.StartCap = System.Drawing.Drawing2D.LineCap.Round;
                pen.EndCap = System.Drawing.Drawing2D.LineCap.Round;
                float left = Width * .23F;
                float right = Width * .77F;
                float top = Height * .35F;
                float bottom = Height * .72F;
                graphics.DrawRectangle(pen, left, top, right - left, bottom - top);
                graphics.DrawLine(pen, Width * .36F, top, Width * .36F, Height * .24F);
                graphics.DrawLine(pen, Width * .36F, Height * .24F, Width * .64F, Height * .24F);
                graphics.DrawLine(pen, Width * .64F, Height * .24F, Width * .64F, top);
                graphics.DrawLine(pen, Width * .31F, Height * .49F, Width * .48F, Height * .49F);
                graphics.DrawLine(pen, Width * .31F, Height * .61F, Width * .57F, Height * .61F);
                graphics.DrawLine(pen, Width * .66F, Height * .46F, Width * .66F, Height * .66F);
                graphics.DrawLine(pen, Width * .58F, Height * .56F, Width * .74F, Height * .56F);
            }
        }

        private static System.Drawing.Drawing2D.GraphicsPath RoundedRectangle(Rectangle rectangle, int radius)
        {
            int diameter = radius * 2;
            System.Drawing.Drawing2D.GraphicsPath path = new System.Drawing.Drawing2D.GraphicsPath();
            path.AddArc(rectangle.Left, rectangle.Top, diameter, diameter, 180, 90);
            path.AddArc(rectangle.Right - diameter, rectangle.Top, diameter, diameter, 270, 90);
            path.AddArc(rectangle.Right - diameter, rectangle.Bottom - diameter, diameter, diameter, 0, 90);
            path.AddArc(rectangle.Left, rectangle.Bottom - diameter, diameter, diameter, 90, 90);
            path.CloseFigure();
            return path;
        }
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
        private readonly List<Button> terminalButtons = new List<Button>();

        private Panel dashboardPage;
        private Panel terminalPage;
        private Panel aboutPage;
        private Button dashboardNav;
        private Button terminalNav;
        private Button aboutNav;
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
        private Button reloadButton;
        private Button shutdownButton;
        private Button restartTerminalButton;
        private Button shutdownAllButton;
        private Button restartAllButton;
        private DataGridView dashboardGrid;
        private DataGridView terminalGrid;
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

        internal ControlCenterForm(string scriptPath, bool autoStart)
        {
            controlScript = scriptPath;
            browserSession = new MESBrowserSession(Program.RuntimeRoot, null);
            automaticRefresh = autoStart;
            Text = "MES 控制中心 v2.7.2";
            StartPosition = FormStartPosition.CenterScreen;
            MinimumSize = new Size(1160, 700);
            ClientSize = new Size(1420, 820);
            BackColor = Theme.Background;
            ForeColor = Theme.Text;
            Font = new Font("Microsoft YaHei UI", 9F, FontStyle.Regular, GraphicsUnit.Point);
            KeyPreview = true;

            BuildShell();
            BuildModal();
            BuildServiceProgress();
            refreshTimer.Interval = 5000;
            refreshTimer.Tick += async delegate { if (!serviceBusy) await RefreshTerminals(false); };
            serviceStatusTimer.Interval = 5000;
            serviceStatusTimer.Tick += async delegate { if (!serviceBusy) await RefreshServiceStatus(false); };
            serviceProgressTimer.Interval = 160;
            serviceProgressTimer.Tick += delegate { UpdateServiceProgress(); };
            FormClosed += delegate { refreshTimer.Dispose(); serviceStatusTimer.Dispose(); serviceProgressTimer.Dispose(); };
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
            Label brandTitle = new Label { AutoSize = true, ForeColor = Theme.Text, Font = new Font(Font.FontFamily, 11F, FontStyle.Bold), Location = new Point(58, 6), Text = "MES 控制中心" };
            Label brandVersion = new Label { AutoSize = true, ForeColor = Theme.Subtle, Font = new Font("Segoe UI", 8F), Location = new Point(59, 31), Text = "CONTROL CENTER  v2.7.2" };
            brand.Controls.AddRange(new Control[] { brandIcon, brandTitle, brandVersion });
            sidebar.Controls.Add(brand);

            dashboardNav = CreateNavigationButton("控制台总览", 90);
            terminalNav = CreateNavigationButton("终端管理", 138);
            dashboardNav.Click += delegate { ShowPage(true); };
            terminalNav.Click += delegate { ShowPage(false); };
            sidebar.Controls.AddRange(new Control[] { dashboardNav, terminalNav });

            Label systemSection = new Label { AutoSize = true, ForeColor = Theme.Subtle, Font = new Font(Font.FontFamily, 8F, FontStyle.Bold), Location = new Point(24, 210), Text = "SYSTEM" };
            sidebar.Controls.Add(systemSection);
            Button connectionNav = CreateNavigationButton("连接设置", 232);
            connectionNav.Click += delegate { ShowPage(false); serverText.Focus(); };
            sidebar.Controls.Add(connectionNav);
            aboutNav = CreateNavigationButton("关于与访问地址", 280);
            aboutNav.Click += async delegate { ShowAboutPage(); await RefreshAboutInfo(); };
            sidebar.Controls.Add(aboutNav);

            Panel nodeSummary = new Panel { Dock = DockStyle.Bottom, Height = 82, BackColor = Theme.Surface };
            nodeSummary.Padding = new Padding(13);
            Label nodeTitle = new Label { AutoSize = true, ForeColor = Theme.Text, Font = new Font(Font.FontFamily, 9F, FontStyle.Bold), Location = new Point(13, 13), Text = "控制节点状态" };
            systemStatusLabel = new Label { AutoSize = false, ForeColor = Theme.Muted, Location = new Point(13, 38), Size = new Size(166, 30), Text = "正在检测……" };
            nodeSummary.Controls.AddRange(new Control[] { nodeTitle, systemStatusLabel });
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
            Panel tableHead = new Panel { Dock = DockStyle.Top, Height = 52, BackColor = Theme.Surface };
            Label tableTitle = new Label { AutoSize = true, ForeColor = Theme.Text, Font = new Font(Font.FontFamily, 10F, FontStyle.Bold), Location = new Point(16, 16), Text = "终端概况" };
            terminalSummaryLabel = new Label { AutoSize = true, Anchor = AnchorStyles.Top | AnchorStyles.Right, ForeColor = Theme.Subtle, Location = new Point(400, 17), Text = "尚未连接" };
            Button manageButton = CreateButton("进入终端管理", Theme.AccentSoft, Theme.Accent, 126);
            manageButton.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            manageButton.Location = new Point(500, 7);
            manageButton.Click += delegate { ShowPage(false); };
            tableHead.Resize += delegate
            {
                manageButton.Left = tableHead.ClientSize.Width - manageButton.Width - 12;
                terminalSummaryLabel.Left = manageButton.Left - terminalSummaryLabel.Width - 18;
            };
            tableHead.Controls.AddRange(new Control[] { tableTitle, terminalSummaryLabel, manageButton });
            dashboardGrid = CreateTerminalGrid(false);
            tableCard.Controls.Add(dashboardGrid);
            tableCard.Controls.Add(tableHead);
            layout.Controls.Add(tableCard, 0, 1);
            Panel accessBar = new Panel { Dock = DockStyle.Top, Height = 76, BackColor = Theme.Surface };
            Label accessTitle = new Label { AutoSize = true, Location = new Point(16, 10), ForeColor = Theme.Muted, Text = "MES 局域网访问地址" };
            lanAddressLink = new LinkLabel { AutoSize = false, Location = new Point(16, 33), Size = new Size(560, 28), LinkColor = Theme.Accent, ActiveLinkColor = Theme.AccentStrong, VisitedLinkColor = Theme.Accent, Font = new Font("Consolas", 12F, FontStyle.Bold), Text = "正在检测主机地址……", AccessibleName = "MES 局域网访问地址" };
            lanAddressLink.LinkClicked += async delegate { ShowAboutPage(); await RefreshAboutInfo(); };
            lanAddressStatus = new Label { AutoSize = false, Location = new Point(600, 36), Size = new Size(250, 24), ForeColor = Theme.Muted, Text = "等待服务就绪" };
            Button copyAddress = CreateButton("复制地址", Theme.AccentSoft, Theme.Accent, 108);
            copyAddress.Anchor = AnchorStyles.Right | AnchorStyles.Top;
            copyAddress.Location = new Point(900, 18);
            copyAddress.Click += delegate
            {
                if (selectedLanUrl.Length == 0) return;
                try { Clipboard.SetText(selectedLanUrl); footerStatusLabel.Text = "已复制：" + selectedLanUrl + "；请从工作站验证访问"; }
                catch (Exception exception) { ShowModal("复制失败", exception.Message, false, null, true); }
            };
            accessBar.Resize += delegate
            {
                copyAddress.Left = accessBar.ClientSize.Width - copyAddress.Width - 16;
                lanAddressStatus.Left = Math.Min(600, copyAddress.Left - 250);
                lanAddressLink.Width = Math.Max(300, lanAddressStatus.Left - 25);
            };
            accessBar.Controls.AddRange(new Control[] { accessTitle, lanAddressLink, lanAddressStatus, copyAddress });
            page.Controls.Add(accessBar);
            return page;
        }

        private void BuildServiceCard(Panel card)
        {
            Panel head = new Panel { Dock = DockStyle.Top, Height = 52, BackColor = Theme.Surface };
            Label title = new Label { AutoSize = true, ForeColor = Theme.Text, Font = new Font(Font.FontFamily, 10F, FontStyle.Bold), Location = new Point(16, 16), Text = "MES 服务组" };
            serviceStateLabel = new Label { AutoSize = true, Anchor = AnchorStyles.Top | AnchorStyles.Right, ForeColor = Theme.Muted, Location = new Point(300, 17), Text = "正在检测" };
            head.Resize += delegate { serviceStateLabel.Left = head.ClientSize.Width - serviceStateLabel.Width - 16; };
            head.Controls.AddRange(new Control[] { title, serviceStateLabel });

            Panel actionBar = new Panel { Dock = DockStyle.Bottom, Height = 58, BackColor = Theme.Surface, Padding = new Padding(14, 8, 14, 8) };
            Button stop = CreateButton("关闭系统", Theme.DangerSoft, Theme.Danger, 106);
            Button restart = CreateButton("重启系统", Theme.WarningSoft, Theme.Warning, 106);
            startServiceButton = CreateButton("启动系统", Theme.AccentStrong, Color.FromArgb(4, 27, 23), 106);
            stop.Location = new Point(14, 8);
            restart.Location = new Point(128, 8);
            startServiceButton.Location = new Point(242, 8);
            stop.Click += delegate { RequestServiceAction("Stop"); };
            restart.Click += delegate { RequestServiceAction("Restart"); };
            startServiceButton.Click += delegate { RequestServiceAction("Start"); };
            serviceButtons.AddRange(new Button[] { stop, restart, startServiceButton });
            actionBar.Controls.AddRange(new Control[] { stop, restart, startServiceButton });

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
            wrapper.Controls.Add(card);
            parent.Controls.Add(wrapper, column, 0);
            return valueLabel;
        }

        private Panel BuildTerminalPage()
        {
            Panel page = new Panel { Dock = DockStyle.Fill, BackColor = Theme.Background, Visible = false };
            Panel connection = new Panel { Dock = DockStyle.Top, Height = 98, BackColor = Theme.Surface, Padding = new Padding(16) };
            serverText = AddInput(connection, "MES 地址", MESAccessInfo.InitialServerUrl(), 16, 22, 300, false);
            usernameText = AddInput(connection, "管理员", "admin", 332, 22, 138, false);
            passwordText = AddInput(connection, "密码", MESDesktopSettings.RequiresAdministratorLogin ? "" : "123", 486, 22, 138, true);
            connectButton = CreateButton("连接", Theme.AccentStrong, Color.FromArgb(4, 27, 23), 96);
            connectButton.Location = new Point(642, 36);
            connectButton.Click += async delegate { await ConnectAndRefresh(true); };
            refreshButton = CreateButton("刷新状态", Theme.AccentSoft, Theme.Accent, 112);
            refreshButton.Location = new Point(748, 36);
            refreshButton.Click += async delegate { await RefreshTerminals(true); };
            terminalButtons.AddRange(new Button[] { connectButton, refreshButton });
            connection.Controls.AddRange(new Control[] { connectButton, refreshButton });

            Panel actions = new Panel { Dock = DockStyle.Bottom, Height = 66, BackColor = Theme.Surface, Padding = new Padding(14, 11, 14, 11) };
            reloadButton = CreateButton("刷新选中界面", Theme.AccentSoft, Theme.Accent, 138);
            shutdownButton = CreateButton("关闭选中终端", Theme.DangerSoft, Theme.Danger, 138);
            restartTerminalButton = CreateButton("重启选中终端", Theme.WarningSoft, Theme.Warning, 138);
            shutdownAllButton = CreateButton("关闭全部终端", Theme.DangerSoft, Theme.Danger, 138);
            restartAllButton = CreateButton("重启全部终端", Theme.WarningSoft, Theme.Warning, 138);
            Button[] actionButtons = { reloadButton, shutdownButton, restartTerminalButton, shutdownAllButton, restartAllButton };
            int x = 14;
            foreach (Button button in actionButtons)
            {
                button.Location = new Point(x, 11);
                actions.Controls.Add(button);
                terminalButtons.Add(button);
                x += button.Width + 10;
            }
            shutdownAllButton.Left += 22;
            restartAllButton.Left += 22;
            reloadButton.Click += async delegate { await SendSelectedCommand("reload", "刷新界面"); };
            shutdownButton.Click += delegate { RequestSelectedTerminalCommand("shutdown", "关闭"); };
            restartTerminalButton.Click += delegate { RequestSelectedTerminalCommand("restart", "重启"); };
            shutdownAllButton.Click += delegate { RequestBatchCommand("shutdown", "关闭"); };
            restartAllButton.Click += delegate { RequestBatchCommand("restart", "重启"); };

            terminalGrid = CreateTerminalGrid(true);
            terminalGrid.SelectionChanged += delegate { UpdateTerminalActionState(); };
            page.Controls.Add(terminalGrid);
            page.Controls.Add(actions);
            page.Controls.Add(connection);
            return page;
        }

        private TextBox AddInput(Control parent, string labelText, string value, int x, int y, int width, bool password)
        {
            Label label = new Label { AutoSize = true, ForeColor = Theme.Muted, Location = new Point(x, y - 3), Text = labelText };
            TextBox input = new TextBox { Location = new Point(x, y + 18), Size = new Size(width, 30), BackColor = Theme.SurfaceStrong, ForeColor = Theme.Text, BorderStyle = BorderStyle.FixedSingle, Text = value, UseSystemPasswordChar = password };
            parent.Controls.AddRange(new Control[] { label, input });
            return input;
        }

        private DataGridView CreateTerminalGrid(bool detailed)
        {
            DataGridView grid = new DataGridView
            {
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
            grid.ColumnHeadersDefaultCellStyle = new DataGridViewCellStyle { BackColor = Theme.SurfaceStrong, ForeColor = Theme.Text, Font = new Font(Font, FontStyle.Bold), SelectionBackColor = Theme.SurfaceStrong, Alignment = DataGridViewContentAlignment.MiddleLeft };
            grid.DefaultCellStyle = new DataGridViewCellStyle { BackColor = Theme.Surface, ForeColor = Theme.Text, SelectionBackColor = Theme.AccentSoft, SelectionForeColor = Theme.Text, Padding = new Padding(5), WrapMode = DataGridViewTriState.False };
            grid.AlternatingRowsDefaultCellStyle = new DataGridViewCellStyle { BackColor = Color.FromArgb(10, 28, 33) };
            grid.GridColor = Theme.Border;
            AddColumn(grid, "状态", "Online", 70);
            AddColumn(grid, "终端", "TerminalName", 158);
            AddColumn(grid, "IP 地址", "IpAddress", 124);
            if (detailed) AddColumn(grid, "主机名", "MachineName", 145);
            AddColumn(grid, "当前页面", "CurrentPage", detailed ? 195 : 230);
            if (detailed) AddColumn(grid, "页面路径", "CurrentPath", 220);
            AddColumn(grid, "最后心跳", "LastSeenAt", 150);
            if (detailed) AddColumn(grid, "终端权限", "PermissionLabel", 175);
            AddColumn(grid, "最近命令", "CommandLabel", 120);
            grid.CellFormatting += GridCellFormatting;
            return grid;
        }

        private void AddColumn(DataGridView grid, string header, string property, int width)
        {
            grid.Columns.Add(new DataGridViewTextBoxColumn { HeaderText = header, DataPropertyName = property, Name = property, Width = width, MinimumWidth = Math.Min(width, 70), SortMode = DataGridViewColumnSortMode.NotSortable });
        }

        private void GridCellFormatting(object sender, DataGridViewCellFormattingEventArgs args)
        {
            DataGridView grid = sender as DataGridView;
            if (grid == null || args.RowIndex < 0 || grid.Columns[args.ColumnIndex].Name != "Online") return;
            TerminalRow row = grid.Rows[args.RowIndex].DataBoundItem as TerminalRow;
            if (row == null) return;
            args.Value = row.Online ? "●  在线" : "○  离线";
            args.CellStyle.ForeColor = row.Online ? Theme.Accent : Theme.Muted;
            args.FormattingApplied = true;
        }

        private Panel CreateCard(Padding marginPadding)
        {
            return new Panel { Dock = DockStyle.Fill, BackColor = Theme.Surface, Margin = marginPadding };
        }

        private Button CreateNavigationButton(string text, int top)
        {
            Button button = new Button { FlatStyle = FlatStyle.Flat, FlatAppearance = { BorderSize = 0 }, BackColor = Theme.Sidebar, ForeColor = Theme.Muted, Location = new Point(14, top), Size = new Size(192, 44), Text = "  " + text, TextAlign = ContentAlignment.MiddleLeft, Cursor = Cursors.Hand };
            return button;
        }

        private Button CreateButton(string text, Color background, Color foreground, int width)
        {
            Button button = new Button { Text = text, Size = new Size(width, 40), FlatStyle = FlatStyle.Flat, BackColor = background, ForeColor = foreground, Cursor = Cursors.Hand, Font = new Font(Font.FontFamily, 9F, FontStyle.Bold), UseVisualStyleBackColor = false };
            button.FlatAppearance.BorderColor = background == Theme.AccentStrong ? Theme.AccentStrong : Theme.BorderStrong;
            button.FlatAppearance.BorderSize = 1;
            return button;
        }

        private Panel BuildAboutPage()
        {
            Panel page = new Panel { Dock = DockStyle.Fill, BackColor = Theme.Background, Visible = false };
            Panel header = new Panel { Dock = DockStyle.Top, Height = 144, BackColor = Theme.Surface };
            string mode = MESDesktopSettings.IsNative ? "Windows 原生服务" : MESDesktopSettings.IsDocker ? "Docker 容器" : "本机开发服务";
            Label title = new Label { AutoSize = true, Text = "MES 控制中心  v2.7.2", ForeColor = Theme.Text, Font = new Font(Font, FontStyle.Bold), Location = new Point(18, 16) };
            Label deployment = new Label { AutoSize = true, Text = "部署方式：" + mode + "    ·    Web、API、LIMS 与上位机服务管理", ForeColor = Theme.Muted, Location = new Point(18, 43) };
            Label local = new Label { AutoSize = true, Text = "本机访问", ForeColor = Theme.Muted, Location = new Point(18, 78) };
            aboutLocalUrl = new TextBox { ReadOnly = true, BorderStyle = BorderStyle.FixedSingle, BackColor = Theme.SurfaceStrong, ForeColor = Theme.Accent, Location = new Point(90, 74), Size = new Size(320, 28), Font = new Font("Consolas", 10F), AccessibleName = "MES 本机访问地址" };
            aboutBinding = new Label { AutoSize = false, Anchor = AnchorStyles.Left | AnchorStyles.Right | AnchorStyles.Top, Location = new Point(18, 111), Size = new Size(900, 25), ForeColor = Theme.Muted, Text = "点击刷新读取当前监听状态" };
            header.Controls.AddRange(new Control[] { title, deployment, local, aboutLocalUrl, aboutBinding });
            header.Resize += delegate { aboutBinding.Width = header.ClientSize.Width - 36; };

            Panel bottom = new Panel { Dock = DockStyle.Bottom, Height = 174, BackColor = Theme.Surface };
            aboutGuidance = new Label { AutoSize = false, Location = new Point(18, 14), Size = new Size(900, 86), ForeColor = Theme.Muted, Text = "请在 MES 主机运行本程序。局域网地址不使用容器 IP 或 127.0.0.1。" };
            aboutRefreshButton = CreateButton("刷新地址", Theme.AccentSoft, Theme.Accent, 112);
            aboutCopyButton = CreateButton("复制选中地址", Theme.AccentStrong, Color.FromArgb(4, 27, 23), 140);
            aboutOpenButton = CreateButton("浏览器打开", Theme.SurfaceStrong, Theme.Text, 126);
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

        private void ShowPage(bool dashboard)
        {
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
            if (aboutPage.Visible) { await RefreshAboutInfo(); return; }
            await RefreshServiceStatus(true);
            await RefreshAboutInfo();
            if (terminalConnected) await RefreshTerminals(true);
            else await ConnectAndRefresh(false);
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

        private async Task RunServiceOperation(string action)
        {
            if (serviceBusy) return;
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
                if (IsDisposed) return;
                string status = ReadResultValue(result, "status");
                string message = ReadResultValue(result, "message");
                bool success = status == "started" || status == "restarted" || status == "stopped"
                    || status == "already_running" || status == "not_running";
                if (success)
                {
                    systemRunning = status != "stopped" && status != "not_running";
                    if (!systemRunning)
                    {
                        terminalConnected = false;
                        UpdateTerminalActionState();
                    }
                    await CompleteServiceProgress();
                }
                else HideServiceProgress();
                if (IsDisposed) return;
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
                    if (automaticRefresh) serviceStatusTimer.Start();
                    if (automaticRefresh && terminalConnected) refreshTimer.Start();
                }
            }
            // Release action buttons before optional network/terminal refreshes.
            if (automaticRefresh && !IsDisposed && generation == serviceGeneration)
            {
                await RefreshServiceStatus(false);
                if (IsDisposed || generation != serviceGeneration) return;
                await RefreshAboutInfo();
                if (!IsDisposed && generation == serviceGeneration && action != "Stop") await ConnectAndRefresh(false);
            }
        }

        private static string ActionLabel(string action)
        {
            return action == "Start" ? "启动" : action == "Restart" ? "重启" : "关闭";
        }

        private void SetServiceButtonsEnabled(bool enabled)
        {
            foreach (Button button in serviceButtons) button.Enabled = enabled;
            if (startServiceButton != null) ApplyStartButtonVisual(startServiceButton.Enabled);
        }

        private void UpdateServiceActionState()
        {
            bool enabled = !serviceBusy;
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
            startServiceButton.ForeColor = enabled ? Color.FromArgb(4, 27, 23) : Theme.Subtle;
            startServiceButton.FlatAppearance.BorderColor = enabled ? Theme.AccentStrong : Theme.Border;
            startServiceButton.Cursor = enabled ? Cursors.Hand : Cursors.Default;
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
                refreshTimer.Start();
                await LoadRows();
                footerStatusLabel.Text = "终端管理已连接；状态每 5 秒自动刷新";
            }
            catch (Exception exception)
            {
                terminalConnected = false;
                refreshTimer.Stop();
                footerStatusLabel.Text = "终端连接失败：" + exception.Message;
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
        }

        private void BindGrid(DataGridView grid)
        {
            grid.DataSource = null;
            grid.DataSource = rows;
        }

        private TerminalRow SelectedTerminal()
        {
            if (terminalGrid.SelectedRows.Count == 0) return null;
            return terminalGrid.SelectedRows[0].DataBoundItem as TerminalRow;
        }

        private void UpdateTerminalActionState()
        {
            if (reloadButton == null) return;
            TerminalRow selected = SelectedTerminal();
            reloadButton.Enabled = !terminalBusy && selected != null && selected.Online && selected.AllowReload;
            shutdownButton.Enabled = !terminalBusy && selected != null && selected.Online && selected.AllowPower;
            restartTerminalButton.Enabled = shutdownButton.Enabled;
            bool anyPower = terminalConnected && rows.Exists(delegate(TerminalRow row) { return row.Online && row.AllowPower; });
            shutdownAllButton.Enabled = !terminalBusy && anyPower;
            restartAllButton.Enabled = !terminalBusy && anyPower;
            refreshButton.Enabled = !terminalBusy && terminalConnected;
            connectButton.Enabled = !terminalBusy;
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
            modalOverlay = new Panel { Dock = DockStyle.Fill, BackColor = Color.FromArgb(7, 14, 19), Visible = false };
            Panel border = new Panel { BackColor = Theme.BorderStrong, Size = new Size(480, 242) };
            Panel card = new Panel { BackColor = Theme.Surface, Location = new Point(1, 1), Size = new Size(478, 240) };
            modalTitle = new Label { AutoSize = false, ForeColor = Theme.Text, Font = new Font(Font.FontFamily, 13F, FontStyle.Bold), Location = new Point(24, 22), Size = new Size(428, 32) };
            modalBody = new Label { AutoSize = false, ForeColor = Theme.Muted, Location = new Point(24, 65), Size = new Size(428, 78) };
            modalCancelButton = CreateButton("取消", Theme.SurfaceStrong, Theme.Text, 92);
            modalConfirmButton = CreateButton("确认", Theme.AccentStrong, Color.FromArgb(4, 27, 23), 92);
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
            modalConfirmButton.ForeColor = error ? Theme.Danger : Color.FromArgb(4, 27, 23);
            modalConfirmButton.Left = confirmation ? 362 : 362;
            modalOverlay.Visible = true;
            modalOverlay.BringToFront();
            modalConfirmButton.Focus();
        }

        private void HideModal()
        {
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
                    if (manageBrowser && (status == "started" || status == "restarted" || status == "already_running" || status == "stopped" || status == "not_running" || status == "success"))
                    {
                        Dictionary<string, object> payload = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(result);
                        try
                        {
                            if (action == "Stop" || action == "Restart") browserSession.Close();
                            object pages;
                            if ((action == "Start" || action == "Restart") && payload.TryGetValue("pageUrls", out pages))
                            {
                                List<string> urls = new List<string>();
                                foreach (object page in (System.Collections.IEnumerable)pages) urls.Add(Convert.ToString(page));
                                browserSession.Open(urls.ToArray());
                            }
                        }
                        catch (Exception exception) { payload["message"] = Convert.ToString(payload["message"]) + "；浏览器：" + exception.Message; }
                        result = new JavaScriptSerializer().Serialize(payload);
                    }
                    return result;
                }
            }
            finally
            {
                if (File.Exists(resultFile)) File.Delete(resultFile);
            }
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
            return dashboardPage != null && terminalPage != null && aboutPage != null && aboutGrid != null && dashboardGrid != null && terminalGrid != null
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

    internal static class Program
    {
        internal const string ProjectRoot = @"__PROJECT_ROOT__";
        internal static readonly string RuntimeRoot = MESDesktopSettings.ControlRoot(ProjectRoot);

        [STAThread]
        private static int Main(string[] args)
        {
            string scriptPath = Path.Combine(RuntimeRoot, "scripts", MESDesktopSettings.IsNative ? "native-service-control.ps1" : MESDesktopSettings.IsDocker ? "docker-service-control.ps1" : "mes-service-control.ps1");
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
            Application.Run(new ControlCenterForm(scriptPath, true));
            return 0;
        }
    }
}
