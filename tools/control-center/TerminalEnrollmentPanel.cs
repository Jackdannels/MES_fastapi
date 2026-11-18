using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Drawing;
using System.Globalization;
using System.Threading.Tasks;
using System.Windows.Forms;
using MESTerminalManager;

namespace MESControlCenter
{
    internal sealed class TerminalEnrollmentPanel : UserControl
    {
        private sealed class StationChoice
        {
            internal string Id;
            internal string Label;
            public override string ToString() { return Label; }
        }

        private readonly TerminalManagerClient client;
        private readonly DataGridView grid = new DataGridView();
        private readonly ComboBox station = new ThemeComboBox();
        private readonly CheckBox history = new CheckBox();
        private readonly Label summary = new Label();
        private readonly Label selectionSummary = new Label();
        private readonly Panel tableHost = new Panel();
        private readonly Panel empty = new Panel();
        private readonly FlowLayoutPanel emptyContent = new FlowLayoutPanel();
        private readonly Label emptyTitle = new Label();
        private readonly Label emptyDescription = new Label();
        private readonly ThemeButton retry;
        private readonly ThemeButton emptyRetry;
        private readonly ThemeButton approve;
        private readonly ThemeButton deny;
        private readonly ToolTip tips = new ToolTip();
        private readonly Action changed;
        private List<Dictionary<string, object>> requests = new List<Dictionary<string, object>>();
        private bool busy;
        private bool binding;
        private bool loadedOnce;
        private string loadError = "";
        private string selectedRequest = "";
        internal Action<int> PendingChanged;

        internal TerminalEnrollmentPanel(TerminalManagerClient manager, Action onChanged)
        {
            client = manager; changed = onChanged; Dock = DockStyle.Fill; BackColor = Theme.Background;
            FlowLayoutPanel header = new FlowLayoutPanel {
                Dock = DockStyle.Top, AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink,
                WrapContents = true, BackColor = Theme.Surface, Padding = new Padding(14, 10, 14, 8), Margin = Padding.Empty
            };
            history.AutoSize = true; history.Text = "显示已处理与重置记录"; history.ForeColor = Theme.Muted;
            history.Margin = new Padding(0, 7, 18, 7);
            history.CheckedChanged += delegate { if (!binding) BindRows(); };
            summary.AutoSize = true; summary.ForeColor = Theme.Muted; summary.Margin = new Padding(0, 7, 12, 7);
            summary.MaximumSize = new Size(560, 0); summary.Text = "连接管理员账号后查看申请";
            retry = Button("重新读取", Theme.SurfaceStrong, Theme.Text);
            retry.Visible = false; retry.MinimumSize = new Size(96, 38); retry.Margin = Padding.Empty;
            retry.Click += async delegate { await RefreshRequests(); };
            header.Controls.AddRange(new Control[] { history, summary, retry });
            header.SizeChanged += delegate {
                summary.MaximumSize = new Size(Math.Max(180, Math.Min(560, header.ClientSize.Width - header.Padding.Horizontal - 24)), 0);
            };

            TableLayoutPanel bottom = new TableLayoutPanel {
                Dock = DockStyle.Bottom, AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink,
                BackColor = Theme.Surface, ColumnCount = 1, RowCount = 2, Padding = new Padding(14, 10, 14, 10), Margin = Padding.Empty
            };
            bottom.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100F));
            bottom.RowStyles.Add(new RowStyle(SizeType.AutoSize)); bottom.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            selectionSummary.AutoSize = true; selectionSummary.ForeColor = Theme.Muted;
            selectionSummary.Margin = new Padding(0, 0, 0, 8); selectionSummary.Text = "选择申请后，可分配工位并审批。";
            bottom.Controls.Add(selectionSummary, 0, 0);
            FlowLayoutPanel actions = new FlowLayoutPanel {
                Dock = DockStyle.Fill, AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink,
                WrapContents = true, Margin = Padding.Empty, BackColor = Theme.Surface
            };
            FlowLayoutPanel stationGroup = new FlowLayoutPanel {
                AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, WrapContents = false,
                Margin = new Padding(0, 0, 12, 4), BackColor = Theme.Surface
            };
            Label label = new Label { AutoSize = true, Text = "分配工位", ForeColor = Theme.Muted, Margin = new Padding(0, 11, 12, 0) };
            station.Width = 260; station.DropDownStyle = ComboBoxStyle.DropDownList; station.FlatStyle = FlatStyle.Flat;
            station.BackColor = Theme.SurfaceStrong; station.ForeColor = Theme.Text; station.Margin = new Padding(0, 7, 0, 0);
            stationGroup.Controls.AddRange(new Control[] { label, station });
            approve = Button("批准绑定", Theme.AccentStrong, Theme.OnAccent);
            deny = Button("拒绝申请", Theme.SurfaceStrong, Theme.Text);
            approve.Click += async delegate { await Review(true); };
            deny.Click += async delegate { await Review(false); };
            actions.Controls.AddRange(new Control[] { stationGroup, approve, deny });
            bottom.Controls.Add(actions, 0, 1);
            bottom.SizeChanged += delegate {
                selectionSummary.MaximumSize = new Size(Math.Max(160, bottom.ClientSize.Width - bottom.Padding.Horizontal), 0);
                station.Width = Math.Max(150, Math.Min(260, bottom.ClientSize.Width - bottom.Padding.Horizontal - label.PreferredWidth - 24));
            };

