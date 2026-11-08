using System;
using System.Reflection;
using System.Windows.Forms;

[assembly: AssemblyTitle(MESDesktopClient.ClientBuild.Title)]
[assembly: AssemblyDescription("MES 固定角色 WebView2 客户端")]
[assembly: AssemblyCompany("MES")]
[assembly: AssemblyProduct("MES Desktop Client")]
[assembly: AssemblyVersion("1.7.0.0")]
[assembly: AssemblyFileVersion("1.7.0.0")]

namespace MESDesktopClient
{
    internal static class Program
    {
        [STAThread]
        private static int Main(string[] args)
        {
            // GUI executables may have pipe handles but no Windows console.
            // Replacing writers avoids SetConsoleOutputCP on an invalid console.
            Console.SetOut(new System.IO.StreamWriter(Console.OpenStandardOutput(), new System.Text.UTF8Encoding(false)) { AutoFlush = true });
            Console.SetError(new System.IO.StreamWriter(Console.OpenStandardError(), new System.Text.UTF8Encoding(false)) { AutoFlush = true });
            bool validate = Array.IndexOf(args, "--validate-config") >= 0;
            bool enroll = Array.IndexOf(args, "--enroll-terminal") >= 0;
            string command = "";
            foreach (string action in new[] { "close", "status", "reload", "minimize", "maximize", "restore", "select-tab" })
                if (Array.IndexOf(args, "--" + action) >= 0) { command = action; break; }
            bool control = command.Length > 0;
            bool cli = control || validate || enroll;
            try
            {
                ClientConfiguration config = ClientConfiguration.Load(args, control);
                if (enroll)
                {
                    Console.SetIn(new System.IO.StreamReader(Console.OpenStandardInput(), System.Text.Encoding.UTF8));
                    // Read once from stdin; never place admin credentials in process arguments or JSON config.
                    System.Collections.Generic.Dictionary<string, string> credentials = new System.Web.Script.Serialization.JavaScriptSerializer()
                        .Deserialize<System.Collections.Generic.Dictionary<string, string>>(Console.In.ReadToEnd());
                    new ClientTerminalAuth(config).Enroll(credentials["username"], credentials["password"]);
                    Console.WriteLine("{\"ok\":true,\"enrolled\":true}");
                    return 0;
                }
                if (validate)
                {
                    Console.WriteLine(new System.Web.Script.Serialization.JavaScriptSerializer().Serialize(new {
                        ok = true, module = config.Module, labCode = config.LabCode, labName = config.LabName,
                        entryPath = config.EntryPath, serverUrl = config.Server.AbsoluteUri, startMaximized = config.StartMaximized,
                        autoLogin = config.AutoLogin, fullScreen = config.FullScreen
                    }));
                    return 0;
                }
                using (ClientInstance instance = new ClientInstance(config, control))
                {
                    if (cli) return ClientInstance.RunCommand(config, instance, command, args);
                    if (!instance.IsPrimary) return ClientInstance.RunCommand(config, instance, "activate", args);
                    Application.EnableVisualStyles();
                    Application.SetCompatibleTextRenderingDefault(false);
                    Application.Run(new ClientForm(config, instance));
                    return 0;
                }
            }
            catch (Exception error)
            {
                if (!cli && Array.IndexOf(args, "--test-hidden") < 0)
                    MessageBox.Show(error.Message, ClientBuild.Title + "启动失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
                Console.Error.WriteLine(error.Message);
                return 8;
            }
        }
    }
}
