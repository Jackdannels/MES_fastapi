using System;
using System.Collections;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Net;
using System.Reflection;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;
using System.Web.Script.Serialization;

[assembly: AssemblyTitle("MES 终端管理")]
[assembly: AssemblyDescription("MES 固定工作台终端状态与远程控制面板")]
[assembly: AssemblyCompany("MES")]
[assembly: AssemblyProduct("MES Terminal Manager")]
[assembly: AssemblyVersion("1.2.0.0")]
[assembly: AssemblyFileVersion("1.2.0.0")]

namespace MESTerminalManager
{
    internal sealed class TerminalRow
    {
        public string TerminalId { get; set; }
        public string TerminalName { get; set; }
        public string MachineName { get; set; }
        public string IpAddress { get; set; }
        public string CurrentPage { get; set; }
        public string CurrentPath { get; set; }
        public string LastSeenAt { get; set; }
        public string PermissionLabel { get; set; }
        public string CommandLabel { get; set; }
        public bool Online { get; set; }
        public bool AllowReload { get; set; }
        public bool AllowPower { get; set; }
    }

    internal sealed class TerminalManagerClient
    {
        private readonly CookieContainer cookies = new CookieContainer();
        private string serverUrl = "";

        internal void Configure(string value)
        {
            serverUrl = NormalizeServerUrl(value);
        }

        internal void Login(string username, string password)
        {
            Post("/auth/login", new Dictionary<string, object>
            {
                { "username", (username ?? "").Trim() },
                { "password", password ?? "" },
                { "module", "central" }
            });
        }

        internal List<TerminalRow> ListTerminals()
        {
            Dictionary<string, object> payload = Request("GET", "/api/terminal-control/terminals", null);
            List<TerminalRow> rows = new List<TerminalRow>();
            object itemsValue;
            if (!payload.TryGetValue("items", out itemsValue) || itemsValue == null) return rows;
            IEnumerable items = itemsValue as IEnumerable;
            if (items == null) return rows;
            foreach (object itemValue in items)
            {
                Dictionary<string, object> item = itemValue as Dictionary<string, object>;
                if (item == null) continue;
                rows.Add(BuildRow(item));
            }
            return rows;
        }

        internal void QueueCommand(string terminalId, string action)
        {
            Post(
                "/api/terminal-control/terminals/" + Uri.EscapeDataString(terminalId) + "/commands",
                new Dictionary<string, object> { { "action", action } }
            );
        }

        internal int QueueBatch(string action)
        {
            Dictionary<string, object> response = Post(
                "/api/terminal-control/commands/batch",
                new Dictionary<string, object> { { "action", action } }
            );
            object count;
            return response.TryGetValue("queuedCount", out count) ? Convert.ToInt32(count) : 0;
        }

        private Dictionary<string, object> Post(string path, Dictionary<string, object> body)
        {
            return Request("POST", path, body);
        }

        private Dictionary<string, object> Request(string method, string path, Dictionary<string, object> body)
        {
            if (String.IsNullOrWhiteSpace(serverUrl)) throw new InvalidOperationException("请先填写 MES 地址并连接。");
            JavaScriptSerializer serializer = new JavaScriptSerializer();
            HttpWebRequest request = (HttpWebRequest)WebRequest.Create(serverUrl + path);
            request.Method = method;
            request.Accept = "application/json";
            request.CookieContainer = cookies;
            request.Proxy = null;
            request.Timeout = 10000;
            request.ReadWriteTimeout = 10000;
            if (body != null)
            {
                byte[] bytes = Encoding.UTF8.GetBytes(serializer.Serialize(body));
                request.ContentType = "application/json; charset=utf-8";
                request.ContentLength = bytes.Length;
                using (Stream stream = request.GetRequestStream()) stream.Write(bytes, 0, bytes.Length);
            }
            try
            {
                using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
                using (StreamReader reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8))
                {
                    string text = reader.ReadToEnd();
                    if (String.IsNullOrWhiteSpace(text)) return new Dictionary<string, object>();
                    return serializer.Deserialize<Dictionary<string, object>>(text);
                }
            }
            catch (WebException exception)
            {
                string detail = exception.Message;
                if (exception.Response != null)
                {
                    using (StreamReader reader = new StreamReader(exception.Response.GetResponseStream(), Encoding.UTF8))
                    {
                        string text = reader.ReadToEnd();
                        try
                        {
                            Dictionary<string, object> error = serializer.Deserialize<Dictionary<string, object>>(text);
                            object detailValue;
                            if (error != null && error.TryGetValue("detail", out detailValue)) detail = Convert.ToString(detailValue);
                        }
                        catch { }
                    }
                }
                throw new InvalidOperationException(detail, exception);
            }
        }

