using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Web.Script.Serialization;

namespace MESControlCenter
{
    internal static class ControlCenterPaths
    {
        internal static string DesktopRoot { get { return Path.GetDirectoryName(typeof(ControlCenterPaths).Assembly.Location); } }
        internal static string Child(string root, string relative)
        {
            if (String.IsNullOrWhiteSpace(relative) || Path.IsPathRooted(relative) || relative.Contains(":")) throw new InvalidOperationException("组件路径无效。");
            foreach (string part in relative.Replace('\\','/').Split('/'))
                if (part == "." || part == ".." || part.Length == 0) throw new InvalidOperationException("组件路径越界。");
            string basis=Path.GetFullPath(root).TrimEnd('\\','/');
            string result=Path.GetFullPath(Path.Combine(basis,relative.Replace('/',Path.DirectorySeparatorChar)));
            if (!result.StartsWith(basis+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("组件路径越界。");
            for (string current=result; current != null; current=Path.GetDirectoryName(current)) {
                if ((File.Exists(current) || Directory.Exists(current)) && (File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0)
                    throw new InvalidOperationException("组件路径包含链接或重解析点。");
                if (String.Equals(current,basis,StringComparison.OrdinalIgnoreCase)) break;
            }
            return result;
        }

        internal static string ClientPath(string folder, string name)
        {
            string root=DesktopRoot;
            string key=folder == "central-client" ? "central" : folder == "test-client" ? "test" : folder;
            string layout=Path.Combine(root,".mes","layout.json");
            try {
                if (File.Exists(layout)) {
                    Dictionary<string,object> settings=new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(File.ReadAllText(layout));
                    object raw;
                    if (settings.TryGetValue(key,out raw)) {
                        string candidate=Child(root,Convert.ToString(raw)+"/"+name);
                        if (File.Exists(candidate)) return candidate;
                    }
                }
            } catch (Exception error) { if (!(error is IOException || error is ArgumentException || error is InvalidOperationException)) throw; }
            foreach (string candidateFolder in folder == "central-client" ? new[]{"中控管理","central-client"} : folder == "test-client" ? new[]{"测试终端","test-client"} : new[]{folder}) {
                try { string candidate=Child(root,candidateFolder+"/"+name); if (File.Exists(candidate)) return candidate; }
                catch (InvalidOperationException) { }
            }
            return null;
        }

        internal static IEnumerable<string> WorkstationExecutables()
        {
            HashSet<string> paths=new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            string catalog=Path.Combine(DesktopRoot,".mes","components","catalog.json");
            try {
                if (File.Exists(catalog)) {
                    Dictionary<string,object> data=new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(File.ReadAllText(catalog));
                    foreach (object raw in (IEnumerable)data["components"]) {
                        Dictionary<string,object> item=(Dictionary<string,object>)raw;
                        if (Convert.ToString(item["kind"]) != "workstation") continue;
                        string path=Child(DesktopRoot,Convert.ToString(item["directory"])+"/"+Convert.ToString(item["executable"]));
                        if (File.Exists(path)) paths.Add(path);
                    }
                }
            } catch (Exception error) { if (!(error is IOException || error is ArgumentException || error is KeyNotFoundException || error is InvalidOperationException)) throw; }
            // The normal workstation inventory also works when the repair cache was removed.
            foreach (string group in new[]{"工位终端","工位客户端"}) {
                try {
                    string file=Child(DesktopRoot,group+"/工位清单.json");
                    if (!File.Exists(file)) continue;
                    foreach (object raw in (IEnumerable)new JavaScriptSerializer().DeserializeObject(File.ReadAllText(file))) {
                        Dictionary<string,object> item=(Dictionary<string,object>)raw;
                        string folder=Convert.ToString(item["folder"]), name=Convert.ToString(item["executable"]);
                        if (Path.GetFileName(folder) != folder || Path.GetFileName(name) != name) continue;
                        string path=Child(DesktopRoot,group+"/"+folder+"/"+name); if (File.Exists(path)) paths.Add(path);
                    }
                } catch (Exception error) { if (!(error is IOException || error is ArgumentException || error is KeyNotFoundException || error is InvalidOperationException)) throw; }
            }
            return paths;
        }
    }
}
