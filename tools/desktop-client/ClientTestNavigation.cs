using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Web.Script.Serialization;

namespace MESDesktopClient
{
    internal sealed class ClientTestPage
    {
        internal string Key, Title, Module, LabCode, LabName;
    }

    internal static class ClientTestNavigation
    {
        internal const string ResultPrefix = "mes-test-client-navigation:";
        internal static List<ClientTestPage> Pages()
        {
            List<ClientTestPage> pages = new List<ClientTestPage> {
                new ClientTestPage { Key="central", Title="中控管理", Module="central", LabCode="", LabName="" }
            };
            using (Stream stream = typeof(ClientTestNavigation).Assembly.GetManifestResourceStream("MESWorkstations.json"))
            using (StreamReader reader = new StreamReader(stream, Encoding.UTF8))
            foreach (object raw in (IEnumerable)new JavaScriptSerializer().DeserializeObject(reader.ReadToEnd())) {
                Dictionary<string, object> row = (Dictionary<string, object>)raw;
                string module = Convert.ToString(row["module"]), lab = Convert.ToString(row["labCode"]);
                if (module != "laboratory" && module != "visual" && module != "handover" && module != "staging" && module != "appearance")
                    throw new InvalidOperationException("测试终端目录包含不支持的业务页面。");
                pages.Add(new ClientTestPage { Key=lab.Length > 0 ? lab : module, Module=module,
                    Title=Convert.ToString(row["folder"]), LabCode=lab, LabName=Convert.ToString(row["labName"]) });
            }
            return pages;
        }

        internal static string NavigationScript(ClientTestPage page, string requestId)
        {
            string json = new JavaScriptSerializer().Serialize(new { requestId=requestId, key=page.Key, module=page.Module, labCode=page.LabCode });
            return "window.dispatchEvent(new CustomEvent('mes-test-client-navigate',{detail:" + json + "}));";
        }
    }
}