            grid.Font = new Font("Microsoft YaHei UI", 10F);
            grid.Dock = DockStyle.Fill; grid.ReadOnly = true; grid.MultiSelect = false; grid.AllowUserToAddRows = false;
            grid.AllowUserToDeleteRows = false; grid.AllowUserToResizeRows = false; grid.RowHeadersVisible = false;
            grid.SelectionMode = DataGridViewSelectionMode.FullRowSelect; grid.AutoGenerateColumns = false;
            grid.AutoSizeColumnsMode = DataGridViewAutoSizeColumnsMode.Fill;
            grid.ColumnHeadersHeight = 42; grid.ColumnHeadersHeightSizeMode = DataGridViewColumnHeadersHeightSizeMode.DisableResizing;
            grid.RowTemplate.Height = 48; grid.DefaultCellStyle.Padding = new Padding(8, 0, 8, 0);
            grid.DefaultCellStyle.WrapMode = DataGridViewTriState.False;
            grid.ColumnHeadersDefaultCellStyle.Padding = new Padding(8, 0, 8, 0);
            AddColumn("申请编号", "requestCode", 15, 96);
            AddColumn("电脑名称", "machineName", 19, 108);
            AddColumn("当前 IP", "ipAddress", 16, 108);
            AddColumn("申请工位", "stationLabel", 21, 116);
            AddColumn("状态", "statusLabel", 18, 112);
            AddColumn("申请时间", "createdAt", 17, 112);
            grid.Columns["createdAt"].DefaultCellStyle.Format = "MM月dd日 HH:mm";
            grid.Columns["ipAddress"].DefaultCellStyle.Font = new Font("Consolas", Font.Size);
            Theme.StyleGrid(grid);
            grid.CellFormatting += FormatCell;
            grid.SelectionChanged += delegate { if (!binding) Selection(); };

