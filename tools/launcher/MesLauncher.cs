using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace MesFastApiLauncher
{
    internal static class Program
    {
        internal const string ProjectRoot = @"__PROJECT_ROOT__";

        [STAThread]
        private static void Main()
        {
            var scriptPath = Path.Combine(ProjectRoot, "scripts", "mes-service-control.ps1");
            if (!File.Exists(scriptPath))
            {
                MessageBox.Show(
                    "未找到MES控制脚本: " + scriptPath,
                    "MES 启动器",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
                return;
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new LauncherForm(scriptPath));
        }
    }

    internal sealed class LauncherForm : Form
    {
        private readonly string controlScript;
        private readonly Label statusLabel;
        private readonly Button closeButton;
        private readonly Button restartButton;
        private readonly Button startButton;
        private readonly Panel modalOverlay;
        private readonly Label modalTitle;
        private readonly Label modalBody;
        private readonly Button modalCancelButton;
        private readonly Button modalConfirmButton;
        private Action modalConfirmAction;
        private bool actionRunning;

        public LauncherForm(string scriptPath)
        {
            controlScript = scriptPath;
            BackColor = Color.FromArgb(6, 9, 13);
            ClientSize = new Size(510, 410);
            Font = new Font("Microsoft YaHei UI", 9F);
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            Text = "MES 启动器";

            var title = new Label { AutoSize = true, ForeColor = Color.FromArgb(231, 239, 243), Font = new Font("Microsoft YaHei UI", 18F, FontStyle.Bold), Location = new Point(28, 28), Text = "MES 系统" };
            var meta = new Label { AutoSize = true, ForeColor = Color.FromArgb(151, 169, 181), Location = new Point(30, 68), Text = "服务控制中心  ·  后端 8000  ·  前端 5173" };
            statusLabel = new Label { AutoSize = false, BackColor = Color.FromArgb(19, 35, 42), ForeColor = Color.FromArgb(99, 230, 190), Location = new Point(28, 104), Size = new Size(454, 39), TextAlign = ContentAlignment.MiddleLeft };
            closeButton = CreateActionButton("关闭 MES 系统", "关闭后端、前端和专属系统窗口", Color.FromArgb(145, 48, 43), 160);
            restartButton = CreateActionButton("重启 MES 系统", "重新启用服务并刷新系统页面", Color.FromArgb(183, 117, 41), 232);
            startButton = CreateActionButton("开启 MES 系统", "启动后端与前端服务", Color.FromArgb(38, 122, 82), 304);
            closeButton.Click += (sender, args) => RequestAction("Stop", "关闭MES系统会终止当前服务和系统窗口，是否继续？");
            restartButton.Click += (sender, args) => RequestAction("Restart", "重启MES系统会短暂中断当前页面，是否继续？");
            startButton.Click += (sender, args) => RequestAction("Start", null);
            Controls.AddRange(new Control[] { title, meta, statusLabel, closeButton, restartButton, startButton });

            modalOverlay = new Panel { BackColor = Color.FromArgb(7, 14, 19), Location = Point.Empty, Size = ClientSize, Visible = false };
            var modalBorder = new Panel { BackColor = Color.FromArgb(43, 116, 106), Location = new Point(27, 88), Size = new Size(456, 234) };
            var modalCard = new Panel { BackColor = Color.FromArgb(14, 26, 33), Location = new Point(1, 1), Size = new Size(454, 232) };
            modalTitle = new Label { AutoSize = false, ForeColor = Color.FromArgb(231, 239, 243), Font = new Font("Microsoft YaHei UI", 13F, FontStyle.Bold), Location = new Point(24, 22), Size = new Size(404, 29), TextAlign = ContentAlignment.MiddleLeft };
            modalBody = new Label { AutoSize = false, ForeColor = Color.FromArgb(173, 193, 201), Location = new Point(24, 61), Size = new Size(404, 65), TextAlign = ContentAlignment.MiddleLeft };
            modalCancelButton = CreateModalButton("取消", Color.FromArgb(40, 58, 67), new Point(228, 168));
            modalConfirmButton = CreateModalButton("确认", Color.FromArgb(36, 122, 91), new Point(330, 168));
            modalCancelButton.Click += (sender, args) => HideThemedModal();
            modalConfirmButton.Click += (sender, args) =>
            {
                var confirmedAction = modalConfirmAction;
                HideThemedModal();
                if (confirmedAction != null) confirmedAction();
            };
            modalCard.Controls.AddRange(new Control[] { modalTitle, modalBody, modalCancelButton, modalConfirmButton });
            modalBorder.Controls.Add(modalCard);
            modalOverlay.Controls.Add(modalBorder);
            Controls.Add(modalOverlay);
            RefreshStatus();
        }

        private Button CreateActionButton(string title, string detail, Color color, int top)
        {
            var button = new Button { BackColor = color, FlatStyle = FlatStyle.Flat, ForeColor = Color.White, Location = new Point(28, top), Size = new Size(454, 60), Text = title + "\r\n" + detail, TextAlign = ContentAlignment.MiddleLeft, UseVisualStyleBackColor = false };
            button.FlatAppearance.BorderColor = Color.FromArgb(76, 89, 99);
            return button;
        }

        private Button CreateModalButton(string text, Color color, Point location)
        {
            var button = new Button { BackColor = color, FlatStyle = FlatStyle.Flat, ForeColor = Color.White, Location = location, Size = new Size(78, 36), Text = text, UseVisualStyleBackColor = false };
            button.FlatAppearance.BorderColor = Color.FromArgb(72, 104, 111);
            return button;
        }

        private async void RefreshStatus()
        {
            if (actionRunning) return;
            var result = await Task.Run(() => RunControl("Status"));
            statusLabel.Text = "  " + ReadResultValue(result, "message");
        }

        private void RequestAction(string action, string confirmation)
        {
            if (actionRunning || modalOverlay.Visible) return;
            if (confirmation != null)
            {
                ShowThemedModal(action == "Stop" ? "确认关闭 MES 系统" : "确认重启 MES 系统", confirmation, true, () => ExecuteAction(action), false);
                return;
            }
            ExecuteAction(action);
        }

        private async void ExecuteAction(string action)
        {
            if (actionRunning) return;
            actionRunning = true;
            ToggleActions(false);
            statusLabel.Text = "  正在" + (action == "Start" ? "启动" : action == "Restart" ? "重启" : "关闭") + "MES系统，请稍候…";
            try
            {
                var result = await Task.Run(() => RunControl(action));
                var status = ReadResultValue(result, "status");
                var message = ReadResultValue(result, "message");
                statusLabel.Text = "  " + message;
                if (status == "already_running") ShowThemedModal("MES 系统已开启", "MES系统已经打开，无需再次开启。", false, null, false);
                else if (status == "not_running") ShowThemedModal("未检测到运行中的系统", "未检测到开启的MES系统，无需关闭。", false, null, false);
                else if (action == "Start" && status == "started") ShowThemedModal("启动完成", "MES系统已启动，可以在默认浏览器中继续操作。", false, null, false);
                else if (action == "Restart" && status == "started") ShowThemedModal("重启完成", "MES系统已重新启动，页面已刷新。", false, null, false);
            }
            catch (Exception ex) { ShowThemedModal("操作失败", "操作失败: " + ex.Message, false, null, true); }
            finally { actionRunning = false; ToggleActions(true); }
        }

        private void ShowThemedModal(string title, string body, bool requiresConfirmation, Action confirmAction, bool isError)
        {
            modalTitle.Text = title;
            modalBody.Text = body;
            modalConfirmAction = confirmAction;
            modalCancelButton.Visible = requiresConfirmation;
            modalConfirmButton.Text = requiresConfirmation ? "确认" : "知道了";
            modalConfirmButton.BackColor = isError ? Color.FromArgb(145, 48, 43) : Color.FromArgb(36, 122, 91);
            modalConfirmButton.Location = requiresConfirmation ? new Point(330, 168) : new Point(350, 168);
            modalOverlay.Visible = true;
            modalOverlay.BringToFront();
            modalConfirmButton.Focus();
        }

        private void HideThemedModal()
        {
            modalConfirmAction = null;
            modalOverlay.Visible = false;
        }

        private string RunControl(string action)
        {
            var info = new ProcessStartInfo { FileName = "powershell.exe", Arguments = "-NoProfile -ExecutionPolicy Bypass -File \"" + controlScript + "\" -Action " + action, WorkingDirectory = Program.ProjectRoot, UseShellExecute = false, RedirectStandardOutput = true, CreateNoWindow = true };
            using (var process = Process.Start(info)) { var output = process.StandardOutput.ReadToEnd(); process.WaitForExit(); return output; }
        }

        private static string ReadResultValue(string result, string name)
        {
            var match = Regex.Match(result ?? "", "\\\"" + name + "\\\"\\s*:\\s*\\\"([^\\\"]*)\\\"");
            return match.Success ? match.Groups[1].Value : "MES系统状态未知";
        }

        private void ToggleActions(bool enabled) { closeButton.Enabled = enabled; restartButton.Enabled = enabled; startButton.Enabled = enabled; }
    }
}
