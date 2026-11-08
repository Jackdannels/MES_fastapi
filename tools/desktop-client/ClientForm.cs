using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace MESDesktopClient
{
    internal sealed class ClientForm : Form
    {
        private readonly ClientConfiguration config;
        private readonly ClientInstance instance;
        private readonly Panel surface = new Panel();
        private readonly Panel notice = new Panel();
        private readonly Label message = new Label();
        private readonly Label status = new Label();
        private readonly Timer statusTimer = new Timer();
        private readonly Timer retry = new Timer();
        private WebView2 web;
        private CoreWebView2Environment environment;
        private TaskCompletionSource<bool> browserExited;
        private bool initializing;
        private bool closing;
        private bool closeReady;
        private bool closeRequested;
        private bool recreate;
        private string state = "starting";
        private string currentPath = "/";
        private int browserPid;
        private int blockedNavigations;
        private int downloadsStarted;
        private string lastDownloadState = "";
        private int pageErrors;
        private int apiSuccessCount;
        private int apiFailureCount;
        private readonly bool embedded;
        private readonly List<ClientForm> simulatorPages = new List<ClientForm>();
        private readonly TaskCompletionSource<bool> closed = new TaskCompletionSource<bool>();
        private readonly Dictionary<string, Panel> pages = new Dictionary<string, Panel>();
        private readonly Dictionary<string, Button> navigation = new Dictionary<string, Button>();
        private FlowLayoutPanel header;
        private Panel pageHost;
        private string activeModule;
        private string pageTheme = "dark";
        private Action themeChanged;
        private Func<bool> confirmExit;
        private bool confirmationShowing;
        private bool authenticationBusy;

        internal ClientForm(ClientConfiguration configuration, ClientInstance owner) : this(configuration, owner, false) { }

        private ClientForm(ClientConfiguration configuration, ClientInstance owner, bool isEmbedded)
        {
            config = configuration;
            instance = owner;
            embedded = isEmbedded;
            themeChanged = ApplyNavigationTheme;
            confirmExit = ConfirmExit;
            activeModule = config.Module;
            Text = config.Title;
            Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            StartPosition = FormStartPosition.CenterScreen;
            MinimumSize = new Size(800, 600);
            Size = new Size(1280, 800);
            AutoScaleMode = AutoScaleMode.Dpi;
            Font = new Font("Microsoft YaHei UI", 10F);
            BackColor = Color.FromArgb(19, 26, 34);
            if (embedded) { TopLevel = false; FormBorderStyle = FormBorderStyle.None; MinimumSize = Size.Empty; Dock = DockStyle.Fill; }
            if (config.HiddenTest && !embedded) { ShowInTaskbar = false; Opacity = 0; }
            header = new FlowLayoutPanel { Dock = DockStyle.Top, Height = 46, Padding = new Padding(8, 4, 8, 4), WrapContents = false };
            if (config.Module == "central") AddNavigation(config.Module, "MES中控管理");
            header.Visible = !embedded && config.Module == "central";
            status.Dock = DockStyle.Bottom; status.Height = 26;
            status.ForeColor = Color.FromArgb(180, 205, 202); status.Padding = new Padding(12, 3, 8, 0);
            status.Text = "正在启动" + config.Title + "…";
            status.Visible = false;
            statusTimer.Interval = 8000;
            statusTimer.Tick += delegate { statusTimer.Stop(); status.Visible = false; };
            surface.Dock = DockStyle.Fill;
            notice.Dock = DockStyle.Fill; notice.BackColor = Color.FromArgb(19, 26, 34);
            message.Dock = DockStyle.Fill; message.ForeColor = Color.White;
            message.TextAlign = ContentAlignment.MiddleCenter; message.Padding = new Padding(32);
            message.Font = new Font(Font.FontFamily, 14F);
            Button reconnect = new Button { Text = "重新连接", Dock = DockStyle.Bottom, Height = 52, BackColor = Color.FromArgb(40, 80, 75), ForeColor = Color.White, FlatStyle = FlatStyle.Flat };
            reconnect.Click += async delegate { retry.Stop(); await ConnectAsync(); };
            notice.Controls.Add(message); notice.Controls.Add(reconnect);
            if (config.IsWorkstation)
            {
                Button closeNotice = new Button { Text = "关闭", AccessibleName = "关闭", Dock = DockStyle.Bottom, Height = 48,
                    BackColor = Color.FromArgb(30, 44, 52), ForeColor = Color.White, FlatStyle = FlatStyle.Flat };
                closeNotice.Click += delegate { Close(); };
                notice.Controls.Add(closeNotice);
            }
            surface.Controls.Add(notice);
            Controls.Add(surface); Controls.Add(status); Controls.Add(header);
            if (config.SimulatorsEnabled && !embedded)
            {
                pageHost = new Panel { Dock = DockStyle.Fill };
                Panel central = new Panel { Dock = DockStyle.Fill, BackColor = BackColor };
                central.Controls.Add(surface); central.Controls.Add(status);
                pages.Add("central", central);
                pageHost.Controls.Add(central);
                foreach (string module in new[] { "lims", "upper-computer" })
                {
                    ClientForm page = new ClientForm(config.SimulatorPage(module), null, true);
                    page.themeChanged = ApplyNavigationTheme;
                    simulatorPages.Add(page);
                    Panel tab = new Panel { Dock = DockStyle.Fill, BackColor = BackColor, Visible = false };
                    tab.Controls.Add(page);
                    pages.Add(module, tab);
                    pageHost.Controls.Add(tab);
                    AddNavigation(module, module == "lims" ? "LIMS模拟器" : "上位机模拟器");
                }
                // Fill must be first in z-order so Dock.Top reserves the header height.
                Controls.Add(pageHost); pageHost.BringToFront();
            }
            retry.Interval = 10000;
            retry.Tick += async delegate { retry.Stop(); await ConnectAsync(); };
            Shown += async delegate
            {
                if (!embedded)
                {
                    ApplyWindowMode();
                    SelectTab(config.InitialTab);
                    instance.Listen(Dispatch, AfterCommand);
                }
                await ConnectAsync();
            };
            FormClosing += HandleClosing;
            FormClosed += delegate { closed.TrySetResult(true); };
        }

        private ClientForm ActivePage()
        {
            return simulatorPages.Find(page => page.config.Module == activeModule) ?? this;
        }

        private void ApplyWindowMode()
        {
            if (config.FullScreen)
            {
                Rectangle display = Screen.FromControl(this).Bounds;
                WindowState = FormWindowState.Normal;
                FormBorderStyle = FormBorderStyle.None;
                Bounds = display;
            }
            else WindowState = config.StartMaximized ? FormWindowState.Maximized : FormWindowState.Normal;
        }

        private bool SelectTab(string module)
        {
            if (String.IsNullOrEmpty(module)) module = config.Module;
            if (module != config.Module && !pages.ContainsKey(module)) return false;
            activeModule = module;
            foreach (KeyValuePair<string, Panel> page in pages) page.Value.Visible = page.Key == module;
            if (pages.ContainsKey(module)) pages[module].BringToFront();
            ApplyNavigationTheme();
            ClientForm selected = ActivePage();
            if (selected != this && !selected.Visible) selected.Show();
            return true;
        }

        private void AddNavigation(string module, string title)
        {
            Button button = new Button { Text = title, AutoSize = true, Height = 36,
                Padding = new Padding(16, 6, 16, 6), Margin = new Padding(0, 0, 6, 0),
                FlatStyle = FlatStyle.Flat, BackColor = BackColor, ForeColor = Color.White,
                AccessibleName = title };
            button.FlatAppearance.BorderSize = 0;
            button.Click += delegate { SelectTab(module); };
            navigation.Add(module, button);
            header.Controls.Add(button);
        }

        private void ApplyNavigationTheme()
        {
            bool light = ActivePage().pageTheme == "light";
            header.BackColor = light ? Color.White : Color.FromArgb(19, 26, 34);
            foreach (KeyValuePair<string, Button> item in navigation)
            {
                bool active = item.Key == activeModule;
                item.Value.BackColor = active ? (light ? Color.FromArgb(237, 243, 252) : Color.FromArgb(27, 54, 56)) : header.BackColor;
                item.Value.ForeColor = active ? (light ? Color.FromArgb(37, 99, 235) : Color.FromArgb(99, 230, 190))
                    : (light ? Color.FromArgb(82, 100, 125) : Color.FromArgb(139, 169, 164));
                item.Value.FlatAppearance.MouseOverBackColor = light ? Color.FromArgb(225, 235, 252) : Color.FromArgb(35, 65, 68);
                item.Value.AccessibleDescription = active ? "当前页面" : "切换页面";
            }
        }

        private void ShowStatus(string text)
        {
            if (closing || closeRequested) return;
            status.Text = text;
            status.Visible = true;
            statusTimer.Stop(); statusTimer.Start();
        }

        private void ShowNotice(string text, bool recover)
        {
            if (closing || closeRequested) return;
            state = recover ? "reconnecting" : "error";
            message.Text = text;
            status.Text = recover ? "连接暂时中断，将自动重试。" : "需要处理客户端配置或运行环境。";
            notice.Visible = true; notice.BringToFront();
            if (recover) retry.Start();
        }

        private async Task ConnectAsync()
        {
            if (closing || closeRequested || initializing) return;
            initializing = true;
            retry.Stop();
            message.Text = "正在连接" + config.Title + "…"; notice.Visible = true; notice.BringToFront();
            try
            {
                if (web == null || recreate)
                {
                    if (web != null) { web.Dispose(); web = null; }
                    if (browserExited != null && recreate) await Task.WhenAny(browserExited.Task, Task.Delay(3000));
                    if (closing || closeRequested) return;
                    recreate = false;
                    Directory.CreateDirectory(config.DataDirectory);
                    environment = await CoreWebView2Environment.CreateAsync(config.FixedRuntime, Path.Combine(config.DataDirectory, "WebView2"));
                    browserExited = new TaskCompletionSource<bool>();
                    TaskCompletionSource<bool> exited = browserExited;
                    environment.BrowserProcessExited += delegate { exited.TrySetResult(true); };
                    if (closing || closeRequested) return;
                    web = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.White };
                    surface.Controls.Add(web); web.BringToFront(); notice.BringToFront();
                    await web.EnsureCoreWebView2Async(environment);
                    if (closing || closeRequested) return;
                    browserPid = Convert.ToInt32(web.CoreWebView2.BrowserProcessId);
                    web.CoreWebView2.Settings.AreDevToolsEnabled = false;
                    web.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
                    web.CoreWebView2.Settings.AreBrowserAcceleratorKeysEnabled = false;
                    web.CoreWebView2.Settings.IsStatusBarEnabled = false;
                    web.CoreWebView2.Settings.IsPasswordAutosaveEnabled = false;
                    web.CoreWebView2.Settings.IsGeneralAutofillEnabled = false;
                    Directory.CreateDirectory(config.DownloadDirectory);
                    web.CoreWebView2.Profile.DefaultDownloadFolderPath = config.DownloadDirectory;
                    web.CoreWebView2.DownloadStarting += delegate(object sender, CoreWebView2DownloadStartingEventArgs args)
                    {
                        downloadsStarted++;
                        lastDownloadState = "in-progress";
                        args.Handled = true;
                        CoreWebView2DownloadOperation download = args.DownloadOperation;
                        string filename = Path.GetFileName(args.ResultFilePath);
                        string path = Path.Combine(config.DownloadDirectory, filename);
                        int suffix = 1;
                        while (File.Exists(path)) path = Path.Combine(config.DownloadDirectory, Path.GetFileNameWithoutExtension(filename) + " (" + suffix++ + ")" + Path.GetExtension(filename));
                        args.ResultFilePath = path;
                        ShowStatus("正在下载：" + Path.GetFileName(path));
                        download.StateChanged += delegate
                        {
                            if (closing || closeRequested) return;
                            if (download.State == CoreWebView2DownloadState.Completed) { lastDownloadState = "completed"; ShowStatus("已下载：" + path); }
                            else if (download.State == CoreWebView2DownloadState.Interrupted) { lastDownloadState = download.InterruptReason.ToString(); ShowStatus("下载未完成，请重试。"); }
                        };
                    };
                    await web.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(config.BootstrapScript());
                    await web.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(config.DiagnosticsScript());
                    web.CoreWebView2.WebMessageReceived += async delegate(object sender, CoreWebView2WebMessageReceivedEventArgs args)
                    {
                        if (closing || closeRequested || !config.AllowsNavigation(args.Source)) return;
                        string value = args.WebMessageAsJson;
                        if (value == "\"mes-client-page-error\"") pageErrors++;
                        else if (value == "\"mes-client-close-request\"" && config.IsWorkstation && !embedded)
                            BeginInvoke(new Action(Close));
                        else if (value == "\"mes-client-auth-required\"" && config.AutoLogin)
                            await NavigateHomeAsync(true);
                        else if (value == "\"mes-client-host-info-request\"")
                            web.CoreWebView2.PostWebMessageAsJson(new System.Web.Script.Serialization.JavaScriptSerializer().Serialize(new {
                                type = "mes-client-host-info", version = ClientConfiguration.Version, localIpAddresses = ClientHostInfo.LocalIpAddresses()
                            }));
                        else if (value == "\"mes-client-theme:light\"" || value == "\"mes-client-theme:dark\"")
                        {
                            pageTheme = value == "\"mes-client-theme:light\"" ? "light" : "dark";
                            themeChanged();
                        }
                    };
                    web.CoreWebView2.WebResourceResponseReceived += delegate(object sender, CoreWebView2WebResourceResponseReceivedEventArgs args)
                    {
                        if (closing || closeRequested || !config.AllowsNavigation(args.Request.Uri)) return;
                        Uri resource = new Uri(args.Request.Uri);
                        if (!resource.AbsolutePath.StartsWith("/api/", StringComparison.Ordinal)) return;
                        if (args.Response.StatusCode >= 200 && args.Response.StatusCode < 400) apiSuccessCount++;
                        else apiFailureCount++;
                    };
                    web.CoreWebView2.NavigationStarting += delegate(object sender, CoreWebView2NavigationStartingEventArgs args)
                    {
                        if (closing || closeRequested || !config.AllowsNavigation(args.Uri))
                        {
                            args.Cancel = true;
                            blockedNavigations++;
                            ShowStatus("已阻止跳转到当前系统站点之外。");
                        }
                        else { state = "loading"; currentPath = new Uri(args.Uri).AbsolutePath; }
                    };
                    web.CoreWebView2.SourceChanged += delegate
                    {
                        if (closing || closeRequested || web == null) return;
                        Uri uri;
                        if (Uri.TryCreate(web.CoreWebView2.Source, UriKind.Absolute, out uri)) currentPath = uri.AbsolutePath;
                    };
                    web.CoreWebView2.NavigationCompleted += delegate(object sender, CoreWebView2NavigationCompletedEventArgs args)
                    {
                        if (closing || closeRequested) return;
                        if (args.IsSuccess && args.HttpStatusCode < 400)
                        {
                            state = "ready"; notice.Visible = false; retry.Stop();
                            statusTimer.Stop(); status.Visible = false; status.Text = "";
                        }
                        else ShowNotice("暂时无法连接" + config.Title + "服务。\n请确认服务器已启动，网络连接正常。", true);
                    };
                    web.CoreWebView2.NewWindowRequested += delegate(object sender, CoreWebView2NewWindowRequestedEventArgs args)
                    {
                        args.Handled = true;
                        if (config.AllowsNavigation(args.Uri)) web.CoreWebView2.Navigate(args.Uri);
                        else { blockedNavigations++; ShowStatus("已阻止打开当前系统站点之外的新窗口。"); }
                    };
                    web.CoreWebView2.LaunchingExternalUriScheme += delegate(object sender, CoreWebView2LaunchingExternalUriSchemeEventArgs args) { args.Cancel = true; };
                    web.CoreWebView2.ProcessFailed += delegate(object sender, CoreWebView2ProcessFailedEventArgs args)
                    {
                        if (closing || closeRequested) return;
                        config.Log("WebView2 process failed: " + args.ProcessFailedKind);
                        recreate = args.ProcessFailedKind == CoreWebView2ProcessFailedKind.BrowserProcessExited;
                        ShowNotice(config.Title + "界面暂时中断，正在准备恢复。", true);
                    };
                }
                if (!closing && !closeRequested) await NavigateHomeAsync(true);
            }
            catch (WebView2RuntimeNotFoundException)
            {
                ShowNotice("此电脑缺少 Microsoft Edge WebView2 Runtime。\n请安装交付包中的 WebView2 离线运行库，然后重新打开客户端。", false);
                config.Log("WebView2 Runtime missing.");
            }
            catch (Exception error)
            {
                if (!closing && !closeRequested)
                {
                    recreate = true;
                    config.Log("Initialization failed: " + error.GetType().Name + " " + error.Message);
                    ShowNotice(config.Title + "界面初始化失败。\n可点击“重新连接”，或检查客户端日志。", true);
                }
            }
            finally { initializing = false; }
        }

        private async Task NavigateHomeAsync(bool initial)
        {
            if (closing || closeRequested || web == null || web.CoreWebView2 == null) return;
            if (!initial && config.AllowsNavigation(web.CoreWebView2.Source)) { web.CoreWebView2.Reload(); return; }
            if (!config.AutoLogin) { web.CoreWebView2.Navigate(new Uri(config.Server, config.EntryPath).AbsoluteUri); return; }
            if (authenticationBusy) return;
            authenticationBusy = true;
            state = "authenticating";
            message.Text = "正在连接" + config.Title + "…"; notice.Visible = true; notice.BringToFront();
            try
            {
                Uri address = await Task.Run(delegate { return new ClientTerminalAuth(config).SignInAddress(); });
                if (!closing && !closeRequested && config.AllowsNavigation(address.AbsoluteUri)) web.CoreWebView2.Navigate(address.AbsoluteUri);
            }
            catch (Exception error)
            {
                if (!closing && !closeRequested) ShowNotice(error.Message, true);
            }
            finally { authenticationBusy = false; }
        }

        private async void NavigateHome(bool initial)
        {
            await NavigateHomeAsync(initial);
        }

        private Dictionary<string, object> Dispatch(Dictionary<string, object> command)
        {
            if (InvokeRequired) return (Dictionary<string, object>)Invoke(new Func<Dictionary<string, object>, Dictionary<string, object>>(Dispatch), command);
            string action = command.ContainsKey("command") ? Convert.ToString(command["command"]) : "";
            if (action == "close") { closeRequested = true; if (!closing) retry.Stop(); }
            else if (action == "activate" && !closeRequested && !closing)
            {
                string server = command.ContainsKey("serverUrl") ? Convert.ToString(command["serverUrl"]) : "";
                Uri next = ClientConfiguration.ValidateServer(server);
                if (next != config.Server)
                {
                    config.Server = next;
                    NavigateHome(true);
                }
                string tab = command.ContainsKey("tab") ? Convert.ToString(command["tab"]) : "";
                if (!String.IsNullOrEmpty(tab) && !SelectTab(tab)) return new Dictionary<string, object> { { "ok", false }, { "state", "unknown-tab" } };
                if (WindowState == FormWindowState.Minimized) ApplyWindowMode();
                if (!config.HiddenTest) { Activate(); BringToFront(); }
            }
            else if (action == "reload" && !closeRequested && !closing) ActivePage().NavigateHome(false);
            else if (action == "select-tab" && !closeRequested && !closing)
            {
                if (!SelectTab(command.ContainsKey("tab") ? Convert.ToString(command["tab"]) : ""))
                    return new Dictionary<string, object> { { "ok", false }, { "state", "unknown-tab" } };
            }
            else if (action == "minimize" && !closeRequested && !closing) WindowState = FormWindowState.Minimized;
            else if (action == "maximize" && !closeRequested && !closing) { if (config.FullScreen) ApplyWindowMode(); else WindowState = FormWindowState.Maximized; }
            else if (action == "restore" && !closeRequested && !closing) { if (config.FullScreen) ApplyWindowMode(); else WindowState = FormWindowState.Normal; }
            else if (action != "status") return new Dictionary<string, object> { { "ok", false }, { "state", "closing" } };
            Dictionary<string, object> result = PageStatus();
            List<Dictionary<string, object>> pages = new List<Dictionary<string, object>> { PageStatus() };
            foreach (ClientForm page in simulatorPages) pages.Add(page.PageStatus());
            result["tabs"] = pages;
            result["activeTab"] = ActivePage().config.Module;
            result["windowState"] = WindowState.ToString();
            result["tabsVisible"] = config.SimulatorsEnabled && header.Visible && pageHost.Top >= header.Bottom;
            List<string> labels = new List<string>();
            List<int[]> positions = new List<int[]>();
            foreach (Button button in navigation.Values) { labels.Add(button.Text); positions.Add(new[] { button.Left, button.Top, button.Width, button.Height }); }
            result["navigationLabels"] = labels;
            result["navigationBounds"] = positions;
            result["headerControlCount"] = header.Controls.Count;
            result["headerVisible"] = header.Visible;
            result["autoLogin"] = config.AutoLogin;
            result["theme"] = ActivePage().pageTheme;
            result["navigationBackground"] = ColorTranslator.ToHtml(header.BackColor);
            result["localIpAddresses"] = ClientHostInfo.LocalIpAddresses();
            return result;
        }

        private Dictionary<string, object> PageStatus()
        {
            return new Dictionary<string, object> {
                { "ok", true }, { "pid", Process.GetCurrentProcess().Id }, { "browserPid", browserPid },
                { "state", closeRequested || closing ? "closing" : state }, { "currentPath", currentPath },
                { "fullScreen", config.FullScreen }, { "version", ClientConfiguration.Version }, { "module", config.Module },
                { "labCode", config.LabCode }, { "labName", config.LabName }, { "entryPath", config.EntryPath },
                { "documentTitle", web != null && web.CoreWebView2 != null ? web.CoreWebView2.DocumentTitle : "" },
                { "blockedNavigations", blockedNavigations }, { "downloadsStarted", downloadsStarted }, { "lastDownloadState", lastDownloadState },
                { "windowBounds", new[] { Left, Top, Width, Height } },
                { "screenBounds", new[] { Screen.FromControl(this).Bounds.Left, Screen.FromControl(this).Bounds.Top, Screen.FromControl(this).Bounds.Width, Screen.FromControl(this).Bounds.Height } },
                { "borderless", FormBorderStyle == FormBorderStyle.None },
                { "pageErrors", pageErrors }, { "apiSuccessCount", apiSuccessCount }, { "apiFailureCount", apiFailureCount },
                { "statusVisible", status.Visible }, { "statusText", status.Text }
            };
        }

        private void AfterCommand(Dictionary<string, object> request)
        {
            if (request.ContainsKey("command") && Convert.ToString(request["command"]) == "close" && !IsDisposed)
                BeginInvoke(new Action(Close));
        }

        private async void HandleClosing(object sender, FormClosingEventArgs args)
        {
            if (closeReady) return;
            args.Cancel = true;
            if (closing) return;
            if (!embedded && config.Module != "lims" && config.Module != "upper-computer" && !closeRequested && args.CloseReason == CloseReason.UserClosing)
            {
                if (confirmationShowing) return;
                bool accepted;
                confirmationShowing = true;
                try { accepted = confirmExit(); }
                finally { confirmationShowing = false; }
                if (!accepted) return;
            }
            closing = true; closeRequested = true; state = "closing";
            retry.Stop(); retry.Dispose();
            statusTimer.Stop(); statusTimer.Dispose();
            status.Text = "正在退出" + config.Title + "…";
            List<Task> shutdown = new List<Task>();
            foreach (ClientForm page in simulatorPages)
            {
                if (page.IsHandleCreated) { page.Close(); shutdown.Add(page.closed.Task); }
                else { page.Dispose(); page.closed.TrySetResult(true); }
            }
            if (web != null) { web.Dispose(); web = null; }
            if (browserExited != null) shutdown.Add(browserExited.Task);
            if (shutdown.Count > 0)
            {
                Task all = Task.WhenAll(shutdown);
                Task finished = await Task.WhenAny(all, Task.Delay(6000));
                if (finished != all) config.Log("WebView2 shutdown exceeded six seconds; host is exiting without killing unrelated processes.");
            }
            config.Log("Client closed intentionally; recovery disabled.");
            closeReady = true;
            Close();
        }

        private bool ConfirmExit()
        {
            return ExitConfirmationDialog.Confirm(this, ActivePage().pageTheme == "light", config.Title, config.Module == "central");
        }
    }
}