        private static TerminalRow BuildRow(Dictionary<string, object> item)
        {
            string title = Text(item, "currentTitle");
            string path = Text(item, "currentPath");
            bool allowReload = Flag(item, "allowReload");
            bool allowPower = Flag(item, "allowPower");
            return new TerminalRow
            {
                TerminalId = Text(item, "terminalId"),
                TerminalName = Text(item, "terminalName"),
                MachineName = Text(item, "machineName"),
                IpAddress = Text(item, "ipAddress"),
                CurrentPage = title.Length > 0 ? title : (path.Length > 0 ? path : "尚未上报"),
                CurrentPath = title.Length > 0 ? path : "",
                LastSeenAt = FormatTime(Text(item, "lastSeenAt")),
                PermissionLabel = (allowReload ? "可刷新" : "禁刷新") + " / " + (allowPower ? "可电源控制" : "禁电源控制"),
                CommandLabel = FormatCommand(item),
                Online = Flag(item, "online"),
                AllowReload = allowReload,
                AllowPower = allowPower
            };
        }

        private static string FormatCommand(Dictionary<string, object> item)
        {
            object value;
            if (!item.TryGetValue("lastCommand", out value) || value == null) return "-";
            Dictionary<string, object> command = value as Dictionary<string, object>;
            if (command == null) return "-";
            string action = Text(command, "action");
            string status = Text(command, "status");
            Dictionary<string, string> actions = new Dictionary<string, string>
            {
                { "reload", "刷新" }, { "shutdown", "关机" }, { "restart", "重启" }
            };
            Dictionary<string, string> states = new Dictionary<string, string>
            {
                { "queued", "待领取" }, { "dispatched", "执行中" }, { "completed", "已完成" }, { "failed", "失败" }
            };
            string actionLabel;
            string stateLabel;
            if (!actions.TryGetValue(action, out actionLabel)) actionLabel = action;
            if (!states.TryGetValue(status, out stateLabel)) stateLabel = status;
            return actionLabel + " · " + stateLabel;
        }

        private static string Text(Dictionary<string, object> item, string key)
        {
            object value;
            return item.TryGetValue(key, out value) && value != null ? Convert.ToString(value).Trim() : "";
        }

        private static bool Flag(Dictionary<string, object> item, string key)
        {
            object value;
            return item.TryGetValue(key, out value) && value != null && Convert.ToBoolean(value);
        }

        private static string FormatTime(string value)
        {
            DateTime parsed;
            if (!DateTime.TryParse(value, out parsed)) return value.Length > 0 ? value : "从未在线";
            return parsed.ToLocalTime().ToString("yyyy-MM-dd HH:mm:ss");
        }

