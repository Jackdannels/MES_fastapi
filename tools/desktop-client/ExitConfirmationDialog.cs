using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace MESDesktopClient
{
    internal sealed class ExitConfirmationDialog : Form
    {
        private readonly bool light;
        private readonly Button cancel;
        private readonly Button confirm;
        [DllImport("dwmapi.dll")] private static extern int DwmSetWindowAttribute(IntPtr window, int attribute, ref int value, int size);

        internal ExitConfirmationDialog(bool lightTheme) : this(lightTheme, "中控", true) { }

        internal ExitConfirmationDialog(bool lightTheme, string clientTitle, bool central)
        {
            light = lightTheme;
            Text = central ? "关闭中控界面" : "关闭" + clientTitle + "界面";
            FormBorderStyle = FormBorderStyle.FixedDialog;
            StartPosition = FormStartPosition.CenterParent;
            MaximizeBox = false; MinimizeBox = false; ShowInTaskbar = false;
            ClientSize = new Size(500, 276);
            AutoScaleMode = AutoScaleMode.Dpi;
            Font = new Font("Microsoft YaHei UI", 10F);
            BackColor = light ? Color.White : Color.FromArgb(19, 26, 34);
            ForeColor = light ? Color.FromArgb(23, 43, 77) : Color.FromArgb(237, 253, 249);
            Color muted = light ? Color.FromArgb(82, 100, 125) : Color.FromArgb(139, 169, 164);
            Color inset = light ? Color.FromArgb(239, 244, 252) : Color.FromArgb(13, 18, 24);
            Color accent = light ? Color.FromArgb(37, 99, 235) : Color.FromArgb(99, 230, 190);
            Label heading = new Label { Text = central ? "确定关闭中控界面吗？" : "确定关闭当前界面吗？", AutoSize = false,
                Location = new Point(24, 24), Size = new Size(452, 32), Font = new Font(Font.FontFamily, 15F, FontStyle.Bold) };
            Label description = new Label { Text = "后台服务与正在进行的实验继续运行。", ForeColor = muted,
                Location = new Point(24, 68), Size = new Size(452, 28) };
            Panel note = new Panel { BackColor = inset, Location = new Point(24, 108), Size = new Size(452, 72), Padding = new Padding(14) };
            Label guidance = new Label { Dock = DockStyle.Fill, ForeColor = muted,
                Text = central ? "MES 控制中心会保留。\n需要再次进入时，点击“打开中控管理”。"
                    : "需要再次进入时，重新打开本文件夹中的程序。\n关闭界面不会停止 MES 系统服务。" };
            note.Controls.Add(guidance);
            Panel divider = new Panel { BackColor = light ? Color.FromArgb(218, 228, 244) : Color.FromArgb(44, 68, 72),
                Location = new Point(24, 202), Size = new Size(452, 1) };
            cancel = new Button { Text = "取消", DialogResult = DialogResult.Cancel, FlatStyle = FlatStyle.Flat,
                BackColor = inset, ForeColor = ForeColor, Location = new Point(236, 220), Size = new Size(104, 40), TabIndex = 0 };
            cancel.FlatAppearance.BorderColor = light ? Color.FromArgb(196, 210, 232) : Color.FromArgb(64, 93, 97);
            confirm = new Button { Text = "关闭界面", DialogResult = DialogResult.OK, FlatStyle = FlatStyle.Flat,
                BackColor = accent, ForeColor = light ? Color.White : Color.FromArgb(7, 18, 22),
                Location = new Point(352, 220), Size = new Size(124, 40), TabIndex = 1 };
            confirm.FlatAppearance.BorderSize = 0;
            Controls.AddRange(new Control[] { heading, description, note, divider, cancel, confirm });
            AcceptButton = cancel;
            CancelButton = cancel;
            Shown += delegate { cancel.Focus(); };
        }

        protected override void OnHandleCreated(EventArgs args)
        {
            base.OnHandleCreated(args);
            try
            {
                int dark = light ? 0 : 1;
                DwmSetWindowAttribute(Handle, 20, ref dark, sizeof(int));
                int caption = ColorTranslator.ToWin32(BackColor);
                int text = ColorTranslator.ToWin32(ForeColor);
                DwmSetWindowAttribute(Handle, 35, ref caption, sizeof(int));
                DwmSetWindowAttribute(Handle, 36, ref text, sizeof(int));
            }
            catch (DllNotFoundException) { }
            catch (EntryPointNotFoundException) { }
        }

        internal static bool Confirm(IWin32Window owner, bool lightTheme, string clientTitle, bool central)
        {
            using (ExitConfirmationDialog dialog = new ExitConfirmationDialog(lightTheme, clientTitle, central))
                return dialog.ShowDialog(owner) == DialogResult.OK;
        }
    }
}