            tableHost.Dock = DockStyle.Fill; tableHost.BackColor = Theme.Surface; empty.BackColor = Theme.Surface;
            emptyContent.FlowDirection = FlowDirection.TopDown; emptyContent.WrapContents = false;
            emptyContent.AutoSize = true; emptyContent.AutoSizeMode = AutoSizeMode.GrowAndShrink;
            emptyContent.BackColor = Theme.Surface; emptyContent.Padding = new Padding(18);
            emptyTitle.AutoSize = true; emptyTitle.ForeColor = Theme.Text;
            emptyTitle.Font = new Font(Font.FontFamily, 12F, FontStyle.Bold); emptyTitle.Margin = new Padding(0, 0, 0, 10);
            emptyDescription.AutoSize = true; emptyDescription.ForeColor = Theme.Muted; emptyDescription.Margin = new Padding(0, 0, 0, 14);
            emptyRetry = Button("重新读取申请", Theme.AccentSoft, Theme.Accent);
            emptyRetry.Click += async delegate { await RefreshRequests(); };
            emptyContent.Controls.AddRange(new Control[] { emptyTitle, emptyDescription, emptyRetry });
            empty.Controls.Add(emptyContent); tableHost.Controls.Add(grid); tableHost.Controls.Add(empty);
            tableHost.SizeChanged += delegate { LayoutEmptyState(); };
            emptyContent.SizeChanged += delegate { CenterEmptyContent(); };
            Controls.Add(tableHost); Controls.Add(bottom); Controls.Add(header);
            Selection(); UpdatePresentation();
        }

        private static ThemeButton Button(string text, Color background, Color foreground)
        {
            return new ThemeButton { Text = text, AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink,
                MinimumSize = new Size(120, 42), Padding = new Padding(14, 6, 14, 6),
                Margin = new Padding(0, 0, 8, 4), BackColor = background, ForeColor = foreground, Cursor = Cursors.Hand };
        }

        private void AddColumn(string title, string name, float weight, int minimum)
        {
            grid.Columns.Add(new DataGridViewTextBoxColumn {
                HeaderText = title, Name = name, FillWeight = weight, MinimumWidth = minimum,
                AutoSizeMode = DataGridViewAutoSizeColumnMode.Fill, SortMode = DataGridViewColumnSortMode.Automatic
            });
        }

        private static string TextOf(Dictionary<string, object> row, string key)
        {
            object value; return row.TryGetValue(key, out value) ? Convert.ToString(value) : "";
        }

        private Dictionary<string, object> CurrentRequest()
        {
            return grid.CurrentRow == null ? null : grid.CurrentRow.Tag as Dictionary<string, object>;
        }

        private string StationLabel(string id)
        {
            foreach (StationChoice choice in station.Items) if (choice.Id == id) return choice.Label;
            return id;
        }

        private void SelectStation(string id)
        {
            station.SelectedIndex = -1;
            foreach (StationChoice choice in station.Items)
                if (choice.Id == id) { station.SelectedItem = choice; break; }
        }

        private static string StatusLabel(string value)
        {
            switch (value) { case "pending": return "待审批"; case "approved": return "已批准，待领取"; case "issued": return "已绑定";
                case "denied": return "已拒绝"; case "reset": return "已重置，待重新申请"; case "deleted": return "已删除"; case "expired": return "已过期"; default: return value; }
        }

        private static object LocalTime(string value)
        {
            DateTimeOffset parsed;
            return DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out parsed)
                ? (object)parsed.LocalDateTime : null;
        }

        private void FormatCell(object sender, DataGridViewCellFormattingEventArgs args)
        {
            if (args.RowIndex < 0) return;
            if (grid.Columns[args.ColumnIndex].Name == "createdAt" && args.Value == null) {
                args.Value = "—"; args.FormattingApplied = true; return;
            }
            if (grid.Columns[args.ColumnIndex].Name != "statusLabel") return;
            Dictionary<string, object> row = grid.Rows[args.RowIndex].Tag as Dictionary<string, object>;
            if (row == null) return;
            string status = TextOf(row, "status");
            args.CellStyle.ForeColor = status == "pending" || status == "reset" ? Theme.Warning
                : status == "approved" || status == "issued" ? Theme.Accent
                : status == "denied" ? Theme.Danger : Theme.Muted;
            args.CellStyle.SelectionForeColor = args.CellStyle.ForeColor;
        }

        internal async Task RefreshRequests()
        {
            if (busy) return;
            busy = true; Selection(); UpdatePresentation();
            try
            {
                List<Dictionary<string, object>> catalog = await Task.Run(delegate { return client.EnrollmentItems("catalog"); });
                List<Dictionary<string, object>> loaded = await Task.Run(delegate { return client.EnrollmentItems("requests"); });
                if (IsDisposed) return;
                Dictionary<string, object> current = CurrentRequest();
                string preferredRequest = current == null ? "" : TextOf(current, "requestId");
                StationChoice preferred = station.SelectedItem as StationChoice;
                string preferredStation = preferred == null ? "" : preferred.Id;
                station.Items.Clear();
                foreach (Dictionary<string, object> item in catalog) station.Items.Add(new StationChoice { Id = TextOf(item, "id"), Label = TextOf(item, "label") });
                requests = loaded; loadedOnce = true; loadError = "";
                BindRows(preferredRequest, preferredStation);
                int count = requests.FindAll(delegate(Dictionary<string, object> row) { return TextOf(row, "status") == "pending"; }).Count;
                if (PendingChanged != null) PendingChanged(count);
            }
            catch (Exception error) { if (!IsDisposed) loadError = error.Message; }
            finally { busy = false; if (!IsDisposed) { Selection(); UpdatePresentation(); } }
        }

        private void BindRows()
        {
            Dictionary<string, object> row = CurrentRequest();
            StationChoice choice = station.SelectedItem as StationChoice;
            BindRows(row == null ? "" : TextOf(row, "requestId"), choice == null ? "" : choice.Id);
        }

        private void BindRows(string preferredRequest, string preferredStation)
        {
            DataGridViewColumn sorted = grid.SortedColumn;
            SortOrder direction = grid.SortOrder;
            int firstIndex = grid.FirstDisplayedScrollingRowIndex;
            string firstId = "";
            if (firstIndex >= 0 && firstIndex < grid.Rows.Count) {
                Dictionary<string, object> first = grid.Rows[firstIndex].Tag as Dictionary<string, object>;
                if (first != null) firstId = TextOf(first, "requestId");
            }
            binding = true; grid.SuspendLayout();
            try
            {
                grid.Rows.Clear();
                foreach (Dictionary<string, object> row in requests)
                {
                    if (!history.Checked && TextOf(row, "status") != "pending") continue;
                    object created = LocalTime(TextOf(row, "createdAt"));
                    int index = grid.Rows.Add(TextOf(row, "requestCode"), TextOf(row, "machineName"), TextOf(row, "ipAddress"),
                        StationLabel(TextOf(row, "requestedStation")), StatusLabel(TextOf(row, "status")), created);
                    DataGridViewRow added = grid.Rows[index]; added.Tag = row;
                    foreach (DataGridViewCell cell in added.Cells) cell.ToolTipText = Convert.ToString(cell.Value);
                    added.Cells["createdAt"].ToolTipText = created is DateTime ? ((DateTime)created).ToString("yyyy年MM月dd日 HH:mm:ss") : TextOf(row, "createdAt");
                }
                if (sorted != null && direction != SortOrder.None)
                    grid.Sort(sorted, direction == SortOrder.Descending ? ListSortDirection.Descending : ListSortDirection.Ascending);
                DataGridViewRow target = null; int restoredFirst = -1;
                foreach (DataGridViewRow row in grid.Rows) {
                    Dictionary<string, object> item = row.Tag as Dictionary<string, object>;
                    if (item == null) continue;
                    if (TextOf(item, "requestId") == preferredRequest) target = row;
                    if (TextOf(item, "requestId") == firstId) restoredFirst = row.Index;
                }
                if (target == null && grid.Rows.Count > 0) target = grid.Rows[0];
                if (target != null) grid.CurrentCell = target.Cells[0];
                if (grid.Rows.Count > 0 && firstIndex >= 0 && grid.DisplayedRowCount(false) > 0)
                    grid.FirstDisplayedScrollingRowIndex = restoredFirst >= 0 ? restoredFirst : Math.Min(firstIndex, grid.Rows.Count - 1);
                Dictionary<string, object> selected = CurrentRequest();
                selectedRequest = selected == null ? "" : TextOf(selected, "requestId");
                SelectStation(selectedRequest == preferredRequest && preferredStation.Length > 0
                    ? preferredStation : selected == null ? "" : TextOf(selected, "requestedStation"));
            }
            finally { grid.ResumeLayout(); binding = false; }
            Selection(); UpdatePresentation();
        }

        private void Selection()
        {
            Dictionary<string, object> row = CurrentRequest();
            bool pending = row != null && TextOf(row, "status") == "pending";
            approve.Enabled = deny.Enabled = !busy && pending;
            station.Enabled = !busy && pending; history.Enabled = !busy;
            if (row != null && selectedRequest != TextOf(row, "requestId")) {
                selectedRequest = TextOf(row, "requestId"); SelectStation(TextOf(row, "requestedStation"));
            }
            if (row == null) selectedRequest = "";
            selectionSummary.Text = row == null ? "选择申请后，可分配工位并审批。"
                : "已选：" + TextOf(row, "machineName") + "  ·  申请编号：" + TextOf(row, "requestCode")
                    + (pending ? "  ·  请核对后批准绑定" : "  ·  " + StatusLabel(TextOf(row, "status")));
            tips.SetToolTip(selectionSummary, selectionSummary.Text);
        }

        private void UpdatePresentation()
        {
            if (busy) summary.Text = "正在读取申请，请稍候……";
            else if (loadError.Length > 0) summary.Text = "申请读取失败" + (loadedOnce ? "，已保留上次数据" : "，请重试");
            else if (!loadedOnce) summary.Text = "连接管理员账号后查看申请";
            else {
                int count = requests.FindAll(delegate(Dictionary<string, object> row) { return TextOf(row, "status") == "pending"; }).Count;
                summary.Text = count + " 项待审批 · 请核对电脑名称与申请编号";
            }
            summary.ForeColor = loadError.Length > 0 && !busy ? Theme.Danger : Theme.Muted;
            tips.SetToolTip(summary, loadError.Length > 0 ? loadError : summary.Text);
            retry.Visible = loadError.Length > 0; retry.Enabled = !busy;
            empty.Visible = grid.Rows.Count == 0;
            if (empty.Visible) {
                if (busy) { emptyTitle.Text = "正在读取绑定申请"; emptyDescription.Text = "正在获取工作机申请和工位信息，请稍候。"; }
                else if (loadError.Length > 0) {
                    emptyTitle.Text = "暂时无法读取申请";
                    emptyDescription.Text = "请检查 MES 连接和管理员登录状态，然后重新读取。\n" + (loadError.Length > 180 ? loadError.Substring(0, 180) + "…" : loadError);
                }
                else if (!loadedOnce) { emptyTitle.Text = "连接后查看绑定申请"; emptyDescription.Text = "请先连接管理员账号，再查看并审批工作机的接入申请。"; }
                else { emptyTitle.Text = history.Checked ? "暂无申请记录" : "当前没有待审批申请"; emptyDescription.Text = history.Checked
                    ? "工作机通过局域网发起申请后，会显示在这里。"
                    : "工作机通过局域网发起申请后，会显示在这里。\n可勾选“显示已处理与重置记录”查看历史申请。"; }
                emptyRetry.Visible = loadError.Length > 0 && !busy;
                tips.SetToolTip(emptyDescription, loadError); empty.BringToFront(); LayoutEmptyState();
            }
        }

        private void LayoutEmptyState()
        {
            int headerHeight = grid.ColumnHeadersVisible ? grid.ColumnHeadersHeight : 0;
            empty.SetBounds(0, headerHeight, tableHost.ClientSize.Width, Math.Max(0, tableHost.ClientSize.Height - headerHeight));
            int textWidth = Math.Max(160, Math.Min(560, empty.ClientSize.Width - 64));
            emptyTitle.MaximumSize = new Size(textWidth, 0); emptyDescription.MaximumSize = new Size(textWidth, 0);
            CenterEmptyContent();
        }

        private void CenterEmptyContent()
        {
            emptyContent.Location = new Point(Math.Max(0, (empty.ClientSize.Width - emptyContent.Width) / 2), Math.Max(12, (empty.ClientSize.Height - emptyContent.Height) / 2));
        }

        private async Task Review(bool accepted)
        {
            Dictionary<string, object> row = CurrentRequest();
            StationChoice selected = station.SelectedItem as StationChoice;
            if (busy || row == null || (accepted && selected == null)) return;
            string text = accepted ? "确认将 " + TextOf(row, "machineName") + " 分配为“" + selected.Label + "”？\n申请编号：" + TextOf(row, "requestCode") : "确认拒绝这项申请？";
            if (Theme.ShowMessage(this, text, "终端绑定审批", true, false) != DialogResult.OK) return;
            busy = true; Selection(); summary.Text = "正在提交审批结果……";
            try
            {
                await Task.Run(delegate { client.EnrollmentAction("requests/" + Uri.EscapeDataString(TextOf(row, "requestId")) + "/review",
                    new Dictionary<string, object> { { "approve", accepted }, { "stationId", selected == null ? "" : selected.Id } }); });
                summary.Text = accepted ? "已批准，工作机将自动领取授权并生成文件夹。" : "已拒绝申请。";
                changed();
            }
            catch (Exception error) { Theme.ShowMessage(this, error.Message, "审批失败", false, true); }
            finally { busy = false; }
            await RefreshRequests();
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing) tips.Dispose();
            base.Dispose(disposing);
        }
    }
}
