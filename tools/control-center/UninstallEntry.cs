using System;using System.Diagnostics;using System.IO;using System.Windows.Forms;
internal static class UninstallEntry {
 [STAThread] static int Main(string[] args){try{
  string root=AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
  string source=Path.Combine(root,".mes","package"),temp=Path.Combine(Path.GetTempPath(),"MES5826-Uninstall-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(temp);
  foreach(string name in new[]{"Uninstall-Delivery.ps1","Mes-Installation.ps1"})File.Copy(Path.Combine(source,name),Path.Combine(temp,name));
  string mode="";bool confirmed=false;
  foreach(string arg in args){if(arg=="--mode=Clean")mode="Clean";else if(arg=="--mode=KeepData")mode="KeepData";else if(arg=="--confirm")confirmed=true;else throw new ArgumentException("不支持的卸载参数。");}
  string arguments="-NoProfile -ExecutionPolicy Bypass -File \""+Path.Combine(temp,"Uninstall-Delivery.ps1")+"\" -InstallDirectory \""+root+"\"";
  if(mode.Length>0&&confirmed)arguments+=" -Mode "+mode+" -ConfirmRemoval";
  Process.Start(new ProcessStartInfo{FileName="powershell.exe",Arguments=arguments,UseShellExecute=true,Verb="runas",WindowStyle=ProcessWindowStyle.Hidden});return 0;
 }catch(Exception error){MessageBox.Show(error.Message,"5826 MES 卸载",MessageBoxButtons.OK,MessageBoxIcon.Error);return 1;}}
}
