using System;
using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;
[assembly:System.Runtime.Versioning.TargetFramework(".NETFramework,Version=v4.8")]
internal static class DesktopEntry {
 [STAThread] static int Main(string[] args){
  Application.EnableVisualStyles();
  try{
   string own=Path.GetFullPath(Application.ExecutablePath),root,id;
   string key;using(SHA256 hash=SHA256.Create())key=BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(own.ToUpperInvariant()))).Replace("-","").ToLowerInvariant();
   using(RegistryKey registration=Registry.LocalMachine.OpenSubKey(@"SOFTWARE\5826MES\DesktopEntries\"+key)){
    if(registration==null)throw new InvalidOperationException("未找到此入口对应的安装，请使用安装程序修复桌面入口。");
    root=Convert.ToString(registration.GetValue("root"));id=Convert.ToString(registration.GetValue("installationId"));
    if(Convert.ToString(registration.GetValue("role"))!=EntryRole.Value)throw new InvalidOperationException("桌面入口角色不匹配。");
   }
   string marker=Path.Combine(root,".mes","installation.json");
   var data=new JavaScriptSerializer().Deserialize<System.Collections.Generic.Dictionary<string,object>>(File.ReadAllText(marker));
   if(Convert.ToString(data["installationId"])!=id||!String.Equals(Path.GetFullPath(Convert.ToString(data["root"])),Path.GetFullPath(root),StringComparison.OrdinalIgnoreCase))throw new InvalidOperationException("安装记录与此入口不一致。");
   string target=Path.Combine(root,EntryRole.Value=="controller"?"MES控制中心.exe":@"中控管理\MES中控管理.exe");
   if(!File.Exists(target))throw new FileNotFoundException("系统运行文件缺失，请通过控制中心系统完整性或安装程序修复。");
   if(Array.IndexOf(args,"--validate-target")>=0){
    Console.SetOut(new StreamWriter(Console.OpenStandardOutput(),new UTF8Encoding(false)){AutoFlush=true});
    Console.WriteLine(new JavaScriptSerializer().Serialize(new{ok=true,role=EntryRole.Value,target=target,installationId=id}));return 0;
   }
   string arguments="";foreach(string arg in args){if(arg.IndexOf('"')>=0)throw new ArgumentException("启动参数无效。");arguments+=" \""+arg+"\"";}
   using(Process process=Process.Start(new ProcessStartInfo{FileName=target,Arguments=arguments,WorkingDirectory=Path.GetDirectoryName(target),UseShellExecute=true})){}
   return 0;
  }catch(Exception error){MessageBox.Show(error.Message,"5826 MES 启动提示",MessageBoxButtons.OK,MessageBoxIcon.Error);return 1;}
 }
}
