using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace MESControlCenter
{
    // DTO fields are populated by JavaScriptSerializer.
#pragma warning disable 0649
    internal sealed class ComponentFile
    {
        public string path, sha256;
        public long bytes;
        public bool mutable;
    }
    internal sealed class ComponentDefinition
    {
        public string id, name, kind, directory, archive, sha256, executable, version, module, labCode, labName;
        public List<ComponentFile> files;
    }
    internal sealed class ComponentLibrary
    {
        public string format, controlCenterVersion;
        public int format_version;
        public List<ComponentDefinition> components;
    }
#pragma warning restore 0649
    internal sealed class ComponentInspection
    {
        internal ComponentDefinition Component;
        internal string Status, Detail;
        internal bool CanRepair;
        internal readonly List<ComponentFile> Replace=new List<ComponentFile>();
    }

    internal sealed class ComponentStore
    {
        internal readonly string Root;
        internal string LibraryDirectory;
        private readonly JavaScriptSerializer json=new JavaScriptSerializer();
        internal string LogDirectory { get { return ControlCenterPaths.Child(Root,".mes/logs"); } }
        internal ComponentStore(string root)
        { Root=Path.GetFullPath(root); LibraryDirectory=Path.Combine(Root,".mes","components"); }

        internal ComponentLibrary ReadLibrary()
        {
            string path=LibraryDirectory.StartsWith(Root+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase)
                ? ControlCenterPaths.Child(Root,Path.Combine(LibraryDirectory.Substring(Root.Length+1),"catalog.json")) : ControlCenterPaths.Child(LibraryDirectory,"catalog.json");
            if (!File.Exists(path)) throw new InvalidOperationException("当前目录缺少离线组件库，请选择同版本组件资源目录。");
            ComponentLibrary library=json.Deserialize<ComponentLibrary>(File.ReadAllText(path,Encoding.UTF8));
            if (library == null || library.format != "mes-component-library" || library.format_version != 1 || library.controlCenterVersion != "2.10.0" || library.components == null)
                throw new InvalidOperationException("组件库格式或控制中心版本不匹配。");
            HashSet<string> ids=new HashSet<string>(StringComparer.OrdinalIgnoreCase), destinations=new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (ComponentDefinition component in library.components) {
                if (String.IsNullOrWhiteSpace(component.id) || !ids.Add(component.id) || component.files == null || component.files.Count == 0) throw new InvalidOperationException("组件清单缺少文件或标识重复。");
                if (!System.Text.RegularExpressions.Regex.IsMatch(component.id,"^[A-Za-z0-9_-]{1,64}$")) throw new InvalidOperationException("组件标识无效。");
                if ((component.kind == "controller" && component.version != "2.10.0") || (component.kind != "controller" && component.version != "1.8.0"))
                    throw new InvalidOperationException("组件版本不匹配，请选择同版本资源。");
                if ((component.kind == "central" && component.directory != "中控管理" && component.directory != "central-client")
                    || (component.kind == "test" && component.directory != "测试终端")
                    || (component.kind == "workstation" && !component.directory.Replace('\\','/').StartsWith("工位终端/",StringComparison.Ordinal))
                    || (component.kind != "central" && component.kind != "test" && component.kind != "workstation" && component.kind != "controller"))
                    throw new InvalidOperationException("组件类型或运行目录无效。");
                string target=Target(component);
                if (!destinations.Add(target)) throw new InvalidOperationException("组件目录重复。");
                ControlCenterPaths.Child(LibraryDirectory,component.archive);
                if (component.sha256 == null || component.sha256.Length != 64) throw new InvalidOperationException("组件资源没有有效校验值。");
                HashSet<string> files=new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                foreach (ComponentFile file in component.files) {
                    ControlCenterPaths.Child(target,file.path);
                    if (!files.Add(file.path) || file.bytes < 0 || file.bytes > 200L*1024*1024 || file.sha256 == null || file.sha256.Length != 64)
                        throw new InvalidOperationException("组件文件清单无效。");
                    if (file.path.EndsWith(".bin",StringComparison.OrdinalIgnoreCase) || file.path.IndexOf("terminal-identity",StringComparison.OrdinalIgnoreCase) >= 0)
                        throw new InvalidOperationException("组件库不能包含绑定凭据。");
                    if (Path.GetFileName(file.path).StartsWith(".env",StringComparison.OrdinalIgnoreCase) || file.path.EndsWith(".sql",StringComparison.OrdinalIgnoreCase)
                        || file.path.EndsWith(".sqlite3",StringComparison.OrdinalIgnoreCase) || file.path.EndsWith("portable.env",StringComparison.OrdinalIgnoreCase))
                        throw new InvalidOperationException("组件库不能覆盖服务凭据或业务数据。");
                    if (file.mutable && file.path != "mes-client.json" && file.path != "client-manifest.json") throw new InvalidOperationException("组件配置类型无效。");
                }
            }
            return library;
        }

        private string Target(ComponentDefinition component)
        {
            if (component.kind == "controller" && component.directory == "") return Root;
            return ControlCenterPaths.Child(Root,component.directory);
        }
        internal static string Hash(string path)
        {
            using (Stream stream=File.OpenRead(path)) using (SHA256 hash=SHA256.Create())
                return BitConverter.ToString(hash.ComputeHash(stream)).Replace("-","").ToLowerInvariant();
        }
        private HashSet<string> Installed()
        {
            string file=ControlCenterPaths.Child(Root,".mes/installed-components.json");
            if (!File.Exists(file)) return new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            return new HashSet<string>(json.Deserialize<List<string>>(File.ReadAllText(file)),StringComparer.OrdinalIgnoreCase);
        }
        private void RecordInstalled(string id)
        {
            HashSet<string> installed=Installed(); installed.Add(id);
            string file=ControlCenterPaths.Child(Root,".mes/installed-components.json"); Directory.CreateDirectory(Path.GetDirectoryName(file));
            AtomicText(file,json.Serialize(installed));
        }
        private static void AtomicText(string path, string text)
        {
            string temporary=path+"."+Guid.NewGuid().ToString("N")+".new";
            try { File.WriteAllText(temporary,text,new UTF8Encoding(false)); if (File.Exists(path)) File.Replace(temporary,path,null); else File.Move(temporary,path); }
            finally { if (File.Exists(temporary)) File.Delete(temporary); }
        }
        private static void AtomicCopy(string source, string target)
        {
            string temporary=target+".repair-"+Guid.NewGuid().ToString("N");
            try { File.Copy(source,temporary,false); if (File.Exists(target)) File.Replace(temporary,target,null); else File.Move(temporary,target); }
            finally { if (File.Exists(temporary)) File.Delete(temporary); }
        }
        private void ValidateConfiguration(ComponentDefinition component, string path)
        {
            Dictionary<string,object> value=json.Deserialize<Dictionary<string,object>>(File.ReadAllText(path,Encoding.UTF8));
            Uri server; object raw;
            if (value == null || !value.TryGetValue("serverUrl",out raw) || !Uri.TryCreate(Convert.ToString(raw),UriKind.Absolute,out server)
                || (server.Scheme != "http" && server.Scheme != "https") || server.UserInfo.Length > 0 || server.AbsolutePath != "/" || server.Query.Length > 0 || server.Fragment.Length > 0)
                throw new InvalidOperationException("服务器地址格式错误");
            if (!value.TryGetValue("module",out raw) || Convert.ToString(raw) != component.module) throw new InvalidOperationException("配置角色不匹配");
            if (component.module == "laboratory" && (!value.TryGetValue("labCode",out raw) || Convert.ToString(raw) != component.labCode
                || !value.TryGetValue("labName",out raw) || Convert.ToString(raw) != component.labName)) throw new InvalidOperationException("配置工位不匹配");
        }

        internal List<ComponentInspection> Scan(bool complete, CancellationToken cancellation)
        {
            ComponentLibrary library=ReadLibrary(); HashSet<string> installed=Installed();
            List<ComponentInspection> result=new List<ComponentInspection>();
            foreach (ComponentDefinition component in library.components) {
                cancellation.ThrowIfCancellationRequested();
                ComponentInspection item=new ComponentInspection { Component=component, Status="完整", Detail="运行文件与配置正常", CanRepair=false };
                result.Add(item);
                try {
                    string target=Target(component);
                    if (!Directory.Exists(target)) { item.Status=installed.Contains(component.id) ? "缺失" : "未安装"; item.Detail="组件文件夹不存在"; item.Replace.AddRange(component.files); }
                    else {
                        List<string> issues=new List<string>(); bool configError=false;
                        foreach (ComponentFile file in component.files) {
                            cancellation.ThrowIfCancellationRequested();
                            string path=ControlCenterPaths.Child(target,file.path);
                            if (!File.Exists(path)) { item.Replace.Add(file); issues.Add("缺少："+file.path); continue; }
                            if (file.path == "mes-client.json") {
                                try { ValidateConfiguration(component,path); }
                                catch (Exception error) { if (!(error is IOException || error is ArgumentException || error is InvalidOperationException)) throw; configError=true; issues.Add("配置异常（保留原文件）："+error.Message); }
                            } else if (file.path == "client-manifest.json") {
                                try { Dictionary<string,object> manifest=json.Deserialize<Dictionary<string,object>>(File.ReadAllText(path)); if (manifest == null || !manifest.ContainsKey("files") || Convert.ToString(manifest["executable"]) != component.executable) throw new ArgumentException(); }
                                catch (ArgumentException) { item.Replace.Add(file); issues.Add("运行清单需要恢复"); }
                                catch (KeyNotFoundException) { item.Replace.Add(file); issues.Add("运行清单需要恢复"); }
                            } else if (!file.mutable && (new FileInfo(path).Length != file.bytes || (complete && Hash(path) != file.sha256))) {
                                item.Replace.Add(file); issues.Add("校验不符："+file.path);
                            }
                        }
                        if (item.Replace.Count > 0) item.Status="缺失或损坏";
                        else if (configError) item.Status="配置异常";
                        if (issues.Count > 0) item.Detail=String.Join("；",issues.ToArray());
                    }
                    item.CanRepair=item.Replace.Count > 0 && component.kind != "controller";
                    if (component.kind == "controller" && item.Replace.Count > 0) item.Detail+="；请关闭后运行 .mes/恢复控制中心.cmd";
                } catch (Exception error) {
                    if (!(error is IOException || error is UnauthorizedAccessException || error is InvalidOperationException || error is ArgumentException)) throw;
                    item.Status="路径或文件异常"; item.Detail=error.Message; item.CanRepair=false;
                }
            }
            return result;
        }

        private void ExtractVerified(ComponentDefinition component, string destination)
        {
            string archive=ControlCenterPaths.Child(LibraryDirectory,component.archive);
            if (!File.Exists(archive) || Hash(archive) != component.sha256) throw new InvalidOperationException("组件压缩包缺失或校验失败："+component.name);
            Dictionary<string,ComponentFile> expected=new Dictionary<string,ComponentFile>(StringComparer.OrdinalIgnoreCase);
            foreach (ComponentFile file in component.files) expected.Add(file.path.Replace('\\','/'),file);
            HashSet<string> found=new HashSet<string>(StringComparer.OrdinalIgnoreCase); long total=0;
            using (ZipArchive zip=ZipFile.OpenRead(archive)) foreach (ZipArchiveEntry entry in zip.Entries) {
                ComponentFile declared;
                if (!expected.TryGetValue(entry.FullName,out declared) || !found.Add(entry.FullName) || entry.Length != declared.bytes)
                    throw new InvalidOperationException("组件压缩包包含未声明、重复或损坏文件。");
                total+=entry.Length; if (total > 200L*1024*1024) throw new InvalidOperationException("组件压缩包展开体积超限。");
                string target=ControlCenterPaths.Child(destination,entry.FullName);
                Directory.CreateDirectory(Path.GetDirectoryName(target)); entry.ExtractToFile(target,false);
                if (Hash(target) != declared.sha256) throw new InvalidOperationException("组件文件校验失败："+entry.FullName);
            }
            if (found.Count != expected.Count) throw new InvalidOperationException("组件压缩包缺少文件。");
        }

        internal string Repair(string id, CancellationToken cancellation)
        {
            string key=HashText(Root.ToUpperInvariant());
            using (Mutex mutex=new Mutex(false,"Local\\MESComponentRepair-"+key)) {
                bool acquired=false;
                try {
                    try { acquired=mutex.WaitOne(0); } catch (AbandonedMutexException) { acquired=true; }
                    if (!acquired) throw new InvalidOperationException("另一个组件操作正在进行。");
                    ComponentInspection item=Scan(true,cancellation).Find(row => row.Component.id == id);
                    if (item == null || !item.CanRepair) throw new InvalidOperationException("此组件无需补全，或需要先处理配置/路径异常。");
                    ComponentDefinition component=item.Component;
                    if (component.kind == "central" || component.kind == "test" || component.kind == "workstation") {
                        string executable=ControlCenterPaths.Child(Target(component),component.executable);
                        foreach (Process process in Process.GetProcessesByName(Path.GetFileNameWithoutExtension(executable))) using (process) {
                            try { if (String.Equals(process.MainModule.FileName,executable,StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("此组件正在运行，请先关闭该界面再补全。"); }
                            catch (System.ComponentModel.Win32Exception) { }
                        }
                    }
                    string transaction=ControlCenterPaths.Child(Root,".mes/staging/"+Guid.NewGuid().ToString("N")); Directory.CreateDirectory(transaction);
                    List<string> created=new List<string>(); Dictionary<string,string> backups=new Dictionary<string,string>();
                    HashSet<string> applied=new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                    string target=Target(component);
                    try {
                        ExtractVerified(component,transaction); cancellation.ThrowIfCancellationRequested();
                        string runtimeManifest=ControlCenterPaths.Child(target,"client-manifest.json");
                        if (File.Exists(runtimeManifest)) {
                            string manifestBackup=ControlCenterPaths.Child(Root,".mes/backups/"+Path.GetFileName(transaction)+"/"+component.id+"/client-manifest.json");
                            Directory.CreateDirectory(Path.GetDirectoryName(manifestBackup)); File.Copy(runtimeManifest,manifestBackup,false); backups.Add(runtimeManifest,manifestBackup);
                        }
                        // Preflight every replacement before changing the first file.
                        foreach (ComponentFile file in item.Replace) {
                            string path=ControlCenterPaths.Child(target,file.path);
                            if (File.Exists(path) && file.path != "mes-client.json") using (FileStream check=new FileStream(path,FileMode.Open,FileAccess.ReadWrite,FileShare.None)) { }
                        }
                        foreach (ComponentFile file in item.Replace) {
                            string path=ControlCenterPaths.Child(target,file.path);
                            // Existing configuration is never overwritten, even if it changed during the scan.
                            if (file.path == "mes-client.json" && File.Exists(path)) continue;
                            Directory.CreateDirectory(Path.GetDirectoryName(path));
                            if (File.Exists(path) && !backups.ContainsKey(path)) {
                                string backup=ControlCenterPaths.Child(Root,".mes/backups/"+Path.GetFileName(transaction)+"/"+component.id+"/"+file.path);
                                Directory.CreateDirectory(Path.GetDirectoryName(backup)); File.Copy(path,backup,false); backups.Add(path,backup);
                            } else if (!File.Exists(path)) created.Add(path);
                            AtomicCopy(ControlCenterPaths.Child(transaction,file.path),path); applied.Add(path);
                        }
                        if (RefreshClientManifest(component,target,transaction)) applied.Add(runtimeManifest);
                        RecordInstalled(id); Log("补全成功："+component.name+"，处理 "+item.Replace.Count+" 个文件");
                        return component.name+"：补全完成，原配置与绑定保留。";
                    } catch (Exception error) {
                        foreach (KeyValuePair<string,string> backup in backups) if (applied.Contains(backup.Key)) AtomicCopy(backup.Value,backup.Key);
                        foreach (string path in created) if (applied.Contains(path) && File.Exists(path)) File.Delete(path);
                        Log("补全失败，已回退本次文件修改："+component.name+"；"+error.Message); throw;
                    } finally {
                        if (Directory.Exists(transaction)) Directory.Delete(ControlCenterPaths.Child(Root,".mes/staging/"+Path.GetFileName(transaction)),true);
                    }
                } finally { if (acquired) mutex.ReleaseMutex(); }
            }
        }

        private static string HashText(string value)
        { using (SHA256 hash=SHA256.Create()) return BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(value))).Replace("-",""); }
        private bool RefreshClientManifest(ComponentDefinition component, string target, string template)
        {
            string config=ControlCenterPaths.Child(target,"mes-client.json");
            if (!File.Exists(config)) return false;
            try { ValidateConfiguration(component,config); } catch (ArgumentException) { return false; } catch (InvalidOperationException) { return false; }
            string path=ControlCenterPaths.Child(target,"client-manifest.json");
            if (!File.Exists(path)) return false;
            Dictionary<string,object> manifest=json.Deserialize<Dictionary<string,object>>(File.ReadAllText(ControlCenterPaths.Child(template,"client-manifest.json"),Encoding.UTF8));
            List<Dictionary<string,object>> files=new List<Dictionary<string,object>>();
            foreach (ComponentFile file in component.files) if (file.path != "client-manifest.json") {
                string actual=ControlCenterPaths.Child(target,file.path);
                files.Add(new Dictionary<string,object> { {"path",file.path},{"bytes",new FileInfo(actual).Length},{"sha256",Hash(actual)} });
            }
            manifest["files"]=files; AtomicText(path,json.Serialize(manifest)); return true;
        }
        private void Log(string message)
        {
            try { Directory.CreateDirectory(LogDirectory); File.AppendAllText(Path.Combine(LogDirectory,"component-integrity.log"),DateTimeOffset.Now.ToString("o")+" "+message+Environment.NewLine,Encoding.UTF8); }
            catch (IOException) { } catch (UnauthorizedAccessException) { }
        }
    }

    internal sealed class ComponentIntegrityPage : UserControl
    {
        private readonly ComponentStore store;
        private readonly Func<bool> operationBusy;
        private readonly DataGridView grid=new DataGridView();
        private readonly Label summary=new Label();
        private readonly TextBox detail=new ThemeTextBox();
        private readonly List<Button> actions=new List<Button>();
        private readonly Button repair;
        private readonly Button cancel;
        private CancellationTokenSource cancellation;
        internal bool Busy { get; private set; }
        internal bool Repairing { get; private set; }
        internal Action<int> FindingsChanged;

        internal ComponentIntegrityPage(string root, Func<bool> busy)
        {
            store=new ComponentStore(root); operationBusy=busy; Dock=DockStyle.Fill; BackColor=Theme.Background;
            TableLayoutPanel header=new TableLayoutPanel { Dock=DockStyle.Top, AutoSize=true, ColumnCount=1, RowCount=3, BackColor=Theme.Surface, Padding=new Padding(14,10,14,10) };
            summary.AutoSize=true; summary.ForeColor=Theme.Muted; summary.Text="检测当前目录中的运行组件，勾选后补全。";
            Label note=new Label { AutoSize=true, ForeColor=Theme.Muted, Text="保留现有配置和工位绑定；配置异常单独提示。", Margin=new Padding(0,6,0,8) };
            FlowLayoutPanel buttons=new FlowLayoutPanel { Dock=DockStyle.Fill, AutoSize=true, WrapContents=true, Margin=Padding.Empty };
            Button quick=Button("快速检测"), full=Button("完整校验"), resources=Button("选择组件资源"), logs=Button("打开日志");
            repair=Button("补全所选"); repair.BackColor=Theme.AccentStrong; repair.ForeColor=Theme.OnAccent;
            cancel=Button("取消"); cancel.Enabled=false;
            quick.Click+=async delegate { await CheckAsync(false); }; full.Click+=async delegate { await CheckAsync(true); };
            repair.Click+=async delegate { await RepairSelected(); }; cancel.Click+=delegate { if (cancellation != null) cancellation.Cancel(); };
            resources.Click+=async delegate {
                using (OpenFileDialog dialog=new OpenFileDialog { Title="选择同版本组件库 catalog.json", Filter="组件清单|catalog.json", CheckFileExists=true })
                if (dialog.ShowDialog(this) == DialogResult.OK) { store.LibraryDirectory=Path.GetDirectoryName(dialog.FileName); await CheckAsync(false); }
            };
            logs.Click+=delegate { try { Directory.CreateDirectory(store.LogDirectory); Process.Start("explorer.exe",store.LogDirectory); } catch (Exception error) { Theme.ShowMessage(this,error.Message,"日志目录",false,true); } };
            buttons.Controls.AddRange(new Control[]{quick,full,repair,resources,logs,cancel});
            header.Controls.Add(summary,0,0); header.Controls.Add(note,0,1); header.Controls.Add(buttons,0,2);
            grid.Dock=DockStyle.Fill; grid.AutoGenerateColumns=false; grid.AllowUserToAddRows=false; grid.AllowUserToDeleteRows=false;
            grid.AllowUserToResizeRows=false; grid.RowHeadersVisible=false; grid.MultiSelect=false; grid.SelectionMode=DataGridViewSelectionMode.FullRowSelect;
            grid.ColumnHeadersHeight=42; grid.RowTemplate.Height=48;
            grid.Columns.Add(new DataGridViewCheckBoxColumn { Name="Selected", HeaderText="补全", Width=60, MinimumWidth=60 });
            grid.Columns.Add(new DataGridViewTextBoxColumn { Name="Name", HeaderText="组件", ReadOnly=true, AutoSizeMode=DataGridViewAutoSizeColumnMode.Fill, FillWeight=30, MinimumWidth=160 });
            grid.Columns.Add(new DataGridViewTextBoxColumn { Name="Status", HeaderText="状态", ReadOnly=true, Width=120 });
            grid.Columns.Add(new DataGridViewTextBoxColumn { Name="Detail", HeaderText="检测结果", ReadOnly=true, AutoSizeMode=DataGridViewAutoSizeColumnMode.Fill, FillWeight=70, MinimumWidth=200 });
            grid.CurrentCellDirtyStateChanged+=delegate { if (grid.IsCurrentCellDirty) grid.CommitEdit(DataGridViewDataErrorContexts.Commit); };
            grid.CellValueChanged+=delegate { UpdateRepairButton(); };
            grid.CellBeginEdit+=delegate(object sender, DataGridViewCellCancelEventArgs args) { ComponentInspection item=grid.Rows[args.RowIndex].Tag as ComponentInspection; if (Busy || item == null || !item.CanRepair) args.Cancel=true; };
            grid.SelectionChanged+=delegate { ComponentInspection item=grid.CurrentRow == null ? null : grid.CurrentRow.Tag as ComponentInspection; detail.Text=item == null ? "" : item.Component.name+"\r\n位置："+item.Component.directory+"\r\n"+item.Detail; };
            Theme.StyleGrid(grid);
            detail.Dock=DockStyle.Bottom; detail.Height=92; detail.Multiline=true; detail.ReadOnly=true; detail.ScrollBars=ScrollBars.Vertical;
            detail.BackColor=Theme.Surface; detail.ForeColor=Theme.Muted; detail.BorderStyle=BorderStyle.None;
            Controls.Add(grid); Controls.Add(detail); Controls.Add(header);
        }
        private Button Button(string text)
        { Button button=new ThemeButton { Text=text, AutoSize=true, MinimumSize=new Size(104,40), Margin=new Padding(0,0,8,4) }; actions.Add(button); return button; }
        private void SetBusy(bool value)
        { Busy=value; foreach (Button button in actions) button.Enabled=!value; cancel.Enabled=value; UpdateRepairButton(); }
        private void UpdateRepairButton()
        {
            if (repair == null) return;
            bool selected=false;
            foreach (DataGridViewRow row in grid.Rows) { ComponentInspection item=row.Tag as ComponentInspection; if (item != null && item.CanRepair && Convert.ToBoolean(row.Cells["Selected"].Value)) { selected=true; break; } }
            repair.Enabled=!Busy && selected;
        }
        internal async Task CheckAsync(bool complete)
        {
            if (Busy) return; cancellation=new CancellationTokenSource(); SetBusy(true); summary.Text=complete ? "正在完整校验运行文件……" : "正在检测组件目录与关键文件……";
            try { List<ComponentInspection> rows=await Task.Run(delegate { return store.Scan(complete,cancellation.Token); }); if (!IsDisposed) Bind(rows); }
            catch (OperationCanceledException) { if (!IsDisposed) summary.Text="检测已取消。"; }
            catch (Exception error) { if (!IsDisposed) summary.Text=error.Message; }
            finally { if (!IsDisposed) SetBusy(false); cancellation.Dispose(); cancellation=null; }
        }
        private void Bind(List<ComponentInspection> rows)
        {
            grid.Rows.Clear(); int findings=0, optional=0;
            foreach (ComponentInspection item in rows) {
                int index=grid.Rows.Add(false,item.Component.name,item.Status,item.Detail); grid.Rows[index].Tag=item;
                grid.Rows[index].Cells["Selected"].ReadOnly=!item.CanRepair;
                grid.Rows[index].Cells["Status"].Style.ForeColor=item.Status == "完整" ? Theme.Accent : item.CanRepair ? Theme.Warning : Theme.Muted;
                if (item.Status == "未安装") optional++;
                else if (item.Status != "完整") findings++;
            }
            summary.Text=rows.Count+" 个组件 · "+findings+" 项需要关注"+(optional > 0 ? " · "+optional+" 项未选装" : "")+"；请选择需要补全的组件。";
            if (FindingsChanged != null) FindingsChanged(findings);
            UpdateRepairButton();
        }
        private async Task RepairSelected()
        {
            if (Busy || operationBusy()) { summary.Text="正在执行服务操作，请完成后再补全组件。"; return; }
            List<string> selected=new List<string>(), names=new List<string>();
            foreach (DataGridViewRow row in grid.Rows) if (Convert.ToBoolean(row.Cells["Selected"].Value)) {
                ComponentInspection item=row.Tag as ComponentInspection; if (item != null && item.CanRepair) { selected.Add(item.Component.id); names.Add(item.Component.name); }
            }
            if (selected.Count == 0) { summary.Text="请先勾选需要补全的组件。"; return; }
            if (Theme.ShowMessage(this,"将补全："+String.Join("、",names.ToArray())+"\r\n运行中的组件请先关闭。现有配置、绑定和业务数据保留。","确认补全组件",true,false) != DialogResult.OK) return;
            cancellation=new CancellationTokenSource(); SetBusy(true); Repairing=true; List<string> results=new List<string>();
            try {
                foreach (string id in selected) {
                    cancellation.Token.ThrowIfCancellationRequested(); summary.Text="正在补全："+names[selected.IndexOf(id)];
                    try { results.Add(await Task.Run(delegate { return store.Repair(id,cancellation.Token); })); }
                    catch (OperationCanceledException) { throw; }
                    catch (Exception error) { results.Add(names[selected.IndexOf(id)]+"："+error.Message); }
                }
            } catch (OperationCanceledException) { results.Add("已取消后续组件操作。"); }
            finally { Repairing=false; if (!IsDisposed) SetBusy(false); cancellation.Dispose(); cancellation=null; }
            if (IsDisposed) return;
            await CheckAsync(true); if (!IsDisposed) detail.Text=String.Join(Environment.NewLine,results.ToArray());
        }
        protected override void Dispose(bool disposing)
        { if (disposing && cancellation != null) cancellation.Cancel(); base.Dispose(disposing); }
    }
}
