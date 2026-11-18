using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;
using System.Web.Script.Serialization;
using MESControlCenter;

namespace MESDesktopClient
{
    internal static class EnrollmentNetwork
    {
        internal const string Prefix = "/api/terminal-control/enrollment/";
        internal static string Text(Dictionary<string, object> values, string key)
        { object value; return values != null && values.TryGetValue(key, out value) ? Convert.ToString(value) : ""; }
        internal static HttpWebResponse Send(Uri server, string path, Dictionary<string, object> body)
        {
            HttpWebRequest request = (HttpWebRequest)WebRequest.Create(new Uri(server, Prefix + path));
            request.Method = body == null ? "GET" : "POST"; request.Proxy = null; request.AllowAutoRedirect = false;
            request.Timeout = 15000; request.ReadWriteTimeout = 15000; request.Accept = "application/json";
            if (body != null)
            {
                byte[] bytes = Encoding.UTF8.GetBytes(new JavaScriptSerializer().Serialize(body));
                request.ContentType = "application/json"; request.ContentLength = bytes.Length;
                using (Stream stream = request.GetRequestStream()) stream.Write(bytes, 0, bytes.Length);
            }
            try { return (HttpWebResponse)request.GetResponse(); }
            catch (WebException error)
            {
                HttpWebResponse response = error.Response as HttpWebResponse;
                if (response != null)
                using (response)
                using (StreamReader reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8))
                {
                    string detail = "服务器拒绝了此操作（" + (int)response.StatusCode + "）。";
                    try { detail = Text(new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(reader.ReadToEnd()), "detail"); } catch (ArgumentException) { }
                    throw new InvalidOperationException(detail);
                }
                throw new InvalidOperationException("无法连接 MES，请检查服务器地址与局域网。", error);
            }
        }
        internal static Dictionary<string, object> Request(Uri server, string path, Dictionary<string, object> body)
        {
            using (HttpWebResponse response = Send(server, path, body))
            using (StreamReader reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8))
                return new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(reader.ReadToEnd());
        }
        internal static string Hash(byte[] bytes)
        { using (SHA256 hash = SHA256.Create()) return BitConverter.ToString(hash.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant(); }
        internal static string FileHash(string path)
        { using (Stream stream = File.OpenRead(path)) using (SHA256 hash = SHA256.Create()) return BitConverter.ToString(hash.ComputeHash(stream)).Replace("-", "").ToLowerInvariant(); }
    }

    internal sealed class EnrollmentStateStore
    {
        private readonly string path;
        private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("MES5826-terminal-access-v1");
        internal EnrollmentStateStore(Uri server, string slot)
        {
            string root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MES5826TerminalAccess");
            Directory.CreateDirectory(root);
            string origin = EnrollmentNetwork.Hash(Encoding.UTF8.GetBytes(server.GetLeftPart(UriPartial.Authority)));
            string directory = Path.Combine(root, origin); Directory.CreateDirectory(directory);
            path = Path.Combine(directory, EnrollmentNetwork.Hash(Encoding.UTF8.GetBytes(slot)) + ".bin");
        }
        internal Dictionary<string, object> Load()
        {
            if (!File.Exists(path)) return new Dictionary<string, object>();
            try { return new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(Encoding.UTF8.GetString(ProtectedData.Unprotect(File.ReadAllBytes(path), Entropy, DataProtectionScope.CurrentUser))); }
            catch (CryptographicException) { throw new InvalidOperationException("本机申请凭据无法读取，请使用原 Windows 用户。下次可重新提交申请。"); }
        }
        internal void Save(Dictionary<string, object> value)
        {
            byte[] data = ProtectedData.Protect(Encoding.UTF8.GetBytes(new JavaScriptSerializer().Serialize(value)), Entropy, DataProtectionScope.CurrentUser);
            string temporary = path + "." + Guid.NewGuid().ToString("N") + ".new";
            File.WriteAllBytes(temporary, data);
            if (File.Exists(path)) File.Replace(temporary, path, null); else File.Move(temporary, path);
        }
        internal static string DeviceId()
        {
            string root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MES5826TerminalAccess");
            Directory.CreateDirectory(root);
            string path = Path.Combine(root, "device-id.txt");
            using (System.Threading.Mutex mutex = new System.Threading.Mutex(false, "Local\\MES5826Device-" + System.Security.Principal.WindowsIdentity.GetCurrent().User.Value))
            {
                bool acquired;
                try { acquired = mutex.WaitOne(5000); } catch (System.Threading.AbandonedMutexException) { acquired = true; }
                if (!acquired) throw new InvalidOperationException("另一个接入窗口正在初始化，请稍后重试。");
                try { if (!File.Exists(path)) File.WriteAllText(path, Guid.NewGuid().ToString("N")); return File.ReadAllText(path).Trim(); }
                finally { mutex.ReleaseMutex(); }
            }
        }
    }

    internal static class EnrollmentHandoff
    {
        private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("MES5826-approved-binding-v1");
        internal static void Write(string directory, Dictionary<string, object> payload)
        {
            payload["directory"] = Path.GetFullPath(directory);
            File.WriteAllBytes(Path.Combine(directory, ".enrollment.bin"), ProtectedData.Protect(
                Encoding.UTF8.GetBytes(new JavaScriptSerializer().Serialize(payload)), Entropy, DataProtectionScope.CurrentUser));
        }
        internal static Dictionary<string, object> Read(string path)
        {
            return new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(Encoding.UTF8.GetString(
                ProtectedData.Unprotect(File.ReadAllBytes(path), Entropy, DataProtectionScope.CurrentUser)));
        }
    }

    internal static class ClientProvisioning
    {
        internal static string TryActivateLocal(ClientConfiguration initial, Uri server, Dictionary<string, object> request, Dictionary<string, object> response)
        {
            object useLocal;
            if (!initial.IsWorkstation || !request.TryGetValue("useLocalPackage",out useLocal) || !(useLocal is bool) || !(bool)useLocal) return null;
            string directory=Path.GetDirectoryName(initial.ConfigurationPath);
            string application=typeof(ClientConfiguration).Assembly.Location;
            if (!String.Equals(directory,Path.GetDirectoryName(application),StringComparison.OrdinalIgnoreCase) || new ClientTerminalAuth(initial).HasIdentity
                || File.Exists(Path.Combine(directory,".enrollment.bin"))) return null;
            Dictionary<string, object> station=(Dictionary<string,object>)response["station"], binding=(Dictionary<string,object>)response["binding"];
            if (EnrollmentNetwork.Text(response,"status") != "issued" || EnrollmentNetwork.Text(station,"module") != initial.Module
                || EnrollmentNetwork.Text(station,"id") != (initial.LabCode.Length > 0 ? initial.LabCode : initial.Module) || EnrollmentNetwork.Text(station,"labName") != initial.LabName
                || EnrollmentNetwork.Text(binding,"module") != initial.Module || EnrollmentNetwork.Text(binding,"labName") != initial.LabName
                || EnrollmentNetwork.Text(binding,"target") != initial.EntryPath || EnrollmentNetwork.Text(binding,"terminalSecret").Length == 0) return null;
            string manifestPath=Path.Combine(directory,"client-manifest.json");
            if (!File.Exists(manifestPath)) return null;
            Dictionary<string,object> manifest=new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(File.ReadAllText(manifestPath,Encoding.UTF8));
            if (EnrollmentNetwork.Text(manifest,"version") != ClientConfiguration.Version || EnrollmentNetwork.Text(manifest,"module") != initial.Module
                || EnrollmentNetwork.Text(manifest,"labCode") != initial.LabCode || EnrollmentNetwork.Text(manifest,"executable") != Path.GetFileName(application)) return null;
            try { VerifyFiles(directory); } catch (InvalidOperationException) { return null; } catch (IOException) { return null; }
            Dictionary<string,object> config=new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(File.ReadAllText(initial.ConfigurationPath,Encoding.UTF8));
            config["serverUrl"]=server.GetLeftPart(UriPartial.Authority); config["autoLogin"]=true;
            File.WriteAllText(initial.ConfigurationPath,new JavaScriptSerializer().Serialize(config),new UTF8Encoding(false));
            foreach (object raw in (IEnumerable)manifest["files"]) {
                Dictionary<string,object> item=(Dictionary<string,object>)raw;
                string file=SafePath(directory,EnrollmentNetwork.Text(item,"path"));
                item["bytes"]=new FileInfo(file).Length; item["sha256"]=EnrollmentNetwork.FileHash(file);
            }
            File.WriteAllText(manifestPath,new JavaScriptSerializer().Serialize(manifest),new UTF8Encoding(false));
            EnrollmentHandoff.Write(directory,new Dictionary<string,object> { {"server",server.AbsoluteUri}, {"module",binding["module"]}, {"labName",binding["labName"]},
                {"terminalId",binding["terminalId"]}, {"terminalSecret",binding["terminalSecret"]}, {"targetDirectory",directory} });
            initial.Server=server;
            return application;
        }

        internal static string SafePath(string root, string relative)
        {
            if (String.IsNullOrEmpty(relative) || relative.Contains(":") || relative.StartsWith("/", StringComparison.Ordinal) || relative.StartsWith("\\", StringComparison.Ordinal))
                throw new InvalidOperationException("客户端包包含无效路径。");
            string[] parts = relative.Replace('\\', '/').Split('/');
            foreach (string part in parts) if (part == "." || part == "..") throw new InvalidOperationException("客户端包路径越界。");
            string result = Path.GetFullPath(Path.Combine(root, relative.Replace('/', Path.DirectorySeparatorChar)));
            if (!result.StartsWith(Path.GetFullPath(root).TrimEnd('\\') + "\\", StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("客户端包路径越界。");
            return result;
        }

        internal static void VerifyFiles(string directory)
        {
            Dictionary<string, object> manifest = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(File.ReadAllText(Path.Combine(directory, "client-manifest.json"), Encoding.UTF8));
            HashSet<string> declared = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "client-manifest.json" };
            foreach (object raw in (IEnumerable)manifest["files"])
            {
                Dictionary<string, object> item = (Dictionary<string, object>)raw;
                string relative = EnrollmentNetwork.Text(item, "path");
                string file = SafePath(directory, relative);
                if (!declared.Add(relative.Replace('\\', '/')) || !File.Exists(file) || new FileInfo(file).Length != Convert.ToInt64(item["bytes"])
                    || EnrollmentNetwork.FileHash(file) != EnrollmentNetwork.Text(item, "sha256")) throw new InvalidOperationException("客户端文件校验失败：" + relative);
            }
            foreach (string file in Directory.GetFiles(directory, "*", SearchOption.AllDirectories))
                if (!declared.Contains(file.Substring(directory.Length + 1).Replace('\\', '/'))) throw new InvalidOperationException("客户端包包含未声明文件。");
        }

        internal static string Install(Uri server, Dictionary<string, object> request, Dictionary<string, object> response, string desktopRoot)
        {
            Dictionary<string, object> station = (Dictionary<string, object>)response["station"];
            Dictionary<string, object> binding = (Dictionary<string, object>)response["binding"];
            string folder = EnrollmentNetwork.Text(station, "folder"), executable = EnrollmentNetwork.Text(station, "executable");
            if (Path.GetFileName(folder) != folder || folder.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0 || Path.GetFileName(executable) != executable || !executable.EndsWith(".exe", StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("服务器返回的工位目录无效。");
            string root = Path.Combine(desktopRoot, "5826工位客户端"); Directory.CreateDirectory(root);
            string suffix = DateTime.Now.ToString("yyyyMMdd-HHmmss-ffff") + "-" + Guid.NewGuid().ToString("N").Substring(0, 6);
            string temporary = SafePath(root, ".正在生成-" + suffix); Directory.CreateDirectory(temporary);
            new DirectoryInfo(temporary).Attributes |= FileAttributes.Hidden;
            string destination = SafePath(root, folder);
            if (Directory.Exists(destination)) destination = SafePath(root, folder + "-重新绑定-" + suffix);
            string archivePath = SafePath(temporary, "payload.zip");
            long maximum = 100 * 1024 * 1024;
            using (HttpWebResponse package = EnrollmentNetwork.Send(server, "requests/" + EnrollmentNetwork.Text(request, "requestId") + "/package",
                new Dictionary<string, object> { { "token", EnrollmentNetwork.Text(request, "token") } }))
            using (Stream source = package.GetResponseStream())
            using (Stream target = File.Create(archivePath))
            {
                if (package.ContentLength > maximum) throw new InvalidOperationException("客户端包过大。");
                byte[] buffer = new byte[65536]; int count; long total = 0;
                while ((count = source.Read(buffer, 0, buffer.Length)) > 0) { total += count; if (total > maximum) throw new InvalidOperationException("客户端包过大。"); target.Write(buffer, 0, count); }
            }
            if (new FileInfo(archivePath).Length != Convert.ToInt64(response["packageSize"]) || EnrollmentNetwork.FileHash(archivePath) != EnrollmentNetwork.Text(response, "packageSha256"))
                throw new InvalidOperationException("下载的工位包不完整，请重新连接重试。");
            using (ZipArchive zip = ZipFile.OpenRead(archivePath))
            {
                long total = 0;
                foreach (ZipArchiveEntry entry in zip.Entries)
                {
                    total += entry.Length;
                    if (entry.Length > maximum || total > maximum || ((entry.ExternalAttributes >> 16) & 0xF000) == 0xA000) throw new InvalidOperationException("客户端压缩包格式无效。");
                    string path = SafePath(temporary, entry.FullName);
                    if (entry.FullName.EndsWith("/", StringComparison.Ordinal)) { Directory.CreateDirectory(path); continue; }
                    Directory.CreateDirectory(Path.GetDirectoryName(path)); entry.ExtractToFile(path, false);
                }
            }
            File.Delete(archivePath);
            VerifyFiles(temporary);
            string configPath = Path.Combine(temporary, "mes-client.json");
            Dictionary<string, object> config = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(File.ReadAllText(configPath, Encoding.UTF8));
            if (EnrollmentNetwork.Text(config, "module") != EnrollmentNetwork.Text(station, "module")
                || EnrollmentNetwork.Text(config, "labName") != EnrollmentNetwork.Text(station, "labName")) throw new InvalidOperationException("工位包与审批结果不匹配。");
            config["serverUrl"] = server.GetLeftPart(UriPartial.Authority); config["autoLogin"] = true;
            File.WriteAllText(configPath, new JavaScriptSerializer().Serialize(config), new UTF8Encoding(false));
            Dictionary<string, object> manifest = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(File.ReadAllText(Path.Combine(temporary, "client-manifest.json"), Encoding.UTF8));
            foreach (object raw in (IEnumerable)manifest["files"])
            {
                Dictionary<string, object> item = (Dictionary<string, object>)raw;
                string file = SafePath(temporary, EnrollmentNetwork.Text(item, "path"));
                item["bytes"] = new FileInfo(file).Length; item["sha256"] = EnrollmentNetwork.FileHash(file);
            }
            File.WriteAllText(Path.Combine(temporary, "client-manifest.json"), new JavaScriptSerializer().Serialize(manifest), new UTF8Encoding(false));
            EnrollmentHandoff.Write(temporary, new Dictionary<string, object> { { "server", server.AbsoluteUri }, { "module", binding["module"] },
                { "labName", binding["labName"] }, { "terminalId", binding["terminalId"] }, { "terminalSecret", binding["terminalSecret"] }, { "targetDirectory", destination } });
            Directory.Move(temporary, destination);
            new DirectoryInfo(destination).Attributes &= ~FileAttributes.Hidden;
            string old = EnrollmentNetwork.Text(request, "oldDirectory");
            if (!String.IsNullOrEmpty(old) && Directory.Exists(old) && !String.Equals(old, destination, StringComparison.OrdinalIgnoreCase))
                File.WriteAllText(Path.Combine(old, "已停用说明.txt"), "此工位入口已重新申请，请使用桌面新生成的工位文件夹。旧授权是否有效由 MES 管理员控制。", new UTF8Encoding(false));
            return Path.Combine(destination, executable);
        }
    }

    internal sealed class EnrollmentForm : Form
    {
        private sealed class Station
        {
            internal string Id, Label;
            public override string ToString() { return Label; }
        }
        private readonly TextBox server = new ThemeTextBox();
        private readonly TextBox machine = new ThemeTextBox();
        private readonly ComboBox station = new ThemeComboBox();
        private readonly Label message = new Label();
        private readonly Label code = new Label();
        private readonly Button submit = new ThemeButton();
        private readonly Button open = new ThemeButton();
        private readonly Timer poll = new Timer { Interval = 3000 };
        private readonly ClientConfiguration initial;
        private EnrollmentStateStore store;
        private Dictionary<string, object> pending = new Dictionary<string, object>();
        private Uri origin;
        private bool busy;
        private string installedExecutable = "";
        internal bool Provisioned { get; private set; }
        internal bool ActivatedCurrentDirectory { get; private set; }

        internal EnrollmentForm(ClientConfiguration config) : this(config, null) { }
        internal EnrollmentForm(ClientConfiguration config, ClientInstance instance)
        {
            initial = config;
            Theme.LoadPreference();
            Text = "5826 终端接入" + (config.IsWorkstation ? " · " + (config.LabName.Length > 0 ? config.LabName : config.Title) : " · 申请工位绑定"); ClientSize = new Size(650, 515); MinimumSize = Size; MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen; Font = new Font("Microsoft YaHei UI", 10F);
            BackColor = Theme.Background; ForeColor = Theme.Text;
            if (config.HiddenTest) { ShowInTaskbar = false; Opacity = 0; }
            Controls.Add(new Label { Text = "终端接入", Font = new Font(Font.FontFamily, 19F, FontStyle.Bold), Bounds = new Rectangle(26, 19, 550, 40) });
            Controls.Add(new Label { Text = "提交申请后，由控制中心管理员审批；此处无需输入管理员密码。", ForeColor = Theme.Muted, Bounds = new Rectangle(28, 65, 590, 36) });
            AddInput("MES 主机地址", server, 115); server.Text = config.Server.GetLeftPart(UriPartial.Authority);
            AddInput("电脑名称", machine, 169); machine.Text = Environment.MachineName;
            Controls.Add(new Label { Text = "申请工位", Bounds = new Rectangle(28, 226, 135, 30) });
            station.SetBounds(167, 221, 450, 34); station.DropDownStyle = ComboBoxStyle.DropDownList; Controls.Add(station);
            if (config.IsWorkstation) { station.Items.Add(new Station { Id=config.LabCode.Length > 0 ? config.LabCode : config.Module, Label=config.LabName.Length > 0 ? config.LabName : config.Title }); station.SelectedIndex=0; station.Enabled=false; }
            Button load = new ThemeButton { Text = "读取工位列表", Bounds = new Rectangle(28, 274, 155, 40), FlatStyle = FlatStyle.Flat };
            submit.Text = "提交绑定申请"; submit.SetBounds(197, 274, 190, 40); submit.FlatStyle = FlatStyle.Flat;
            submit.BackColor = Theme.AccentStrong; submit.ForeColor = Theme.OnAccent;
            open.Text = "打开新工位"; open.SetBounds(400, 274, 216, 40); open.FlatStyle = FlatStyle.Flat; open.Enabled = false;
            message.SetBounds(28, 337, 590, 70); message.Text = "正在读取工位列表……";
            code.SetBounds(28, 414, 590, 45); code.ForeColor = Theme.Accent;
            Controls.AddRange(new Control[] { load, submit, open, message, code });
            Controls.Add(new Label { Text = "工作机 IP 可自动获取；绑定凭据仅保存在当前 Windows 用户。", ForeColor = Theme.Muted, Bounds = new Rectangle(28, 474, 590, 28) });
            load.Click += async delegate { await LoadCatalog(); }; submit.Click += async delegate { await Submit(); };
            open.Click += delegate {
                try {
                    if (!File.Exists(installedExecutable)) { message.Text = "新工位文件已移动或不存在，请重新读取申请状态。"; return; }
                    Process.Start(new ProcessStartInfo { FileName = installedExecutable, WorkingDirectory = Path.GetDirectoryName(installedExecutable), UseShellExecute = true });
                    Close();
                } catch (Exception error) { message.Text = "新工位启动失败：" + error.Message; }
            };
            server.TextChanged += delegate { poll.Stop(); origin=null; store=null; submit.Enabled=false; open.Enabled=false; message.Text = "服务器地址已修改，请先重新读取工位列表。"; };
            poll.Tick += async delegate { await Poll(); }; Shown += async delegate { await LoadCatalog(); };
            if (instance != null) Shown += delegate {
                instance.Listen(delegate(Dictionary<string, object> request) {
                    if (EnrollmentNetwork.Text(request, "command") == "activate") BeginInvoke(new Action(delegate { if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal; Activate(); BringToFront(); }));
                    return new Dictionary<string, object> { { "ok", true }, { "state", "enrollment" }, { "pid", Process.GetCurrentProcess().Id },
                        { "stationId", initial.IsWorkstation ? (initial.LabCode.Length > 0 ? initial.LabCode : initial.Module) : "" }, { "stationLocked",initial.IsWorkstation } };
                }, delegate(Dictionary<string, object> request) { if (EnrollmentNetwork.Text(request, "command") == "close") BeginInvoke(new Action(Close)); });
            };
            FormClosed += delegate { poll.Stop(); poll.Dispose(); };
            Theme.Apply(this);
        }
        private void AddInput(string label, TextBox input, int top)
        {
            Controls.Add(new Label { Text = label, Bounds = new Rectangle(28, top + 5, 135, 30) });
            input.SetBounds(167, top, 450, 34); input.BackColor = Theme.SurfaceStrong; input.ForeColor = Theme.Text; Controls.Add(input);
        }
        private async Task LoadCatalog()
        {
            if (busy) return; busy = true; submit.Enabled = false; open.Enabled=false; poll.Stop(); store=null;
            try
            {
                origin = ClientConfiguration.ValidateServer(server.Text);
                Dictionary<string, object> catalog = await Task.Run(delegate { return EnrollmentNetwork.Request(origin, "catalog", null); });
                if (origin == null || origin != ClientConfiguration.ValidateServer(server.Text)) return;
                station.Items.Clear();
                foreach (object raw in (IEnumerable)catalog["items"])
                {
                    Dictionary<string, object> row = (Dictionary<string, object>)raw;
                    Station item = new Station { Id = EnrollmentNetwork.Text(row, "id"), Label = EnrollmentNetwork.Text(row, "label") };
                    if (initial.IsWorkstation && item.Id != (initial.LabCode.Length > 0 ? initial.LabCode : initial.Module)) continue;
                    station.Items.Add(item); if (item.Id == initial.LabCode || item.Id == initial.Module) station.SelectedItem = item;
                }
                if (station.SelectedIndex < 0 && station.Items.Count > 0) station.SelectedIndex = 0;
                store = new EnrollmentStateStore(origin, initial.Module + "|" + initial.LabCode + (initial.IsWorkstation ? "|"+initial.ConfigurationPath.ToUpperInvariant() : ""));
                pending = store.Load();
                message.Text = initial.IsWorkstation ? "当前入口固定对应此工位。核对服务器与电脑名称后提交申请。" : "请选择所需工位，然后提交申请。";
                if (EnrollmentNetwork.Text(pending, "requestId").Length > 0) poll.Start();
            }
            catch (Exception error) { message.Text = error.Message; }
            finally { busy = false; submit.Enabled = origin != null && store != null && station.Items.Count > 0; }
        }
        private async Task Submit()
        {
            Station selected = station.SelectedItem as Station;
            if (busy || selected == null || origin == null || store == null) return;
            busy = true; submit.Enabled = false;
            try
            {
                byte[] token = new byte[32]; using (RandomNumberGenerator random = RandomNumberGenerator.Create()) random.GetBytes(token);
                string old = initial.IsWorkstation ? Path.GetDirectoryName(initial.ConfigurationPath) : EnrollmentNetwork.Text(pending, "oldDirectory");
                string installed = EnrollmentNetwork.Text(pending, "installedExecutable");
                if (installed.Length > 0) old = Path.GetDirectoryName(installed);
                pending = new Dictionary<string, object> { { "requestId", Guid.NewGuid().ToString("N") }, { "token", BitConverter.ToString(token).Replace("-", "").ToLowerInvariant() },
                    { "deviceId", EnrollmentStateStore.DeviceId() }, { "machineName", machine.Text }, { "stationId", selected.Id },
                    { "oldDirectory", old } };
                pending["useLocalPackage"] = initial.IsWorkstation && !new ClientTerminalAuth(initial).HasIdentity && installed.Length == 0;
                // Save before sending: if the response is lost, polling uses the
                // exact same secret and never asks the user to approve twice.
                store.Save(pending);
                Dictionary<string, object> body = new Dictionary<string, object>();
                foreach (string key in new[] { "requestId", "token", "deviceId", "machineName", "stationId" }) body[key] = pending[key];
                Dictionary<string, object> result = await Task.Run(delegate { return EnrollmentNetwork.Request(origin, "requests", body); });
                code.Text = "申请编号：" + EnrollmentNetwork.Text(result, "requestCode");
                message.Text = "等待控制中心审批。请将电脑名称与申请编号告知管理员。"; poll.Start();
            }
            catch (Exception error) { message.Text = error.Message; submit.Enabled = true; }
            finally { busy = false; }
        }
        private async Task Poll()
        {
            if (busy || origin == null || EnrollmentNetwork.Text(pending, "requestId").Length == 0) return;
            busy = true;
            try
            {
                Dictionary<string, object> response = await Task.Run(delegate { return EnrollmentNetwork.Request(origin, "requests/" + EnrollmentNetwork.Text(pending, "requestId") + "/poll",
                    new Dictionary<string, object> { { "token", EnrollmentNetwork.Text(pending, "token") } }); });
                code.Text = "申请编号：" + EnrollmentNetwork.Text(response, "requestCode");
                string state = EnrollmentNetwork.Text(response, "status");
                if (state == "pending") { message.Text = "等待控制中心审批。"; submit.Enabled = false; }
                else if (state == "issued")
                {
                    submit.Enabled = false;
                    string existing = EnrollmentNetwork.Text(pending, "installedExecutable");
                    if (File.Exists(existing)) installedExecutable = existing;
                    else
                    {
                        message.Text = "审批已通过，正在校验工位文件……";
                        string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
                        installedExecutable = await Task.Run(delegate {
                            string local=ClientProvisioning.TryActivateLocal(initial,origin,pending,response);
                            return local ?? ClientProvisioning.Install(origin,pending,response,desktop);
                        });
                        pending["installedExecutable"] = installedExecutable; store.Save(pending);
                    }
                    Provisioned = true; open.Enabled = true; poll.Stop();
                    ActivatedCurrentDirectory=String.Equals(Path.GetDirectoryName(installedExecutable),Path.GetDirectoryName(initial.ConfigurationPath),StringComparison.OrdinalIgnoreCase);
                    open.Text=ActivatedCurrentDirectory ? "打开当前工位" : "打开新工位";
                    message.Text = "已绑定：" + EnrollmentNetwork.Text((Dictionary<string, object>)response["station"], "label") + "\n文件夹：" + Path.GetDirectoryName(installedExecutable);
                }
                else
                {
                    poll.Stop(); submit.Enabled = true;
                    message.Text = state == "denied" ? "申请已被拒绝。可与管理员核实后重新申请。" : state == "expired" ? "申请已过期，请重新提交。" : "旧绑定已失效，请选择工位并重新申请。";
                    string installed = EnrollmentNetwork.Text(pending, "installedExecutable");
                    if (installed.Length > 0) pending["oldDirectory"] = Path.GetDirectoryName(installed);
                }
            }
            catch (Exception error) { message.Text = error.Message + "\n将自动重试，也可重新读取工位列表。"; }
            finally { busy = false; }
        }
    }
}
