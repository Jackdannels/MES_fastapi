using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;

namespace MESDesktopClient
{
    internal sealed class ClientTerminalAuth
    {
        private readonly ClientConfiguration config;
        internal ClientTerminalAuth(ClientConfiguration configuration) { config = configuration; }
        private string IdentityPath { get { return Path.Combine(config.DataDirectory, "terminal-identity.bin"); } }
        private byte[] Entropy { get { return Encoding.UTF8.GetBytes(config.InstanceKey); } }

        private Dictionary<string, object> Post(string path, object body)
        {
            HttpWebRequest request = (HttpWebRequest)WebRequest.Create(new Uri(config.Server, path));
            request.Method = "POST"; request.ContentType = "application/json";
            request.Timeout = 10000; request.ReadWriteTimeout = 10000;
            request.AllowAutoRedirect = false; request.Proxy = null;
            byte[] data = Encoding.UTF8.GetBytes(new JavaScriptSerializer().Serialize(body));
            request.ContentLength = data.Length;
            using (Stream stream = request.GetRequestStream()) stream.Write(data, 0, data.Length);
            try
            {
                using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
                using (StreamReader reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8))
                    return new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(reader.ReadToEnd());
            }
            catch (WebException error)
            {
                HttpWebResponse response = error.Response as HttpWebResponse;
                if (response != null)
                {
                    int status = (int)response.StatusCode;
                    response.Dispose();
                    throw new InvalidOperationException(status == 401 || status == 403
                        ? "工位认证未通过，请重新绑定此电脑的工位。" : "工位认证服务暂时不可用（" + status + "）。");
                }
                throw new InvalidOperationException("无法连接工位认证服务，请检查服务器和网络。", error);
            }
        }

        private static string Text(Dictionary<string, object> values, string key)
        {
            object value; return values.TryGetValue(key, out value) ? Convert.ToString(value) : "";
        }

        internal void Enroll(string username, string password)
        {
            if (!config.IsWorkstation) throw new InvalidOperationException("中控与模拟器不使用固定工位免登录。");
            string terminalId = "desktop-" + Guid.NewGuid().ToString("N");
            // Re-enrollment rotates only this installation's existing credential.
            if (File.Exists(IdentityPath))
            {
                try { terminalId = Text(ReadIdentity(), "terminalId"); }
                catch (InvalidOperationException) { } // A new origin requires a fresh binding.
            }
            Dictionary<string, object> result = Post("/auth/terminal/register", new {
                username = username, password = password, terminal_id = terminalId,
                terminal_name = Environment.MachineName + " - " + config.Title,
                module = config.Module, lab_name = config.LabName
            });
            if (Text(result, "module") != config.Module || Text(result, "labName") != config.LabName
                || Text(result, "target") != config.EntryPath || Text(result, "terminalId") != terminalId
                || String.IsNullOrWhiteSpace(Text(result, "terminalSecret")))
                throw new InvalidOperationException("服务器返回的工位绑定与此程序不匹配。");
            byte[] identity = Encoding.UTF8.GetBytes(new JavaScriptSerializer().Serialize(new {
                server = config.Server.AbsoluteUri, module = config.Module, labName = config.LabName,
                terminalId = terminalId, terminalSecret = Text(result, "terminalSecret")
            }));
            Directory.CreateDirectory(config.DataDirectory);
            byte[] protectedData = ProtectedData.Protect(identity, Entropy, DataProtectionScope.CurrentUser);
            string temporary = IdentityPath + ".new";
            File.WriteAllBytes(temporary, protectedData);
            if (File.Exists(IdentityPath)) File.Replace(temporary, IdentityPath, null);
            else File.Move(temporary, IdentityPath);
        }

        private Dictionary<string, object> ReadIdentity()
        {
            if (!File.Exists(IdentityPath)) throw new InvalidOperationException("此电脑尚未绑定工位，请先由管理员执行一次工位绑定。");
            Dictionary<string, object> identity;
            try
            {
                identity = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(Encoding.UTF8.GetString(
                    ProtectedData.Unprotect(File.ReadAllBytes(IdentityPath), Entropy, DataProtectionScope.CurrentUser)));
            }
            catch (CryptographicException) { throw new InvalidOperationException("工位凭据不能在此 Windows 用户使用，请重新绑定工位。"); }
            if (Text(identity, "server") != config.Server.AbsoluteUri || Text(identity, "module") != config.Module
                || Text(identity, "labName") != config.LabName || Text(identity, "terminalId").Length == 0)
                throw new InvalidOperationException("服务器地址或工位绑定已变化，请重新绑定工位。");
            return identity;
        }

        internal Uri SignInAddress()
        {
            Dictionary<string, object> identity = ReadIdentity();
            Dictionary<string, object> result = Post("/auth/terminal/ticket", new {
                terminal_id = Text(identity, "terminalId"), terminal_secret = Text(identity, "terminalSecret")
            });
            string ticket = Text(result, "ticket");
            if (Text(result, "target") != config.EntryPath || String.IsNullOrWhiteSpace(ticket))
                throw new InvalidOperationException("服务器返回的工位入口与此程序不匹配。");
            return new Uri(config.Server, "/auth/terminal/consume?ticket=" + Uri.EscapeDataString(ticket));
        }
    }
}