        internal static string NormalizeServerUrl(string value)
        {
            string normalized = (value ?? "").Trim().TrimEnd('/');
            if (normalized.Length == 0) throw new InvalidOperationException("MES 地址不能为空。");
            if (!normalized.StartsWith("http://", StringComparison.OrdinalIgnoreCase)
                && !normalized.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
            {
                normalized = "http://" + normalized;
            }
            Uri uri;
            if (!Uri.TryCreate(normalized, UriKind.Absolute, out uri)
                || (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
            {
                throw new InvalidOperationException("MES 地址格式不正确。");
            }
            bool hasExplicitPort = uri.Authority.LastIndexOf(':') > uri.Authority.LastIndexOf(']');
            UriBuilder builder = new UriBuilder(uri);
            if (!hasExplicitPort && uri.Scheme == Uri.UriSchemeHttp) builder.Port = 5173;
            return builder.Uri.GetLeftPart(UriPartial.Authority).TrimEnd('/');
        }
    }

    internal sealed class ManagerForm : Form
    {
        private readonly Color pageBackground = Color.FromArgb(8, 19, 25);
        private readonly Color panelBackground = Color.FromArgb(14, 32, 39);
        private readonly Color panelStrong = Color.FromArgb(20, 43, 50);
        private readonly Color border = Color.FromArgb(48, 88, 94);
        private readonly Color text = Color.FromArgb(232, 244, 244);
        private readonly Color muted = Color.FromArgb(157, 181, 183);
        private readonly Color accent = Color.FromArgb(88, 196, 182);
        private readonly Color danger = Color.FromArgb(255, 107, 90);

        private readonly TerminalManagerClient client = new TerminalManagerClient();
        private readonly TextBox serverText = new TextBox();
        private readonly TextBox usernameText = new TextBox();
        private readonly TextBox passwordText = new TextBox();
        private readonly Button connectButton = new Button();
        private readonly Button refreshButton = new Button();
        private readonly Button reloadButton = new Button();
        private readonly Button shutdownButton = new Button();
        private readonly Button restartButton = new Button();
        private readonly Button shutdownAllButton = new Button();
        private readonly Button restartAllButton = new Button();
        private readonly DataGridView grid = new DataGridView();
        private readonly Label summaryLabel = new Label();
        private readonly ToolStripStatusLabel statusLabel = new ToolStripStatusLabel();
        private readonly Timer refreshTimer = new Timer();
        private List<TerminalRow> rows = new List<TerminalRow>();
        private bool connected;
        private bool busy;

        internal ManagerForm()
        {
            Text = "MES 终端管理 v1.2";
            StartPosition = FormStartPosition.CenterScreen;
            MinimumSize = new Size(1180, 680);
            ClientSize = new Size(1420, 780);
            BackColor = pageBackground;
            ForeColor = text;
            Font = new Font("Microsoft YaHei UI", 10F, FontStyle.Regular, GraphicsUnit.Point);

            BuildGrid();
            BuildHeader();
            BuildActions();
            BuildStatus();

            refreshTimer.Interval = 5000;
            refreshTimer.Tick += async delegate { await RefreshTerminals(false); };
            FormClosed += delegate { refreshTimer.Stop(); };
            Shown += async delegate { await ConnectAndRefresh(); };
        }

        private void BuildHeader()
        {
            Panel header = new Panel { Dock = DockStyle.Top, Height = 136, BackColor = panelBackground, Padding = new Padding(22, 14, 22, 10) };
            Controls.Add(header);

            Label titleLabel = new Label
            {
                Text = "MES 工作台终端管理",
                Font = new Font(Font.FontFamily, 18F, FontStyle.Bold),
                ForeColor = text,
                Location = new Point(22, 14),
                AutoSize = true
            };
            header.Controls.Add(titleLabel);

            summaryLabel.Text = "尚未连接";
            summaryLabel.ForeColor = muted;
            summaryLabel.Location = new Point(292, 23);
            summaryLabel.Size = new Size(360, 28);
            header.Controls.Add(summaryLabel);

            AddHeaderField(header, "MES 地址", serverText, 22, 78, 310);
            AddHeaderField(header, "管理员", usernameText, 360, 78, 150);
            AddHeaderField(header, "密码", passwordText, 538, 78, 150);
            serverText.Text = "http://mes-server:5173";
            usernameText.Text = "admin";
            passwordText.Text = "123";
            passwordText.UseSystemPasswordChar = true;

            ConfigureButton(connectButton, "连接", false);
            connectButton.Location = new Point(716, 77);
            connectButton.Size = new Size(100, 42);
            connectButton.Click += async delegate { await ConnectAndRefresh(); };
            header.Controls.Add(connectButton);

            ConfigureButton(refreshButton, "刷新状态", false);
            refreshButton.Location = new Point(828, 77);
            refreshButton.Size = new Size(118, 42);
            refreshButton.Click += async delegate { await RefreshTerminals(true); };
            header.Controls.Add(refreshButton);
        }

        private void AddHeaderField(Control parent, string label, TextBox input, int x, int y, int width)
        {
            Label fieldLabel = new Label { Text = label, ForeColor = muted, Location = new Point(x, y - 22), AutoSize = true };
            input.Location = new Point(x, y);
            input.Size = new Size(width, 32);
            input.BackColor = panelStrong;
            input.ForeColor = text;
            input.BorderStyle = BorderStyle.FixedSingle;
            parent.Controls.Add(fieldLabel);
            parent.Controls.Add(input);
        }

        private void BuildGrid()
        {
            grid.Dock = DockStyle.Fill;
            grid.BackgroundColor = pageBackground;
            grid.BorderStyle = BorderStyle.None;
            grid.AllowUserToAddRows = false;
            grid.AllowUserToDeleteRows = false;
            grid.AllowUserToResizeRows = false;
            grid.AutoGenerateColumns = false;
            grid.MultiSelect = false;
            grid.ReadOnly = true;
            grid.RowHeadersVisible = false;
            grid.SelectionMode = DataGridViewSelectionMode.FullRowSelect;
            grid.EnableHeadersVisualStyles = false;
            grid.ColumnHeadersHeight = 44;
            grid.RowTemplate.Height = 52;
            grid.ColumnHeadersDefaultCellStyle = new DataGridViewCellStyle
            {
                BackColor = panelStrong, ForeColor = text, Font = new Font(Font, FontStyle.Bold),
                SelectionBackColor = panelStrong, Alignment = DataGridViewContentAlignment.MiddleLeft
            };
            grid.DefaultCellStyle = new DataGridViewCellStyle
            {
                BackColor = panelBackground, ForeColor = text, SelectionBackColor = Color.FromArgb(30, 78, 78),
                SelectionForeColor = Color.White, Padding = new Padding(6), WrapMode = DataGridViewTriState.False
            };
            grid.AlternatingRowsDefaultCellStyle = new DataGridViewCellStyle { BackColor = Color.FromArgb(11, 27, 33) };
            grid.GridColor = border;
            AddColumn("状态", "Online", 72);
            AddColumn("IP 地址", "IpAddress", 132);
            AddColumn("终端", "TerminalName", 165);
            AddColumn("主机名", "MachineName", 150);
            AddColumn("当前页面", "CurrentPage", 210);
            AddColumn("页面路径", "CurrentPath", 245);
            AddColumn("最后心跳", "LastSeenAt", 170);
            AddColumn("终端权限", "PermissionLabel", 190);
            AddColumn("最近命令", "CommandLabel", 115);
            grid.SelectionChanged += delegate { UpdateActionState(); };
            grid.CellFormatting += GridCellFormatting;
            Controls.Add(grid);
        }

        private void AddColumn(string header, string property, int width)
        {
            grid.Columns.Add(new DataGridViewTextBoxColumn
            {
                HeaderText = header, DataPropertyName = property, Name = property,
                Width = width, MinimumWidth = Math.Min(width, 80), SortMode = DataGridViewColumnSortMode.NotSortable
            });
        }

        private void GridCellFormatting(object sender, DataGridViewCellFormattingEventArgs e)
        {
            if (grid.Columns[e.ColumnIndex].Name != "Online" || e.RowIndex < 0) return;
            TerminalRow row = grid.Rows[e.RowIndex].DataBoundItem as TerminalRow;
            if (row == null) return;
            e.Value = row.Online ? "在线" : "离线";
            e.CellStyle.ForeColor = row.Online ? accent : muted;
            e.FormattingApplied = true;
        }

        private void BuildActions()
        {
            Panel actions = new Panel { Dock = DockStyle.Bottom, Height = 74, BackColor = panelBackground, Padding = new Padding(22, 14, 22, 14) };
            Controls.Add(actions);
            ConfigureButton(reloadButton, "刷新选中界面", false);
            ConfigureButton(shutdownButton, "关闭选中终端", true);
            ConfigureButton(restartButton, "重启选中终端", true);
            ConfigureButton(shutdownAllButton, "关闭所有终端", true);
            ConfigureButton(restartAllButton, "重启所有终端", true);
            Button[] buttons = { reloadButton, shutdownButton, restartButton, shutdownAllButton, restartAllButton };
            int x = 22;
            foreach (Button button in buttons)
            {
                button.Location = new Point(x, 14);
                button.Size = new Size(button == reloadButton ? 145 : 150, 44);
                actions.Controls.Add(button);
                x += button.Width + 12;
            }
            shutdownAllButton.Left += 28;
            restartAllButton.Left += 28;
            reloadButton.Click += async delegate { await SendSelectedCommand("reload", "刷新界面"); };
            shutdownButton.Click += async delegate { await SendSelectedCommand("shutdown", "关机"); };
            restartButton.Click += async delegate { await SendSelectedCommand("restart", "重启"); };
            shutdownAllButton.Click += async delegate { await SendBatchCommand("shutdown", "关闭"); };
            restartAllButton.Click += async delegate { await SendBatchCommand("restart", "重启"); };
        }

        private void ConfigureButton(Button button, string label, bool destructive)
        {
            button.Text = label;
            button.FlatStyle = FlatStyle.Flat;
            button.FlatAppearance.BorderSize = 1;
            button.FlatAppearance.BorderColor = destructive ? danger : accent;
            button.BackColor = destructive ? Color.FromArgb(55, 30, 31) : Color.FromArgb(20, 64, 64);
            button.ForeColor = text;
            button.Cursor = Cursors.Hand;
            button.Font = new Font(Font.FontFamily, 10F, FontStyle.Bold);
        }

        private void BuildStatus()
        {
            StatusStrip strip = new StatusStrip { BackColor = panelStrong, ForeColor = muted, SizingGrip = false };
            statusLabel.Text = "准备就绪";
            strip.Items.Add(statusLabel);
            Controls.Add(strip);
        }

        private TerminalRow SelectedTerminal()
        {
            if (grid.SelectedRows.Count == 0) return null;
            return grid.SelectedRows[0].DataBoundItem as TerminalRow;
        }

        private void UpdateActionState()
        {
            TerminalRow selected = SelectedTerminal();
            reloadButton.Enabled = !busy && selected != null && selected.Online && selected.AllowReload;
            shutdownButton.Enabled = !busy && selected != null && selected.Online && selected.AllowPower;
            restartButton.Enabled = !busy && selected != null && selected.Online && selected.AllowPower;
            shutdownAllButton.Enabled = !busy && connected && rows.Exists(delegate(TerminalRow row) { return row.Online && row.AllowPower; });
            restartAllButton.Enabled = shutdownAllButton.Enabled;
            refreshButton.Enabled = !busy && connected;
            connectButton.Enabled = !busy;
        }

        private async Task ConnectAndRefresh()
        {
            if (busy) return;
            SetBusy(true, "正在连接 MES……");
            try
            {
                string server = serverText.Text;
                string user = usernameText.Text;
                string password = passwordText.Text;
                await Task.Run(delegate
                {
                    client.Configure(server);
                    client.Login(user, password);
                });
                connected = true;
                refreshTimer.Start();
                await LoadRows();
                statusLabel.Text = "连接成功；终端状态每 5 秒自动刷新";
            }
            catch (Exception exception)
            {
                connected = false;
                refreshTimer.Stop();
                ShowError("连接失败", exception.Message);
            }
            finally
            {
                SetBusy(false, statusLabel.Text);
            }
        }

        private async Task RefreshTerminals(bool showErrors)
        {
            if (!connected || busy) return;
            SetBusy(true, "正在刷新终端状态……");
            try
            {
                await LoadRows();
                statusLabel.Text = "状态已刷新：" + DateTime.Now.ToString("HH:mm:ss");
            }
            catch (Exception exception)
            {
                if (showErrors) ShowError("刷新失败", exception.Message);
                else statusLabel.Text = "自动刷新失败，将在下一周期重试：" + exception.Message;
            }
            finally
            {
                SetBusy(false, statusLabel.Text);
            }
        }

        private async Task LoadRows()
        {
            List<TerminalRow> loaded = await Task.Run(delegate { return client.ListTerminals(); });
            rows = loaded;
            grid.DataSource = null;
            grid.DataSource = rows;
            int online = rows.FindAll(delegate(TerminalRow row) { return row.Online; }).Count;
            summaryLabel.Text = "在线 " + online + " / 共 " + rows.Count + " 台";
            UpdateActionState();
        }

        private async Task SendSelectedCommand(string action, string label)
        {
            TerminalRow selected = SelectedTerminal();
            if (selected == null || busy) return;
            if (action != "reload" && MessageBox.Show(
                "确定要" + label + "终端 " + (selected.IpAddress.Length > 0 ? selected.IpAddress : selected.TerminalName) + " 吗？",
                "确认远程" + label,
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Warning
            ) != DialogResult.Yes) return;
            SetBusy(true, "正在下发" + label + "命令……");
            try
            {
                await Task.Run(delegate { client.QueueCommand(selected.TerminalId, action); });
                statusLabel.Text = "已向 " + (selected.IpAddress.Length > 0 ? selected.IpAddress : selected.TerminalName) + " 下发" + label + "命令";
                await LoadRows();
            }
            catch (Exception exception)
            {
                ShowError("命令下发失败", exception.Message);
            }
            finally
            {
                SetBusy(false, statusLabel.Text);
            }
        }

        private async Task SendBatchCommand(string action, string label)
        {
            if (busy) return;
            if (MessageBox.Show(
                "确定要" + label + "所有在线且已授权的终端吗？\n\n未授权或离线终端不会收到命令。",
                "确认批量" + label,
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Warning
            ) != DialogResult.Yes) return;
            SetBusy(true, "正在批量下发命令……");
            try
            {
                int count = await Task.Run(delegate { return client.QueueBatch(action); });
                statusLabel.Text = "已向 " + count + " 台终端下发" + label + "命令";
                await LoadRows();
            }
            catch (Exception exception)
            {
                ShowError("批量命令下发失败", exception.Message);
            }
            finally
            {
                SetBusy(false, statusLabel.Text);
            }
        }

        private void SetBusy(bool value, string message)
        {
            busy = value;
            if (!String.IsNullOrWhiteSpace(message)) statusLabel.Text = message;
            UseWaitCursor = value;
            UpdateActionState();
        }

        private void ShowError(string title, string message)
        {
            statusLabel.Text = title + "：" + message;
            MessageBox.Show(message, title, MessageBoxButtons.OK, MessageBoxIcon.Error);
        }

        internal bool ValidateDockLayout()
        {
            PerformLayout();
            return grid.Top >= 130 && grid.Bottom <= ClientSize.Height - 90;
        }
    }

    internal static class Program
    {
        [STAThread]
        private static int Main(string[] args)
        {
            if (args.Length > 0 && String.Equals(args[0], "--self-test", StringComparison.OrdinalIgnoreCase))
            {
                try
                {
                    TerminalManagerClient.NormalizeServerUrl("http://mes-server:5173");
                    using (ManagerForm form = new ManagerForm())
                    {
                        return form.ValidateDockLayout() ? 0 : 3;
                    }
                }
                catch
                {
                    return 2;
                }
            }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new ManagerForm());
            return 0;
        }
    }
}
