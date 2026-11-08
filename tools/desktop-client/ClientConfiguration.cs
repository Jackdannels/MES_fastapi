using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Web.Script.Serialization;

namespace MESDesktopClient
{
    internal sealed class ClientConfiguration
    {
        internal const string Version = "1.7.0";
        internal string ConfigurationPath;
        internal Uri Server;
        internal string Title = ClientBuild.Title;
        internal string Module = ClientBuild.Module;
        internal string LabCode = ClientBuild.LabCode;
        internal string LabName = ClientBuild.LabName;
        internal string EntryPath = ClientBuild.EntryPath;
        internal bool StartMaximized = true;
        internal bool AutoLogin;
        internal bool IsWorkstation { get { return Module != "central" && Module != "lims" && Module != "upper-computer"; } }
        internal bool FullScreen { get { return IsWorkstation && Module != "visual"; } }
        internal bool HiddenTest;
        internal string FixedRuntime;
        internal string InstanceKey;
        internal string DataDirectory;
        internal string DownloadDirectory;
        internal bool SimulatorsEnabled;
        internal Uri LimsServer;
        internal Uri UpperServer;
        internal string InitialTab = "central";

        internal static string Argument(string[] args, string key, string fallback)
        {
            for (int i = 0; i < args.Length; i++)
                if (args[i] == key)
                {
                    if (i + 1 >= args.Length || args[i + 1].StartsWith("--")) throw new ArgumentException("参数缺少值：" + key);
                    return args[i + 1];
                }
            return fallback;
        }

        internal static Uri ValidateServer(string value)
        {
            Uri uri;
            if (!Uri.TryCreate(value, UriKind.Absolute, out uri) || (uri.Scheme != "http" && uri.Scheme != "https")
                || uri.UserInfo.Length != 0 || uri.Query.Length != 0 || uri.Fragment.Length != 0 || uri.AbsolutePath != "/")
                throw new ArgumentException("服务器地址需为 HTTP(S) 主机与端口，例如 http://192.168.110.15:15173。");
            return new Uri(uri.GetLeftPart(UriPartial.Authority) + "/");
        }

        internal static ClientConfiguration Load(string[] args, bool controlOnly)
        {
            ClientConfiguration config = new ClientConfiguration();
            config.ConfigurationPath = Path.GetFullPath(Argument(args, "--config", Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "mes-client.json")));
            config.InitializeIdentity();
            if (controlOnly) { config.Server = new Uri("http://127.0.0.1/"); return config; }
            Dictionary<string, object> values = new Dictionary<string, object>();
            if (File.Exists(config.ConfigurationPath))
                values = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(File.ReadAllText(config.ConfigurationPath, Encoding.UTF8));
            object value;
            string server = values.TryGetValue("serverUrl", out value) ? Convert.ToString(value) : ClientBuild.DefaultServer;
            config.Server = ValidateServer(Argument(args, "--server-url", server));
            if (values.TryGetValue("module", out value)) config.Module = Convert.ToString(value);
            if (config.Module != ClientBuild.Module) throw new ArgumentException("配置角色与此专用程序不匹配，请使用对应工位的 EXE。");
            config.AutoLogin = config.IsWorkstation && (!values.TryGetValue("autoLogin", out value) || Convert.ToBoolean(value));
            if ((values.TryGetValue("labCode", out value) && Convert.ToString(value) != config.LabCode)
                || (values.TryGetValue("labName", out value) && Convert.ToString(value) != config.LabName))
                throw new ArgumentException("配置实验间与此专用程序不匹配，请使用对应实验间的 EXE。");
            if (values.TryGetValue("title", out value) && !String.IsNullOrWhiteSpace(Convert.ToString(value))) config.Title = Convert.ToString(value);
            // Legacy fullScreen configurations now use standard Windows maximization.
            if (values.TryGetValue("startMaximized", out value) || values.TryGetValue("fullScreen", out value)) config.StartMaximized = Convert.ToBoolean(value);
            config.SimulatorsEnabled = config.Module == "central" && values.TryGetValue("simulatorsEnabled", out value) && Convert.ToBoolean(value);
            if (config.SimulatorsEnabled)
            {
                config.LimsServer = ValidateServer(values.TryGetValue("limsUrl", out value) ? Convert.ToString(value) : "http://127.0.0.1:8900");
                config.UpperServer = ValidateServer(values.TryGetValue("upperComputerUrl", out value) ? Convert.ToString(value) : "http://127.0.0.1:8899");
            }
            config.InitialTab = Argument(args, "--show-tab", config.Module);
            if (config.InitialTab != config.Module && (!config.SimulatorsEnabled || (config.InitialTab != "lims" && config.InitialTab != "upper-computer")))
                throw new ArgumentException("此客户端没有请求的页签。");
            if (values.TryGetValue("runtimeDirectory", out value) && !String.IsNullOrWhiteSpace(Convert.ToString(value)))
            {
                string runtime = Convert.ToString(value);
                config.FixedRuntime = Path.GetFullPath(Path.IsPathRooted(runtime) ? runtime : Path.Combine(Path.GetDirectoryName(config.ConfigurationPath), runtime));
                if (!File.Exists(Path.Combine(config.FixedRuntime, "msedgewebview2.exe"))) throw new ArgumentException("配置的 WebView2 固定版本运行库不存在。");
            }
            config.HiddenTest = Array.IndexOf(args, "--test-hidden") >= 0
                || Environment.GetEnvironmentVariable("MES_DESKTOP_TEST_HIDDEN") == "1";
            string downloads = values.TryGetValue("downloadDirectory", out value) ? Convert.ToString(value) : "";
            config.DownloadDirectory = String.IsNullOrWhiteSpace(downloads)
                ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads", "MES", config.LabName.Length > 0 ? config.LabName : config.Module)
                : Path.GetFullPath(Path.IsPathRooted(downloads) ? downloads : Path.Combine(Path.GetDirectoryName(config.ConfigurationPath), downloads));
            // Identity follows this installation/configuration and Windows user, not a changing IP.
            return config;
        }

