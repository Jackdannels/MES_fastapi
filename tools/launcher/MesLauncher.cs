using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

namespace MesFastApiLauncher
{
    internal static class Program
    {
        private const string ProjectRoot = @"__PROJECT_ROOT__";

        [STAThread]
        private static void Main()
        {
            var scriptPath = Path.Combine(ProjectRoot, "start-dev.ps1");
            if (!File.Exists(scriptPath))
            {
                MessageBox.Show(
                    "未找到启动脚本: " + scriptPath,
                    "MES 启动器",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
                return;
            }

            try
            {
                var startInfo = new ProcessStartInfo
                {
                    FileName = "powershell.exe",
                    Arguments = "-NoProfile -ExecutionPolicy Bypass -File \"" + scriptPath + "\"",
                    WorkingDirectory = ProjectRoot,
                    UseShellExecute = false,
                    CreateNoWindow = true
                };
                Process.Start(startInfo);
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    "启动失败: " + ex.Message,
                    "MES 启动器",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
            }
        }
    }
}
