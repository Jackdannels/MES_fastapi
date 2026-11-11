using System;
using System.Collections.Generic;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace MESControlCenter
{
    internal sealed class ConfigurationField
    {
        public string Key { get; set; }
        public string Label { get; set; }
        public string Group { get; set; }
        public string Kind { get; set; }
        public string Default { get; set; }
        public bool Secret { get; set; }
        public bool Docker { get; set; }
        public bool Important { get; set; }
        public bool DockerOnly { get; set; }
        public string Description { get; set; }
        public string ReadOnlyReason { get; set; }
        public Dictionary<string, double> Limits { get; set; }

        internal void Validate(string value)
        {
            string error = null;
            if (value.IndexOfAny(new[] { '\r', '\n', '\0' }) >= 0) error = "请使用单行配置值";
            double number;
            int integer;
            if (Kind == "bool" && value != "true" && value != "false") error = "请选择 true 或 false";
            if (Kind == "int" && !Int32.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out integer)) error = "请输入整数";
            if (Kind == "int" || Kind == "number")
            {
                if (!Double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out number) || Double.IsNaN(number) || Double.IsInfinity(number)) error = "请输入有效数字";
                else if (Limits != null)
                    foreach (KeyValuePair<string, double> limit in Limits)
                        if ((limit.Key == "ge" && number < limit.Value) || (limit.Key == "gt" && number <= limit.Value)
                            || (limit.Key == "le" && number > limit.Value) || (limit.Key == "lt" && number >= limit.Value)) error = "数值超出允许范围";
            }
            if (Key == "RABBITMQ_URL")
            {
                Uri uri;
                if (!Uri.TryCreate(value, UriKind.Absolute, out uri) || (uri.Scheme != "amqp" && uri.Scheme != "amqps") || uri.Host.Length == 0 || uri.Fragment.Length > 0) error = "请输入有效的 amqp:// 或 amqps:// 地址";
            }
            if (Key == "FRONTEND_ORIGINS" || Key == "MES_FRONTEND_ORIGINS")
            {
                foreach (string origin in value.Split(',')) if (!HttpUrl(origin.Trim(), true)) error = "请填写以逗号分隔的 HTTP(S) 前端地址";
            }
            else if (Key.EndsWith("_URL", StringComparison.Ordinal) && Key != "RABBITMQ_URL" && value.Length > 0 && !(Key == "TEST_DATA_PUBLIC_BASE_URL" && value == "auto"))
            {
                if (!HttpUrl(value, false)) error = "请输入不含账号密码和片段的 HTTP(S) 地址";
                Uri uri;
                if (Key == "LIMS_DATA_PUBLIC_BASE_URL" && Uri.TryCreate(value, UriKind.Absolute, out uri) && uri.Query.Length > 0) error = "数据根地址不能包含查询参数";
            }
            if (Key == "STORAGE_BACKEND" && value != "mysql") error = "当前业务存储仅支持 mysql";
            if (Key == "TEST_DATA_BACKUP_STATE_PATH" && String.IsNullOrWhiteSpace(value)) error = "本地备份队列路径不能为空";
            if ((Key == "MYSQL_HOST" || Key == "MYSQL_USER" || Key == "MYSQL_DATABASE" || Key == "MQTT_HOST" || Key == "MQTT_TOPIC_PREFIX") && String.IsNullOrWhiteSpace(value)) error = "此项不能为空";
            if ((Key == "TEST_DATA_BACKUP_PATH" || Key == "TEST_DATA_BACKUP_STATE_PATH" || Key == "TEST_DATA_SAVE_PATH") && value.Length > 0)
            {
                if (!Regex.IsMatch(value, @"^[A-Za-z]:[\\/]") && !value.StartsWith(@"\\", StringComparison.Ordinal) && !value.StartsWith("/", StringComparison.Ordinal)) error = "请填写绝对路径";
                if (Key == "TEST_DATA_BACKUP_STATE_PATH" && (value.StartsWith(@"\\", StringComparison.Ordinal) || value.StartsWith("//", StringComparison.Ordinal))) error = "备份队列必须保存在本机";
            }
            if (error != null) throw new InvalidOperationException(Label + "（" + Key + "）：" + error + "。");
        }

        private static bool HttpUrl(string value, bool origin)
        {
            Uri uri;
            return Uri.TryCreate(value, UriKind.Absolute, out uri) && (uri.Scheme == "http" || uri.Scheme == "https")
                && uri.Host.Length > 0 && uri.UserInfo.Length == 0 && uri.Fragment.Length == 0
                && (!origin || (uri.AbsolutePath == "/" && uri.Query.Length == 0));
        }
    }

    // Only the configuration boundary is edited. No business services are invoked.
    internal sealed class ConfigurationDocument
    {
        private sealed class Assignment
        {
            internal string Key;
            internal int Start;
            internal int Length;
            internal string Value;
        }

        internal readonly string FilePath;
        internal readonly string Mode;
        internal readonly Dictionary<string, string> Values = new Dictionary<string, string>(StringComparer.Ordinal);
        private readonly byte[] original;
        private readonly string text;
        private readonly Dictionary<string, object> native;
        private readonly List<Assignment> assignments = new List<Assignment>();
        private HashSet<string> dockerKeys;
        private static readonly UTF8Encoding Utf8 = new UTF8Encoding(false, true);

        internal static string Locate(string mode, string runtimeRoot, string desktopRoot)
        {
            if (mode == "development") return Path.Combine(runtimeRoot, ".env");
            string settingsPath = Path.Combine(desktopRoot, "mes-desktop-tools.json");
            Dictionary<string, object> settings = Serializer().Deserialize<Dictionary<string, object>>(File.ReadAllText(settingsPath, Utf8));
            if (mode == "native") return Resolve(desktopRoot, Required(settings, "nativeConfig"));
            string deployment = Resolve(desktopRoot, Required(settings, "deploymentDirectory"));
            return Resolve(deployment, Required(settings, "environmentFile"));
        }

        private static string Required(Dictionary<string, object> values, string key)
        {
            object result;
            if (values == null || !values.TryGetValue(key, out result) || String.IsNullOrWhiteSpace(Convert.ToString(result)))
                throw new InvalidOperationException("桌面部署配置缺少 " + key + "，请先配置安装路径。");
            return Convert.ToString(result);
        }

        private static string Resolve(string root, string path) { return Path.GetFullPath(Path.IsPathRooted(path) ? path : Path.Combine(root, path)); }
        private static JavaScriptSerializer Serializer() { return new JavaScriptSerializer { MaxJsonLength = 4 * 1024 * 1024 }; }

        internal static string DockerTemplates(string desktopRoot)
        {
            Dictionary<string, object> settings = Serializer().Deserialize<Dictionary<string, object>>(File.ReadAllText(Path.Combine(desktopRoot, "mes-desktop-tools.json"), Utf8));
            string root = Resolve(desktopRoot, Required(settings, "deploymentDirectory"));
            string result = File.ReadAllText(Path.Combine(root, "compose.portable.yml"), Utf8);
            object mode;
            if (settings.TryGetValue("mode", out mode) && Convert.ToString(mode) == "demo") result += File.ReadAllText(Path.Combine(root, "compose.portable.simulators.yml"), Utf8);
            return result;
        }

        internal void UseDockerTemplates(string templates)
        {
            dockerKeys = new HashSet<string>(StringComparer.Ordinal);
            foreach (Match match in Regex.Matches(templates, @"\$\{([A-Z][A-Z0-9_]*)")) dockerKeys.Add(match.Groups[1].Value);
        }

        internal ConfigurationDocument(string path, string mode)
        {
            FilePath = Path.GetFullPath(path);
            Mode = mode;
            if (mode != "development" && !File.Exists(FilePath)) throw new FileNotFoundException("未找到实际部署配置文件。", FilePath);
            original = File.Exists(FilePath) ? File.ReadAllBytes(FilePath) : null;
            text = original == null ? "" : Utf8.GetString(original).TrimStart('\uFEFF');
            if (mode == "native")
            {
                native = Serializer().Deserialize<Dictionary<string, object>>(text);
                object environment;
                if (native == null || !native.TryGetValue("environment", out environment) || !(environment is Dictionary<string, object>))
                    throw new InvalidOperationException("原生服务配置中缺少 environment 对象。");
                foreach (KeyValuePair<string, object> item in (Dictionary<string, object>)environment) Values[item.Key] = Convert.ToString(item.Value, CultureInfo.InvariantCulture);
            }
            else ParseEnvironment();
        }

        private void ParseEnvironment()
        {
            MatchCollection starts = Regex.Matches(text, @"(?m)^[ \t]*(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)[ \t]*=[ \t]*");
            int consumed = 0;
            foreach (Match match in starts)
            {
                if (match.Index < consumed) continue;
                int start = match.Index + match.Length;
                int end = start;
                string value;
                if (start < text.Length && (text[start] == '\'' || text[start] == '"'))
                {
                    char quote = text[start];
                    end++;
                    bool closed = false;
                    StringBuilder decoded = new StringBuilder();
                    while (end < text.Length)
                    {
                        char current = text[end++];
                        if (current == quote) { closed = true; break; }
                        if (current == '\\' && end < text.Length)
                        {
                            char next = text[end];
                            if (next == quote || (next == '\\' && (Mode != "docker" || quote == '"'))) { decoded.Append(next); end++; continue; }
                            if (quote == '"' && "nrt".IndexOf(next) >= 0) { decoded.Append(next == 'n' ? '\n' : next == 'r' ? '\r' : '\t'); end++; continue; }
                        }
                        decoded.Append(current);
                    }
                    if (!closed) throw new InvalidOperationException("配置文件中 " + match.Groups[1].Value + " 的引号未闭合，请先修复原文件。");
                    value = decoded.ToString();
                    if (Mode == "docker" && quote == '"') value = value.Replace("$$", "$");
                }
                else
                {
                    while (end < text.Length && text[end] != '\r' && text[end] != '\n') end++;
                    string raw = text.Substring(start, end - start);
                    Match comment = Regex.Match(raw, @"(?:^|[ \t]+)#");
                    if (comment.Success) end = start + comment.Index;
                    while (end > start && Char.IsWhiteSpace(text[end - 1])) end--;
                    value = text.Substring(start, end - start);
                    if (Mode == "docker") value = value.Replace("$$", "$");
                }
                string key = match.Groups[1].Value;
                assignments.Add(new Assignment { Key = key, Start = start, Length = end - start, Value = value });
                Values[key] = value;
                consumed = end;
            }
        }

        internal string Save(Dictionary<string, string> changes)
        {
            if (changes.Count == 0) return "";
            Dictionary<string, ConfigurationField> editable = new Dictionary<string, ConfigurationField>();
            foreach (ConfigurationField field in Fields()) editable[field.Key] = field;
            foreach (KeyValuePair<string, string> change in changes)
            {
                ConfigurationField field;
                if (!editable.TryGetValue(change.Key, out field) || (Mode == "docker" && !field.Docker) || field.ReadOnlyReason != null) throw new InvalidOperationException("此参数需由部署工具管理或尚未接入当前部署：" + change.Key);
                field.Validate(change.Value);
                if (Mode == "development" && change.Value.Contains("${")) throw new InvalidOperationException(field.Label + "：本机 .env 值不能含 ${...} 插值，请使用进程环境变量配置该值。");
            }
            string updated;
            if (Mode == "native")
            {
                // Clone the tree: a failed write must not change the loaded document.
                Dictionary<string, object> copy = Serializer().Deserialize<Dictionary<string, object>>(text);
                Dictionary<string, object> environment = (Dictionary<string, object>)copy["environment"];
                foreach (KeyValuePair<string, string> change in changes) environment[change.Key] = change.Value;
                updated = Serializer().Serialize(copy) + Environment.NewLine;
            }
            else
            {
                updated = text;
                HashSet<string> found = new HashSet<string>(StringComparer.Ordinal);
                for (int i = assignments.Count - 1; i >= 0; i--)
                {
                    Assignment assignment = assignments[i];
                    string value;
                    if (!changes.TryGetValue(assignment.Key, out value)) continue;
                    updated = updated.Remove(assignment.Start, assignment.Length).Insert(assignment.Start, Quote(value));
                    found.Add(assignment.Key);
                }
                string newline = text.Contains("\r\n") ? "\r\n" : "\n";
                foreach (KeyValuePair<string, string> change in changes)
                    if (!found.Contains(change.Key))
                    {
                        if (updated.Length > 0 && !updated.EndsWith("\n", StringComparison.Ordinal)) updated += newline;
                        updated += change.Key + "=" + Quote(change.Value) + newline;
                    }
            }
            string mutexName;
            using (SHA256 hash = SHA256.Create()) mutexName = "Local\\MESConfiguration-" + BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(FilePath.ToUpperInvariant()))).Replace("-", "");
            using (Mutex mutex = new Mutex(false, mutexName))
            {
                bool acquired;
                try { acquired = mutex.WaitOne(5000); } catch (AbandonedMutexException) { acquired = true; }
                if (!acquired) throw new InvalidOperationException("另一个控制中心正在保存配置，请稍后重试。");
                try
                {
                    byte[] current = File.Exists(FilePath) ? File.ReadAllBytes(FilePath) : null;
                    if (!Same(original, current)) throw new InvalidOperationException("配置文件已被其他程序修改。请重新读取后再编辑，避免覆盖其他修改。");
                    string suffix = DateTime.Now.ToString("yyyyMMdd-HHmmss-fff", CultureInfo.InvariantCulture) + "-" + Guid.NewGuid().ToString("N");
                    string temporary = FilePath + ".tmp." + suffix;
                    string backup = original == null ? "" : FilePath + ".bak." + suffix;
                    try
                    {
                        File.WriteAllText(temporary, updated, Utf8);
                        if (original == null) File.Move(temporary, FilePath);
                        else File.Replace(temporary, FilePath, backup);
                    }
                    finally { if (File.Exists(temporary)) File.Delete(temporary); }
                    return backup;
                }
                finally { mutex.ReleaseMutex(); }
            }
        }

        private static bool Same(byte[] left, byte[] right)
        {
            if (left == null || right == null) return left == right;
            if (left.Length != right.Length) return false;
            for (int i = 0; i < left.Length; i++) if (left[i] != right[i]) return false;
            return true;
        }

        private string Quote(string value)
        {
            if (Mode == "docker") return "\"" + value.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("$", "$$") + "\"";
            // python-dotenv's quoted-value matcher can consume the following
            // assignment when a quoted value ends with a backslash. Its raw
            // value form preserves normal Windows paths, including spaces.
            if (value.EndsWith("\\", StringComparison.Ordinal))
            {
                if (value.Trim() == value && !Regex.IsMatch(value, "^[\"']|[ \\t]+#")) return value;
                throw new InvalidOperationException("本机 .env 不支持此值的末尾反斜杠与引号/注释字符组合，请通过进程环境变量配置。");
            }
            return "'" + value.Replace("\\", "\\\\").Replace("'", "\\'") + "'";
        }

        internal List<ConfigurationField> Fields()
        {
            List<ConfigurationField> result;
            using (Stream stream = typeof(ConfigurationDocument).Assembly.GetManifestResourceStream("MESConfigurationSchema.json"))
            using (StreamReader reader = new StreamReader(stream, Utf8))
                result = Serializer().Deserialize<List<ConfigurationField>>(reader.ReadToEnd());
            HashSet<string> known = new HashSet<string>();
            foreach (ConfigurationField field in result)
            {
                known.Add(field.Key);
                if (Mode == "docker" && dockerKeys != null) field.Docker = dockerKeys.Contains(field.Key);
            }
            result.RemoveAll(delegate(ConfigurationField field) { return field.DockerOnly && Mode != "docker"; });
            result.RemoveAll(delegate(ConfigurationField field) { return Mode == "docker" && !field.Docker && !Values.ContainsKey(field.Key); });
            foreach (string key in Values.Keys)
                if (!known.Contains(key)) result.Add(new ConfigurationField { Key = key, Label = key, Group = "部署高级参数", Kind = key.EndsWith("_PORT", StringComparison.Ordinal) ? "int" : "text", Secret = Regex.IsMatch(key, "PASSWORD|TOKEN|SECRET|COOKIE|DSN"), Docker = dockerKeys == null || dockerKeys.Contains(key),
                    Limits = key.EndsWith("_PORT", StringComparison.Ordinal) ? new Dictionary<string, double> { { "ge", 1 }, { "le", 65535 } } : null });
            foreach (ConfigurationField field in result)
                if (Mode == "docker" && Regex.IsMatch(field.Key, @"^(MES_(?:.*_PORT|BIND_ADDRESS|PUBLIC_URL|RELEASE_VERSION|NETWORK_MODE)|COMPOSE_PROJECT_NAME)$|_IMAGE$"))
                    field.ReadOnlyReason = "此项涉及监听端口、客户端地址或安装身份，请通过部署工具同步修改。";
            string[] order = { "数据库", "RabbitMQ / AMQP", "MQTT / 上位机", "HTTP / LIMS", "文件与备份", "登录与会话", "其他参数", "部署高级参数" };
            string[] primary = { "MYSQL_HOST", "MYSQL_PORT", "MYSQL_DATABASE", "MYSQL_USER", "MYSQL_PASSWORD", "RABBITMQ_URL", "MQTT_HOST", "MQTT_PORT", "MQTT_USERNAME", "MQTT_PASSWORD", "MQTT_TOPIC_PREFIX", "LIMS_HTTP_CALLBACK_URL", "LIMS_HEALTH_URL", "LIMS_COMMUNICATION_URL", "LIMS_HTTP_TOKEN" };
            result.Sort(delegate(ConfigurationField left, ConfigurationField right) {
                int comparison = Array.IndexOf(order, left.Group).CompareTo(Array.IndexOf(order, right.Group));
                if (comparison != 0) return comparison;
                int leftPriority = Array.IndexOf(primary, left.Key), rightPriority = Array.IndexOf(primary, right.Key);
                comparison = (leftPriority < 0 ? Int32.MaxValue : leftPriority).CompareTo(rightPriority < 0 ? Int32.MaxValue : rightPriority);
                return comparison == 0 ? String.Compare(left.Key, right.Key, StringComparison.Ordinal) : comparison;
            });
            return result;
        }

        internal List<ConfigurationField> ImportantFields()
        {
            List<ConfigurationField> result = Fields();
            result.RemoveAll(delegate(ConfigurationField field) {
                if (!field.Important) return true;
                if (Mode != "docker") return false;
                // Compose consumes the deployment keys. Show those exact file
                // values instead of synthetic backend defaults or aliases.
                if (field.Key == "MYSQL_USER" && !Values.ContainsKey(field.Key) && Values.ContainsKey("MYSQL_API_USER")) return true;
                if (field.Key == "MYSQL_PASSWORD" && !Values.ContainsKey(field.Key) && Values.ContainsKey("MYSQL_API_PASSWORD")) return true;
                if (field.Key == "MYSQL_API_USER" && Values.ContainsKey("MYSQL_USER")) return true;
                if (field.Key == "MYSQL_API_PASSWORD" && Values.ContainsKey("MYSQL_PASSWORD")) return true;
                return !field.Docker && !Values.ContainsKey(field.Key);
            });
            return result;
        }
    }

    internal sealed class ConfigurationPage : UserControl
    {
        private readonly Func<string> locate;
        private readonly string mode;
        private readonly Func<bool> serviceBusy;
        private readonly Action restart;
        private ConfigurationDocument document;
        private List<ConfigurationField> fields;
        private readonly Dictionary<string, string> changes = new Dictionary<string, string>();
        private readonly DataGridView grid = new DataGridView();
        private readonly ComboBox group = new ComboBox();
        private readonly TextBox search = new TextBox();
        private readonly TextBox editor = new TextBox();
        private readonly ComboBox booleanEditor = new ComboBox();
        private readonly CheckBox reveal = new CheckBox();
        private readonly CheckBox showUnconfigured = new CheckBox();
        private readonly Label detail = new Label();
        private readonly Label status = new Label();
        private readonly Label source = new Label();
        private readonly Button save;
        private readonly Button saveRestart;
        private bool selecting;
        private ConfigurationField selected;
        internal Func<string> ReadDockerTemplates;
        internal bool Dirty { get { return changes.Count > 0; } }

        internal ConfigurationPage(string deploymentMode, Func<string> location, Func<bool> busy, Action restartAction)
        {
            mode = deploymentMode; locate = location; serviceBusy = busy; restart = restartAction;
            Dock = DockStyle.Fill; BackColor = Theme.Background; ForeColor = Theme.Text;
            Panel header = new Panel { Dock = DockStyle.Top, Height = 128, BackColor = Theme.Surface };
            source.SetBounds(16, 12, 800, 25); source.ForeColor = Theme.Muted; source.AutoEllipsis = true;
            Label scope = new Label { Text = "默认显示文件中已有的重要配置；选择一项查看中文说明并修改。", AutoSize = true, ForeColor = Theme.Muted, Location = new Point(16, 43) };
            group.SetBounds(16, 82, 180, 30); group.DropDownStyle = ComboBoxStyle.DropDownList;
            search.SetBounds(210, 82, 260, 30); search.BackColor = Theme.SurfaceStrong; search.ForeColor = Theme.Text;
            search.AccessibleName = "搜索配置名称或配置键";
            Label searchLabel = new Label { Text = "搜索名称 / 用途", AutoSize = true, ForeColor = Theme.Muted, Location = new Point(484, 86) };
            showUnconfigured.SetBounds(630, 80, 230, 32); showUnconfigured.Text = "显示未配置项"; showUnconfigured.ForeColor = Theme.Muted;
            header.Controls.AddRange(new Control[] { source, scope, group, search, searchLabel, showUnconfigured });
            header.Resize += delegate { source.Width = header.Width - 32; };

            Panel bottom = new Panel { Dock = DockStyle.Bottom, Height = 226, BackColor = Theme.Surface };
            detail.SetBounds(16, 12, 800, 38); detail.ForeColor = Theme.Text; detail.AutoEllipsis = true;
            editor.SetBounds(16, 56, 650, 28); editor.BackColor = Theme.SurfaceStrong; editor.ForeColor = Theme.Text; editor.Font = new Font("Consolas", 10F); editor.AccessibleName = "所选配置值";
            booleanEditor.SetBounds(16, 56, 210, 28); booleanEditor.DropDownStyle = ComboBoxStyle.DropDownList; booleanEditor.Items.AddRange(new object[] { "启用（true）", "停用（false）" }); booleanEditor.Visible = false;
            reveal.Text = "显示密码"; reveal.ForeColor = Theme.Muted; reveal.SetBounds(684, 56, 110, 28);
            Label note = new Label { Text = "仅保存实际修改的值；重启后生效。连接密码须与目标服务一致。", ForeColor = Theme.Muted, AutoEllipsis = true, Bounds = new Rectangle(16, 94, 900, 30) };
            save = Button("保存配置", 16, Theme.AccentStrong, Color.FromArgb(4, 27, 23));
            saveRestart = Button("保存并重启", 144, Theme.AccentSoft, Theme.Accent);
            Button reload = Button("重新读取", 272, Theme.SurfaceStrong, Theme.Text);
            save.Click += delegate { SaveChanges(false); };
            saveRestart.Click += delegate { SaveChanges(true); };
            reload.Click += delegate { Reload(true); };
            status.SetBounds(16, 181, 900, 36); status.ForeColor = Theme.Muted; status.AutoEllipsis = true;
            bottom.Controls.AddRange(new Control[] { detail, editor, booleanEditor, reveal, note, save, saveRestart, reload, status });
            bottom.Resize += delegate { detail.Width = status.Width = note.Width = bottom.Width - 32; editor.Width = Math.Max(250, bottom.Width - 164); reveal.Left = bottom.Width - 132; };

            grid.Dock = DockStyle.Fill; grid.BackgroundColor = Theme.Surface; grid.BorderStyle = BorderStyle.None;
            grid.ReadOnly = true; grid.AllowUserToAddRows = false; grid.AllowUserToDeleteRows = false; grid.AllowUserToResizeRows = false;
            grid.RowHeadersVisible = false; grid.MultiSelect = false; grid.SelectionMode = DataGridViewSelectionMode.FullRowSelect;
            grid.AutoGenerateColumns = false; grid.EnableHeadersVisualStyles = false;
            grid.ColumnHeadersDefaultCellStyle.BackColor = Theme.SurfaceStrong; grid.ColumnHeadersDefaultCellStyle.ForeColor = Theme.Muted;
            grid.DefaultCellStyle.BackColor = Theme.Surface; grid.DefaultCellStyle.ForeColor = Theme.Text;
            grid.DefaultCellStyle.SelectionBackColor = Theme.AccentSoft; grid.DefaultCellStyle.SelectionForeColor = Theme.Text;
            grid.GridColor = Theme.BorderStrong; grid.RowTemplate.Height = 54;
            grid.Columns.Add(new DataGridViewTextBoxColumn { Name = "Label", HeaderText = "配置项", Width = 210 });
            grid.Columns.Add(new DataGridViewTextBoxColumn { Name = "Key", HeaderText = "配置键", Visible = false });
            grid.Columns.Add(new DataGridViewTextBoxColumn { Name = "Value", HeaderText = "文件中的值", Width = 220 });
            grid.Columns.Add(new DataGridViewTextBoxColumn { Name = "Description", HeaderText = "中文释义", AutoSizeMode = DataGridViewAutoSizeColumnMode.Fill, MinimumWidth = 240, DefaultCellStyle = new DataGridViewCellStyle { WrapMode = DataGridViewTriState.True } });
            grid.Columns.Add(new DataGridViewTextBoxColumn { Name = "State", HeaderText = "状态", Width = 105 });
            Controls.Add(grid); Controls.Add(bottom); Controls.Add(header);
            group.SelectedIndexChanged += delegate { Filter(); }; search.TextChanged += delegate { Filter(); }; showUnconfigured.CheckedChanged += delegate { Filter(); };
            grid.SelectionChanged += delegate { SelectField(); };
            editor.TextChanged += delegate { Edit(editor.Text); };
            booleanEditor.SelectedIndexChanged += delegate { if (booleanEditor.SelectedIndex >= 0) Edit(booleanEditor.SelectedIndex == 0 ? "true" : "false"); };
            reveal.CheckedChanged += delegate { editor.UseSystemPasswordChar = selected != null && selected.Secret && !reveal.Checked; };
            UpdateButtons();
        }

        private Button Button(string label, int left, Color background, Color foreground)
        {
            Button result = new Button { Text = label, Bounds = new Rectangle(left, 133, 116, 36), FlatStyle = FlatStyle.Flat, BackColor = background, ForeColor = foreground, Cursor = Cursors.Hand };
            result.FlatAppearance.BorderColor = Theme.BorderStrong;
            return result;
        }

        internal void EnsureLoaded() { if (document == null) Reload(false); }

        internal void Reload(bool confirm)
        {
            if (confirm && Dirty && MessageBox.Show(this, "重新读取会丢弃尚未保存的配置修改。是否继续？", "重新读取配置", MessageBoxButtons.OKCancel, MessageBoxIcon.Question, MessageBoxDefaultButton.Button2) != DialogResult.OK) return;
            try
            {
                ConfigurationDocument loaded = new ConfigurationDocument(locate(), mode);
                if (mode == "docker" && ReadDockerTemplates != null) loaded.UseDockerTemplates(ReadDockerTemplates());
                List<ConfigurationField> loadedFields = loaded.ImportantFields();
                document = loaded; fields = loadedFields; changes.Clear();
                source.Text = (mode == "native" ? "原生服务" : mode == "docker" ? "Docker" : "本机开发") + " · " + document.FilePath;
                group.Items.Clear(); group.Items.Add("全部分组");
                foreach (ConfigurationField field in fields) if (!group.Items.Contains(field.Group)) group.Items.Add(field.Group);
                group.SelectedIndex = 0;
                Filter();
                UpdateButtons();
            }
            catch (Exception exception) { status.Text = "读取失败：" + exception.Message; UpdateButtons(); }
        }

        private string Value(ConfigurationField field)
        {
            string value;
            return changes.TryGetValue(field.Key, out value) || document.Values.TryGetValue(field.Key, out value) ? value : "";
        }

        private void Filter()
        {
            if (fields == null) return;
            string key = selected == null ? "" : selected.Key;
            selecting = true;
            grid.Rows.Clear();
            foreach (ConfigurationField field in fields)
            {
                if (group.SelectedIndex > 0 && Convert.ToString(group.SelectedItem) != field.Group) continue;
                if (!showUnconfigured.Checked && !document.Values.ContainsKey(field.Key) && !changes.ContainsKey(field.Key)) continue;
                string query = search.Text.Trim();
                if (query.Length > 0 && (field.Label + " " + field.Key + " " + field.Description).IndexOf(query, StringComparison.OrdinalIgnoreCase) < 0) continue;
                string value = Value(field);
                int row = grid.Rows.Add(field.Label, field.Key, !document.Values.ContainsKey(field.Key) && !changes.ContainsKey(field.Key) ? "未配置" : Display(field, value), field.Description, State(field));
                grid.Rows[row].Tag = field;
                if (field.Key == key) grid.CurrentCell = grid.Rows[row].Cells[0];
            }
            SelectField();
            status.Text = Dirty ? changes.Count + " 项修改尚未保存。" : grid.Rows.Count == 0 ? "没有符合筛选条件的配置。可勾选“显示未配置项”补充重要参数。" : "共显示 " + grid.Rows.Count + " 项重要配置，值来自当前文件；勾选“显示未配置项”可补充参数。";
        }

        private static string Display(ConfigurationField field, string value) { return field.Secret && value.Length > 0 ? "••••••••" : value.Length == 0 ? "（空值）" : field.Kind == "bool" && value == "true" ? "启用（true）" : field.Kind == "bool" && value == "false" ? "停用（false）" : value; }
        private string State(ConfigurationField field) { return field.ReadOnlyReason != null ? "只读" : mode == "docker" && !field.Docker ? "未接入 / 只读" : changes.ContainsKey(field.Key) ? "待保存" : document.Values.ContainsKey(field.Key) ? "已配置" : "未配置"; }

        private void SelectField()
        {
            selecting = true;
            selected = grid.CurrentRow == null ? null : grid.CurrentRow.Tag as ConfigurationField;
            reveal.Checked = false;
            editor.Text = selected == null ? "" : Value(selected);
            bool editable = selected != null && selected.ReadOnlyReason == null && !(mode == "docker" && !selected.Docker);
            editor.Enabled = editable; booleanEditor.Enabled = editable;
            booleanEditor.Visible = selected != null && selected.Kind == "bool"; editor.Visible = !booleanEditor.Visible;
            string raw = selected == null ? "" : Value(selected);
            booleanEditor.SelectedIndex = raw == "true" ? 0 : raw == "false" ? 1 : -1;
            reveal.Visible = selected != null && selected.Secret;
            editor.UseSystemPasswordChar = selected != null && selected.Secret;
            detail.Text = selected == null ? "选择一个配置项进行编辑" : selected.Label + "  ·  " + selected.Key + "\n" + (editable ? selected.Description : selected.ReadOnlyReason ?? "当前 Compose 未传入此参数，请先升级部署文件。");
            selecting = false;
        }

        private void Edit(string value)
        {
            if (selecting || selected == null || document == null || selected.ReadOnlyReason != null || (mode == "docker" && !selected.Docker)) return;
            string originalValue;
            bool present = document.Values.TryGetValue(selected.Key, out originalValue);
            if (value == (present ? originalValue : "")) changes.Remove(selected.Key);
            else changes[selected.Key] = value;
            if (grid.CurrentRow != null) { grid.CurrentRow.Cells["Value"].Value = Display(selected, value); grid.CurrentRow.Cells["State"].Value = State(selected); }
            status.Text = Dirty ? changes.Count + " 项修改尚未保存。" : "没有待保存修改。";
            UpdateButtons();
        }

        private void UpdateButtons() { save.Enabled = saveRestart.Enabled = document != null && Dirty; }

        private void SaveChanges(bool andRestart)
        {
            if (document == null || !Dirty) return;
            if (serviceBusy()) { status.Text = "正在执行服务操作，请完成后再保存。"; return; }
            try
            {
                string backup = document.Save(changes);
                Reload(false);
                status.Text = "已保存，重启系统后生效。" + (backup.Length > 0 ? "备份：" + backup : "");
                if (andRestart) restart();
            }
            catch (Exception exception) { status.Text = "保存失败：" + exception.Message; MessageBox.Show(this, status.Text, "系统配置", MessageBoxButtons.OK, MessageBoxIcon.Error); }
        }
    }
}