        private void InitializeIdentity()
        {
            string identity = WindowsIdentity.GetCurrent().User.Value + "|" + ClientBuild.Module + "|" + ConfigurationPath.ToUpperInvariant();
            if (LabCode.Length > 0) identity += "|" + LabCode;
            using (SHA256 hash = SHA256.Create())
                InstanceKey = "MESDesktopClient-" + BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(identity))).Replace("-", "").Substring(0, 32);
            DataDirectory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MESDesktopClient", InstanceKey);
        }

        internal bool AllowsNavigation(string value)
        {
            Uri uri;
            return Uri.TryCreate(value, UriKind.Absolute, out uri) && uri.UserInfo.Length == 0
                && String.Equals(uri.GetLeftPart(UriPartial.Authority), Server.GetLeftPart(UriPartial.Authority), StringComparison.OrdinalIgnoreCase)
                && (uri.Scheme == "http" || uri.Scheme == "https");
        }

        internal string BootstrapScript()
        {
            string json = new JavaScriptSerializer().Serialize(new { module = Module, labCode = LabCode, labName = LabName,
                autoLogin = AutoLogin, canCloseWindow = IsWorkstation, fullScreen = FullScreen,
                version = Version, localIpAddresses = ClientHostInfo.LocalIpAddresses() });
            return "Object.defineProperty(window, '__MES_DESKTOP__', {value: Object.freeze(" + json + "), writable: false, configurable: false});";
        }

        internal ClientConfiguration SimulatorPage(string module)
        {
            return new ClientConfiguration {
                ConfigurationPath = ConfigurationPath, Module = module,
                Title = module == "lims" ? "MES LIMS 模拟器" : "MES 上位机模拟器",
                Server = module == "lims" ? LimsServer : UpperServer,
                DataDirectory = Path.Combine(DataDirectory, "tabs", module),
                DownloadDirectory = Path.Combine(DownloadDirectory, module),
                FixedRuntime = FixedRuntime, StartMaximized = false, HiddenTest = HiddenTest
            };
        }

        internal string DiagnosticsScript()
        {
            // Diagnostics only; messages do not authorize file or process operations.
            return "(()=>{const send=value=>window.chrome.webview.postMessage(value);"
                + "const report=()=>send('mes-client-page-error');window.addEventListener('error',report);window.addEventListener('unhandledrejection',report);"
                + "const start=()=>{const root=document.documentElement;const publish=()=>{let saved='';try{saved=localStorage.getItem('mes.theme')||'';}catch(e){}"
                + "const theme=root.dataset.theme||saved||'dark';send('mes-client-theme:'+(theme==='light'?'light':'dark'));};"
                + "new MutationObserver(publish).observe(root,{attributes:true,attributeFilter:['data-theme']});publish();};"
                + "if(document.documentElement)start();else document.addEventListener('DOMContentLoaded',start,{once:true});})();";
        }

        internal void Log(string message)
        {
            try
            {
                Directory.CreateDirectory(DataDirectory);
                string path = Path.Combine(DataDirectory, "client.log");
                if (File.Exists(path) && new FileInfo(path).Length > 2 * 1024 * 1024) File.Delete(path);
                File.AppendAllText(path, DateTimeOffset.Now.ToString("o") + " " + message + Environment.NewLine, Encoding.UTF8);
            }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }
    }
}
