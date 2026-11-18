using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace MESControlCenter
{
    // These opaque desktop colours follow the shared web theme tokens. Theme
    // changes update existing controls so connections and unsaved edits survive.
    internal static class Theme
    {
        private sealed class Palette
        {
            internal Color Background, Sidebar, Surface, SurfaceStrong, SurfaceRaised;
            internal Color Border, BorderStrong, Text, Muted, Subtle;
            internal Color Accent, AccentStrong, AccentSoft, OnAccent;
            internal Color Warning, WarningSoft, Danger, DangerSoft;
            internal Color Alternate, DisabledSurface, DisabledText, Overlay;
        }

        private static Color Hex(int rgb) { return Color.FromArgb((rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255); }
        private static readonly Palette Dark = new Palette {
            Background = Hex(0x06090D), Sidebar = Hex(0x0A0F15), Surface = Hex(0x0D1218),
            SurfaceStrong = Hex(0x131A22), SurfaceRaised = Hex(0x202C36),
            Border = Hex(0x233D3C), BorderStrong = Hex(0x3B6C64),
            Text = Hex(0xEDFDF9), Muted = Hex(0xA7C0BB), Subtle = Hex(0x94AEA9),
            Accent = Hex(0x63E6BE), AccentStrong = Hex(0x63E6BE), AccentSoft = Hex(0x173A33),
            OnAccent = Hex(0x06221D), Warning = Hex(0xE7B75F), WarningSoft = Hex(0x382D1D),
            Danger = Hex(0xFF8B7E), DangerSoft = Hex(0x3E2425), Alternate = Hex(0x10171F),
            DisabledSurface = Hex(0x1B242F), DisabledText = Hex(0x98ADA9), Overlay = Hex(0x080E14)
        };
        private static readonly Palette Light = new Palette {
            Background = Hex(0xF4F7FC), Sidebar = Hex(0xEAF0FA), Surface = Color.White,
            SurfaceStrong = Hex(0xEDF3FC), SurfaceRaised = Hex(0xE4EDFC),
            Border = Hex(0xCCD9F1), BorderStrong = Hex(0x9EB8EC),
            Text = Hex(0x172B4D), Muted = Hex(0x52647D), Subtle = Hex(0x5D6F87),
            Accent = Hex(0x2563EB), AccentStrong = Hex(0x2563EB), AccentSoft = Hex(0xE5EEFF),
            OnAccent = Color.White, Warning = Hex(0x8D5D0B), WarningSoft = Hex(0xFFF4DF),
            Danger = Hex(0xB9362E), DangerSoft = Hex(0xFFF0EF), Alternate = Hex(0xF0F5FD),
            DisabledSurface = Hex(0xE1E9F5), DisabledText = Hex(0x5D6C82), Overlay = Hex(0xDCE4F1)
        };
        private static readonly Palette Legacy = new Palette {
            Background = Hex(0x071014), Sidebar = Hex(0x09161B), Surface = Hex(0x0C191F),
            SurfaceStrong = Hex(0x11242B), SurfaceRaised = Hex(0x173039),
            Border = Hex(0x24434B), BorderStrong = Hex(0x35616A),
            Text = Hex(0xEDF7F6), Muted = Hex(0x9CB3B6), Subtle = Hex(0x6F8B8F),
            Accent = Hex(0x52D0B5), AccentStrong = Hex(0x2CA989), AccentSoft = Hex(0x123D38),
            OnAccent = Hex(0x041B17), Warning = Hex(0xE0A85A), WarningSoft = Hex(0x3B2C19),
            Danger = Hex(0xEC746B), DangerSoft = Hex(0x421F20), Alternate = Hex(0x0A1C21),
            DisabledSurface = Hex(0x1B242F), DisabledText = Hex(0x98ADA9), Overlay = Hex(0x070E13)
        };
        private static bool dark = true;
        private static readonly ConditionalWeakTable<ComboBox, object> StyledCombos = new ConditionalWeakTable<ComboBox, object>();
        private static Palette Current { get { return dark ? Dark : Light; } }
        internal static bool IsDark { get { return dark; } }
        internal static Color Background { get { return Current.Background; } }
        internal static Color Sidebar { get { return Current.Sidebar; } }
        internal static Color Surface { get { return Current.Surface; } }
        internal static Color SurfaceStrong { get { return Current.SurfaceStrong; } }
        internal static Color SurfaceRaised { get { return Current.SurfaceRaised; } }
        internal static Color Border { get { return Current.Border; } }
        internal static Color BorderStrong { get { return Current.BorderStrong; } }
        internal static Color Text { get { return Current.Text; } }
        internal static Color Muted { get { return Current.Muted; } }
        internal static Color Subtle { get { return Current.Subtle; } }
        internal static Color Accent { get { return Current.Accent; } }
        internal static Color AccentStrong { get { return Current.AccentStrong; } }
        internal static Color AccentSoft { get { return Current.AccentSoft; } }
        internal static Color OnAccent { get { return Current.OnAccent; } }
        internal static Color Warning { get { return Current.Warning; } }
        internal static Color WarningSoft { get { return Current.WarningSoft; } }
        internal static Color Danger { get { return Current.Danger; } }
        internal static Color DangerSoft { get { return Current.DangerSoft; } }
        internal static Color AlternateSurface { get { return Current.Alternate; } }
        internal static Color DisabledSurface { get { return Current.DisabledSurface; } }
        internal static Color DisabledText { get { return Current.DisabledText; } }
        internal static Color Selection { get { return Current.AccentSoft; } }
        internal static Color SelectionText { get { return Current.Text; } }

        private static string PreferencePath
        {
            get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MesFastApiLauncher", "ControlCenter", "theme.txt"); }
        }

        internal static void LoadPreference()
        {
            dark = true;
            try { if (File.Exists(PreferencePath)) dark = !String.Equals(File.ReadAllText(PreferencePath).Trim(), "light", StringComparison.OrdinalIgnoreCase); }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }

        internal static void Toggle(Control root)
        {
            Palette previous = Current;
            dark = !dark;
            ApplyCore(root, previous);
            try {
                Directory.CreateDirectory(Path.GetDirectoryName(PreferencePath));
                File.WriteAllText(PreferencePath, dark ? "dark" : "light");
            }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }

        internal static void Apply(Control root) { ApplyCore(root, Current); }

        private static bool Same(Color a, Color b) { return !a.IsEmpty && !b.IsEmpty && a.ToArgb() == b.ToArgb(); }
        private static Color Map(Color value, Palette from, Palette to, bool foreground)
        {
            if (value.IsEmpty || value.A == 0) return value;
            if (foreground && Same(value, from.OnAccent)) return to.OnAccent;
            Color[] before = { from.Background, from.Sidebar, from.Surface, from.SurfaceStrong, from.SurfaceRaised,
                from.Border, from.BorderStrong, from.Text, from.Muted, from.Subtle, from.Accent, from.AccentStrong,
                from.AccentSoft, from.Warning, from.WarningSoft, from.Danger, from.DangerSoft, from.Alternate,
                from.DisabledSurface, from.DisabledText, from.Overlay };
            Color[] after = { to.Background, to.Sidebar, to.Surface, to.SurfaceStrong, to.SurfaceRaised,
                to.Border, to.BorderStrong, to.Text, to.Muted, to.Subtle, to.Accent, to.AccentStrong,
                to.AccentSoft, to.Warning, to.WarningSoft, to.Danger, to.DangerSoft, to.Alternate,
                to.DisabledSurface, to.DisabledText, to.Overlay };
            for (int index = 0; index < before.Length; index++) if (Same(value, before[index])) return after[index];
            return value;
        }

        private static Color ConvertColor(Color value, Palette from, bool foreground)
        {
            Color mapped = Map(value, from, Current, foreground);
            if (!Same(mapped, value)) return mapped;
            // Current tokens have priority over legacy aliases, including white
            // on a light primary button versus the light surface background.
            if (IsToken(value, Current, foreground)) return value;
            mapped = Map(value, Legacy, Current, foreground);
            if (foreground && (Same(value, Color.FromArgb(4, 27, 23)) || Same(value, Color.FromArgb(6, 34, 29)))) return OnAccent;
            if (foreground && (Same(value, SystemColors.ControlText) || Same(value, Color.Black))) return Text;
            if (!foreground && Same(value, SystemColors.Control)) return Surface;
            return mapped;
        }

        private static bool IsToken(Color value, Palette palette, bool foreground)
        {
            Palette other = Object.ReferenceEquals(palette, Dark) ? Light : Dark;
            return !Same(Map(value, palette, other, foreground), value);
        }

        private static void ApplyCore(Control root, Palette previous)
        {
            if (root == null || root.IsDisposed) return;
            root.SuspendLayout();
            try { ApplyControl(root, previous); }
            finally { root.ResumeLayout(true); }
            root.Invalidate(true);
        }

        private static void ApplyControl(Control control, Palette previous)
        {
            Color originalBackground = control.BackColor;
            control.BackColor = ConvertColor(control.BackColor, previous, false);
            control.ForeColor = ConvertColor(control.ForeColor, previous, true);
            Button button = control as Button;
            if (button != null) {
                button.UseVisualStyleBackColor = false;
                button.FlatAppearance.BorderColor = ConvertColor(button.FlatAppearance.BorderColor, previous, false);
                button.FlatAppearance.MouseOverBackColor = ConvertColor(button.FlatAppearance.MouseOverBackColor, previous, false);
                button.FlatAppearance.MouseDownBackColor = ConvertColor(button.FlatAppearance.MouseDownBackColor, previous, false);
            }
            LinkLabel link = control as LinkLabel;
            if (link != null) {
                link.LinkColor = Accent; link.ActiveLinkColor = Accent; link.VisitedLinkColor = Accent;
                link.DisabledLinkColor = DisabledText;
            }
            ComboBox combo = control as ComboBox;
            if (combo != null) StyleCombo(combo);
            TextBoxBase input = control as TextBoxBase;
            if (input != null && (Same(originalBackground, SystemColors.Window) || Same(originalBackground, SystemColors.Control)))
                input.BackColor = SurfaceStrong;
            DataGridView grid = control as DataGridView;
            if (grid != null) {
                foreach (DataGridViewRow row in grid.Rows) {
                    if (row.HasDefaultCellStyle) {
                        DataGridViewCellStyle rowStyle = new DataGridViewCellStyle(row.DefaultCellStyle);
                        TranslateStyle(rowStyle, previous); row.DefaultCellStyle = rowStyle;
                    }
                    foreach (DataGridViewCell cell in row.Cells) if (cell.HasStyle) {
                        DataGridViewCellStyle cellStyle = new DataGridViewCellStyle(cell.Style);
                        TranslateStyle(cellStyle, previous); cell.Style = cellStyle;
                    }
                }
                foreach (DataGridViewColumn column in grid.Columns) {
                    DataGridViewCellStyle columnStyle = new DataGridViewCellStyle(column.DefaultCellStyle);
                    TranslateStyle(columnStyle, previous); column.DefaultCellStyle = columnStyle;
                }
                DataGridViewCellStyle templateStyle = new DataGridViewCellStyle(grid.RowTemplate.DefaultCellStyle);
                TranslateStyle(templateStyle, previous); grid.RowTemplate.DefaultCellStyle = templateStyle;
                StyleGrid(grid);
            }
            ToolStrip strip = control as ToolStrip;
            if (strip != null) StyleStrip(strip, previous);
            if (control.ContextMenuStrip != null) StyleStrip(control.ContextMenuStrip, previous);
            foreach (Control child in control.Controls) ApplyControl(child, previous);
        }

        private static void TranslateStyle(DataGridViewCellStyle style, Palette previous)
        {
            if (!style.BackColor.IsEmpty) style.BackColor = ConvertColor(style.BackColor, previous, false);
            if (!style.ForeColor.IsEmpty) style.ForeColor = ConvertColor(style.ForeColor, previous, true);
            if (!style.SelectionBackColor.IsEmpty) style.SelectionBackColor = Selection;
            if (!style.SelectionForeColor.IsEmpty) style.SelectionForeColor = SelectionText;
        }

        internal static void StyleGrid(DataGridView grid)
        {
            grid.BackgroundColor = Surface;
            grid.BorderStyle = BorderStyle.None;
            grid.EnableHeadersVisualStyles = false;
            grid.GridColor = Border;
            grid.CellBorderStyle = DataGridViewCellBorderStyle.SingleHorizontal;
            grid.ColumnHeadersBorderStyle = DataGridViewHeaderBorderStyle.None;
            grid.RowHeadersBorderStyle = DataGridViewHeaderBorderStyle.None;
            // Assign complete styles through their setters. The Framework grid
            // can return a merged default-style value; mutating that temporary
            // leaves an explicitly configured default style on the old theme.
            DataGridViewCellStyle header = new DataGridViewCellStyle(grid.ColumnHeadersDefaultCellStyle);
            header.BackColor = SurfaceStrong; header.ForeColor = Muted;
            header.SelectionBackColor = SurfaceStrong; header.SelectionForeColor = Text;
            grid.ColumnHeadersDefaultCellStyle = header;
            DataGridViewCellStyle body = new DataGridViewCellStyle(grid.DefaultCellStyle);
            body.BackColor = Surface; body.ForeColor = Text;
            body.SelectionBackColor = Selection; body.SelectionForeColor = SelectionText;
            grid.DefaultCellStyle = body;
            DataGridViewCellStyle rows = new DataGridViewCellStyle(grid.RowsDefaultCellStyle);
            rows.BackColor = Surface; rows.ForeColor = Text;
            rows.SelectionBackColor = Selection; rows.SelectionForeColor = SelectionText;
            grid.RowsDefaultCellStyle = rows;
            DataGridViewCellStyle alternate = new DataGridViewCellStyle(grid.AlternatingRowsDefaultCellStyle);
            alternate.BackColor = AlternateSurface; alternate.ForeColor = Text;
            alternate.SelectionBackColor = Selection; alternate.SelectionForeColor = SelectionText;
            grid.AlternatingRowsDefaultCellStyle = alternate;
            DataGridViewCellStyle rowHeader = new DataGridViewCellStyle(grid.RowHeadersDefaultCellStyle);
            rowHeader.BackColor = SurfaceStrong; rowHeader.ForeColor = Text;
            rowHeader.SelectionBackColor = Selection; rowHeader.SelectionForeColor = SelectionText;
            grid.RowHeadersDefaultCellStyle = rowHeader;
            grid.Invalidate();
        }

        private static void StyleCombo(ComboBox combo)
        {
            combo.BackColor = SurfaceStrong; combo.ForeColor = Text;
            combo.FlatStyle = FlatStyle.Flat;
            object marker;
            if (StyledCombos.TryGetValue(combo, out marker)) return;
            StyledCombos.Add(combo, new object());
            combo.DrawMode = DrawMode.OwnerDrawFixed;
            combo.ItemHeight = Math.Max(combo.ItemHeight, combo.Font.Height + 8);
            combo.DrawItem += delegate(object sender, DrawItemEventArgs args) {
                ComboBox owner = (ComboBox)sender;
                bool selected = (args.State & DrawItemState.Selected) != 0;
                Color background = !owner.Enabled ? DisabledSurface : selected ? Selection : SurfaceStrong;
                Color foreground = !owner.Enabled ? DisabledText : Text;
                using (SolidBrush brush = new SolidBrush(background)) args.Graphics.FillRectangle(brush, args.Bounds);
                string label = args.Index >= 0 && args.Index < owner.Items.Count ? owner.GetItemText(owner.Items[args.Index]) : owner.Text;
                Rectangle bounds = Rectangle.Inflate(args.Bounds, -7, 0);
                TextRenderer.DrawText(args.Graphics, label, owner.Font, bounds, foreground,
                    TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix);
                if ((args.State & DrawItemState.Focus) != 0) ControlPaint.DrawFocusRectangle(args.Graphics, Rectangle.Inflate(args.Bounds, -2, -2), Accent, background);
            };
            combo.EnabledChanged += delegate { combo.Invalidate(); };
        }

        private static void StyleStrip(ToolStrip strip, Palette previous)
        {
            strip.Renderer = new ThemeMenuRenderer();
            strip.BackColor = Surface; strip.ForeColor = Text;
            foreach (ToolStripItem item in strip.Items) StyleItem(item, previous);
        }

        private static void StyleItem(ToolStripItem item, Palette previous)
        {
            item.BackColor = Surface;
            item.ForeColor = ConvertColor(item.ForeColor, previous, true);
            ToolStripDropDownItem dropdown = item as ToolStripDropDownItem;
            if (dropdown == null || !dropdown.HasDropDownItems) return;
            dropdown.DropDown.BackColor = Surface;
            dropdown.DropDown.ForeColor = Text;
            dropdown.DropDown.Renderer = new ThemeMenuRenderer();
            foreach (ToolStripItem child in dropdown.DropDownItems) StyleItem(child, previous);
        }

        internal static DialogResult ShowMessage(IWin32Window owner, string body, string title, bool confirm, bool error)
        {
            using (Form dialog = new Form()) {
                dialog.Text = title; dialog.StartPosition = owner == null ? FormStartPosition.CenterScreen : FormStartPosition.CenterParent;
                dialog.FormBorderStyle = FormBorderStyle.FixedDialog; dialog.MinimizeBox = false; dialog.MaximizeBox = false;
                dialog.ShowInTaskbar = false; dialog.BackColor = Background; dialog.ForeColor = Text;
                dialog.Font = new Font("Microsoft YaHei UI", 9.5F); dialog.ClientSize = new Size(540, 310);
                TableLayoutPanel layout = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(24), ColumnCount = 1, RowCount = 3, BackColor = Surface };
                layout.RowStyles.Add(new RowStyle(SizeType.AutoSize)); layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100)); layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 58));
                Label heading = new Label { Text = title, AutoSize = true, Dock = DockStyle.Top, Margin = new Padding(0, 0, 0, 16), ForeColor = error ? Danger : Text, Font = new Font(dialog.Font, FontStyle.Bold) };
                TextBox text = new TextBox { Text = body ?? "", ReadOnly = true, Multiline = true, ScrollBars = ScrollBars.Vertical, BorderStyle = BorderStyle.None, Dock = DockStyle.Fill, BackColor = Surface, ForeColor = Text, TabStop = false };
                FlowLayoutPanel actions = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.RightToLeft, WrapContents = false, Padding = new Padding(0, 14, 0, 0), Margin = new Padding(0) };
                ThemeButton accept = new ThemeButton { Text = confirm ? "确认" : "知道了", Size = new Size(112, 40), BackColor = error && confirm ? DangerSoft : AccentStrong, ForeColor = error && confirm ? Danger : OnAccent, DialogResult = confirm ? DialogResult.OK : DialogResult.OK };
                actions.Controls.Add(accept);
                if (confirm) {
                    ThemeButton cancel = new ThemeButton { Text = "取消", Size = new Size(112, 40), Margin = new Padding(0, 0, 12, 0), BackColor = SurfaceStrong, ForeColor = Text, DialogResult = DialogResult.Cancel };
                    actions.Controls.Add(cancel); dialog.CancelButton = cancel; dialog.AcceptButton = cancel;
                    dialog.Shown += delegate { cancel.Focus(); };
                }
                else { dialog.AcceptButton = accept; dialog.CancelButton = accept; }
                layout.Controls.Add(heading, 0, 0); layout.Controls.Add(text, 0, 1); layout.Controls.Add(actions, 0, 2); dialog.Controls.Add(layout);
                return owner == null ? dialog.ShowDialog() : dialog.ShowDialog(owner);
            }
        }

        internal static Color Blend(Color from, Color toward, float amount)
        {
            return Color.FromArgb((int)(from.R + (toward.R - from.R) * amount), (int)(from.G + (toward.G - from.G) * amount), (int)(from.B + (toward.B - from.B) * amount));
        }
    }

    internal sealed class ThemeMenuRenderer : ToolStripProfessionalRenderer
    {
        internal ThemeMenuRenderer() : base(new ThemeMenuColors()) { RoundedEdges = false; }
        protected override void OnRenderItemText(ToolStripItemTextRenderEventArgs e)
        {
            e.TextColor = e.Item.Enabled ? e.Item.ForeColor : Theme.DisabledText;
            base.OnRenderItemText(e);
        }
        protected override void OnRenderArrow(ToolStripArrowRenderEventArgs e)
        {
            e.ArrowColor = e.Item.Enabled ? Theme.Muted : Theme.DisabledText;
            base.OnRenderArrow(e);
        }
        protected override void OnRenderSeparator(ToolStripSeparatorRenderEventArgs e)
        {
            using (Pen pen = new Pen(Theme.Border)) e.Graphics.DrawLine(pen, 12, e.Item.Height / 2, e.Item.Width - 12, e.Item.Height / 2);
        }
        private sealed class ThemeMenuColors : ProfessionalColorTable
        {
            public override Color ToolStripDropDownBackground { get { return Theme.Surface; } }
            public override Color ImageMarginGradientBegin { get { return Theme.Surface; } }
            public override Color ImageMarginGradientMiddle { get { return Theme.Surface; } }
            public override Color ImageMarginGradientEnd { get { return Theme.Surface; } }
            public override Color MenuBorder { get { return Theme.BorderStrong; } }
            public override Color MenuItemBorder { get { return Theme.Accent; } }
            public override Color MenuItemSelected { get { return Theme.Selection; } }
            public override Color MenuItemSelectedGradientBegin { get { return Theme.Selection; } }
            public override Color MenuItemSelectedGradientEnd { get { return Theme.Selection; } }
            public override Color MenuItemPressedGradientBegin { get { return Theme.SurfaceStrong; } }
            public override Color MenuItemPressedGradientMiddle { get { return Theme.SurfaceStrong; } }
            public override Color MenuItemPressedGradientEnd { get { return Theme.SurfaceStrong; } }
        }
    }

    internal class ThemeButton : Button
    {
        private bool hovered, pressed;
        internal ThemeButton()
        {
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
            FlatStyle = FlatStyle.Flat; UseVisualStyleBackColor = false; FlatAppearance.BorderSize = 1;
            FlatAppearance.BorderColor = Theme.BorderStrong;
            BackColor = Theme.SurfaceStrong; ForeColor = Theme.Text; Cursor = Cursors.Hand;
            MinimumSize = new Size(64, 36); Padding = new Padding(12, 0, 12, 0);
        }
        public override Size GetPreferredSize(Size proposedSize)
        {
            Size measured = TextRenderer.MeasureText(Text, Font, Size.Empty, TextFormatFlags.SingleLine | TextFormatFlags.NoPrefix);
            return new Size(Math.Max(MinimumSize.Width, Math.Max(88, measured.Width + Padding.Horizontal + 12 + (Image == null ? 0 : Image.Width + 8))),
                Math.Max(MinimumSize.Height, Math.Max(40, measured.Height + Padding.Vertical + 18)));
        }
        protected override void OnMouseEnter(EventArgs e) { hovered = true; base.OnMouseEnter(e); Invalidate(); }
        protected override void OnMouseLeave(EventArgs e) { hovered = false; pressed = false; base.OnMouseLeave(e); Invalidate(); }
        protected override void OnMouseDown(MouseEventArgs e) { if (e.Button == MouseButtons.Left) pressed = true; base.OnMouseDown(e); Invalidate(); }
        protected override void OnMouseUp(MouseEventArgs e) { pressed = false; base.OnMouseUp(e); Invalidate(); }
        protected override void OnKeyDown(KeyEventArgs e) { if (e.KeyCode == Keys.Space) pressed = true; base.OnKeyDown(e); Invalidate(); }
        protected override void OnKeyUp(KeyEventArgs e) { pressed = false; base.OnKeyUp(e); Invalidate(); }
        protected override void OnGotFocus(EventArgs e) { base.OnGotFocus(e); Invalidate(); }
        protected override void OnLostFocus(EventArgs e) { pressed = false; base.OnLostFocus(e); Invalidate(); }
        protected override void OnEnabledChanged(EventArgs e) { hovered = pressed = false; base.OnEnabledChanged(e); Invalidate(); }
        protected override void OnPaintBackground(PaintEventArgs e) { }
        protected override void OnPaint(PaintEventArgs e)
        {
            e.Graphics.Clear(Parent == null ? Theme.Surface : Parent.BackColor);
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            Color background = Enabled ? BackColor : Theme.DisabledSurface;
            Color foreground = Enabled ? ForeColor : Theme.DisabledText;
            if (Enabled && pressed) background = Theme.Blend(background, Theme.IsDark ? Color.Black : Theme.Text, 0.16F);
            else if (Enabled && hovered) background = Theme.Blend(background, Theme.IsDark ? Color.White : Theme.Text, 0.08F);
            Rectangle rectangle = new Rectangle(0, 0, Math.Max(1, Width - 1), Math.Max(1, Height - 1));
            using (GraphicsPath path = Rounded(rectangle, Math.Max(4, Font.Height / 3))) {
                using (SolidBrush fill = new SolidBrush(background)) e.Graphics.FillPath(fill, path);
                if (!Enabled || FlatAppearance.BorderSize > 0) using (Pen border = new Pen(!Enabled ? Theme.Border : FlatAppearance.BorderColor.IsEmpty ? Theme.BorderStrong : FlatAppearance.BorderColor)) e.Graphics.DrawPath(border, path);
            }
            Rectangle content = Rectangle.FromLTRB(Padding.Left + 2, Padding.Top + 2, Width - Padding.Right - 2, Height - Padding.Bottom - 2);
            if (Image != null) {
                int imageY = Math.Max(0, (Height - Image.Height) / 2);
                if (Enabled) e.Graphics.DrawImage(Image, content.Left, imageY, Image.Width, Image.Height);
                else ControlPaint.DrawImageDisabled(e.Graphics, Image, content.Left, imageY, background);
                content.X += Image.Width + 8; content.Width = Math.Max(1, content.Width - Image.Width - 8);
            }
            TextFormatFlags flags = TextFormatFlags.VerticalCenter | TextFormatFlags.NoPrefix | TextFormatFlags.WordBreak | TextFormatFlags.NoPadding;
            if (TextAlign == ContentAlignment.MiddleLeft || TextAlign == ContentAlignment.TopLeft || TextAlign == ContentAlignment.BottomLeft) flags |= TextFormatFlags.Left;
            else if (TextAlign == ContentAlignment.MiddleRight || TextAlign == ContentAlignment.TopRight || TextAlign == ContentAlignment.BottomRight) flags |= TextFormatFlags.Right;
            else flags |= TextFormatFlags.HorizontalCenter;
            TextRenderer.DrawText(e.Graphics, Text, Font, content, foreground, flags);
            if (Focused && ShowFocusCues) using (GraphicsPath focus = Rounded(Rectangle.Inflate(rectangle, -3, -3), 3)) using (Pen pen = new Pen(Theme.Accent, 1.5F)) e.Graphics.DrawPath(pen, focus);
        }
        internal static GraphicsPath Rounded(Rectangle rectangle, int radius)
        {
            GraphicsPath path = new GraphicsPath();
            int diameter = Math.Max(2, Math.Min(radius * 2, Math.Min(rectangle.Width, rectangle.Height)));
            path.AddArc(rectangle.Left, rectangle.Top, diameter, diameter, 180, 90);
            path.AddArc(rectangle.Right - diameter, rectangle.Top, diameter, diameter, 270, 90);
            path.AddArc(rectangle.Right - diameter, rectangle.Bottom - diameter, diameter, diameter, 0, 90);
            path.AddArc(rectangle.Left, rectangle.Bottom - diameter, diameter, diameter, 90, 90); path.CloseFigure(); return path;
        }
    }

    internal class ThemeTextBox : TextBox
    {
        internal ThemeTextBox() { BorderStyle = BorderStyle.FixedSingle; }
        protected override void OnEnabledChanged(EventArgs e)
        {
            SetStyle(ControlStyles.UserPaint, !Enabled);
            base.OnEnabledChanged(e); Invalidate();
        }
        protected override void OnPaint(PaintEventArgs e)
        {
            if (Enabled) { base.OnPaint(e); return; }
            e.Graphics.Clear(Theme.DisabledSurface);
            string value = UseSystemPasswordChar ? new string('\u25CF', TextLength) : PasswordChar == '\0' ? Text : new string(PasswordChar, TextLength);
            TextFormatFlags flags = TextFormatFlags.VerticalCenter | TextFormatFlags.NoPrefix | TextFormatFlags.EndEllipsis;
            if (TextAlign == HorizontalAlignment.Center) flags |= TextFormatFlags.HorizontalCenter;
            else if (TextAlign == HorizontalAlignment.Right) flags |= TextFormatFlags.Right;
            TextRenderer.DrawText(e.Graphics, value, Font, Rectangle.Inflate(ClientRectangle, -3, 0), Theme.DisabledText, flags);
        }
        protected override void WndProc(ref Message message)
        {
            base.WndProc(ref message);
            if (BorderStyle == BorderStyle.None) return;
            if (message.Msg == 0x000F || message.Msg == 0x0085) {
                IntPtr dc = ThemeNative.GetWindowDC(Handle);
                if (dc == IntPtr.Zero) return;
                try { using (Graphics graphics = Graphics.FromHdc(dc)) PaintBorder(graphics); }
                finally { ThemeNative.ReleaseDC(Handle, dc); }
            }
            else if (message.Msg == 0x0317 && message.WParam != IntPtr.Zero)
                using (Graphics graphics = Graphics.FromHdc(message.WParam)) PaintBorder(graphics);
        }
        private void PaintBorder(Graphics graphics)
        {
            using (Pen border = new Pen(Enabled ? Focused ? Theme.Accent : Theme.BorderStrong : Theme.Border))
                graphics.DrawRectangle(border, 0, 0, Math.Max(0, Width - 1), Math.Max(0, Height - 1));
        }
        protected override void OnGotFocus(EventArgs e) { base.OnGotFocus(e); Invalidate(); }
        protected override void OnLostFocus(EventArgs e) { base.OnLostFocus(e); Invalidate(); }
    }

    internal class ThemeComboBox : ComboBox
    {
        internal ThemeComboBox()
        {
            FlatStyle = FlatStyle.Flat;
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
        }
        public override Size GetPreferredSize(Size proposedSize)
        {
            Size preferred = base.GetPreferredSize(proposedSize);
            preferred.Width = Math.Max(preferred.Width, MinimumSize.Width);
            preferred.Height = Math.Max(MinimumSize.Height, Math.Max(preferred.Height, Math.Max(Height, ItemHeight + 8)));
            return preferred;
        }
        protected override void OnPaintBackground(PaintEventArgs e) { }
        protected override void OnPaint(PaintEventArgs e)
        {
            e.Graphics.Clear(Enabled ? Theme.SurfaceStrong : Theme.DisabledSurface);
            Rectangle text = new Rectangle(7, 1, Math.Max(1, Width - 36), Math.Max(1, Height - 2));
            TextRenderer.DrawText(e.Graphics, SelectedItem == null ? Text : GetItemText(SelectedItem), Font, text, Enabled ? Theme.Text : Theme.DisabledText,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPrefix | TextFormatFlags.EndEllipsis);
            PaintChrome(e.Graphics);
        }
        protected override void WndProc(ref Message message)
        {
            base.WndProc(ref message);
            if (DropDownStyle == ComboBoxStyle.Simple) return;
            if (message.Msg == 0x000F || message.Msg == 0x0085) {
                IntPtr dc = ThemeNative.GetWindowDC(Handle);
                if (dc == IntPtr.Zero) return;
                try { using (Graphics graphics = Graphics.FromHdc(dc)) PaintChrome(graphics); }
                finally { ThemeNative.ReleaseDC(Handle, dc); }
            }
            else if ((message.Msg == 0x0317 || message.Msg == 0x0318) && message.WParam != IntPtr.Zero)
                using (Graphics graphics = Graphics.FromHdc(message.WParam)) PaintChrome(graphics);
        }
        private void PaintChrome(Graphics graphics)
        {
            int arrowWidth = Math.Max(22, SystemInformation.VerticalScrollBarWidth + 6);
            Rectangle arrow = new Rectangle(Math.Max(1, Width - arrowWidth), 1, arrowWidth - 1, Math.Max(1, Height - 2));
            using (SolidBrush fill = new SolidBrush(Enabled ? Theme.SurfaceStrong : Theme.DisabledSurface)) graphics.FillRectangle(fill, arrow);
            int centerX = arrow.Left + arrow.Width / 2, centerY = arrow.Top + arrow.Height / 2;
            using (SolidBrush mark = new SolidBrush(Enabled ? Theme.Muted : Theme.DisabledText))
                graphics.FillPolygon(mark, new Point[] { new Point(centerX - 4, centerY - 2), new Point(centerX + 4, centerY - 2), new Point(centerX, centerY + 3) });
            using (Pen border = new Pen(Enabled ? Focused ? Theme.Accent : Theme.BorderStrong : Theme.Border))
                graphics.DrawRectangle(border, 0, 0, Math.Max(0, Width - 1), Math.Max(0, Height - 1));
        }
        protected override void OnEnabledChanged(EventArgs e) { base.OnEnabledChanged(e); Invalidate(); }
        protected override void OnGotFocus(EventArgs e) { base.OnGotFocus(e); Invalidate(); }
        protected override void OnLostFocus(EventArgs e) { base.OnLostFocus(e); Invalidate(); }
        protected override void OnDropDownClosed(EventArgs e) { base.OnDropDownClosed(e); Invalidate(); }
        protected override void OnSelectedIndexChanged(EventArgs e) { base.OnSelectedIndexChanged(e); Invalidate(); }
        protected override void OnTextChanged(EventArgs e) { base.OnTextChanged(e); Invalidate(); }
    }

    internal static class ThemeNative
    {
        [DllImport("user32.dll")] internal static extern IntPtr GetWindowDC(IntPtr handle);
        [DllImport("user32.dll")] internal static extern int ReleaseDC(IntPtr handle, IntPtr dc);
    }

    internal class ThemeTabControl : TabControl
    {
        internal ThemeTabControl()
        {
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
            DrawMode = TabDrawMode.OwnerDrawFixed; Padding = new Point(18, 10); ItemSize = new Size(170, 42);
        }
        protected override void OnSelectedIndexChanged(EventArgs e) { base.OnSelectedIndexChanged(e); Invalidate(); }
        protected override void OnPaintBackground(PaintEventArgs e) { e.Graphics.Clear(Theme.Background); }
        protected override void OnPaint(PaintEventArgs e)
        {
            e.Graphics.Clear(Theme.Background);
            for (int index = 0; index < TabCount; index++) {
                Rectangle bounds = GetTabRect(index);
                bool selected = index == SelectedIndex;
                using (SolidBrush brush = new SolidBrush(selected ? Theme.AccentSoft : Theme.Surface)) e.Graphics.FillRectangle(brush, bounds);
                TextRenderer.DrawText(e.Graphics, TabPages[index].Text, Font, Rectangle.Inflate(bounds, -10, 0), selected ? Theme.Accent : Theme.Muted,
                    TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPrefix);
                if (selected) using (Pen line = new Pen(Theme.Accent, 3)) e.Graphics.DrawLine(line, bounds.Left + 12, bounds.Bottom - 2, bounds.Right - 12, bounds.Bottom - 2);
                if (selected && Focused && ShowFocusCues) ControlPaint.DrawFocusRectangle(e.Graphics, Rectangle.Inflate(bounds, -5, -5), Theme.Accent, Theme.AccentSoft);
            }
        }
    }
}
