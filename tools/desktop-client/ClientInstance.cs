using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

namespace MESDesktopClient
{
    internal sealed class ClientInstance : IDisposable
    {
        private readonly ClientConfiguration config;
        private readonly Mutex mutex;
        internal readonly bool IsPrimary;
        private volatile bool stopped;
        private NamedPipeServerStream active;
        private readonly object sync = new object();

        internal ClientInstance(ClientConfiguration configuration, bool controlOnly)
        {
            config = configuration;
            if (controlOnly)
            {
                // Status/close must never create the mutex: a query racing startup
                // would otherwise become the owner and make the real GUI exit.
                try { mutex = Mutex.OpenExisting("Local\\" + config.InstanceKey); IsPrimary = false; }
                catch (WaitHandleCannotBeOpenedException) { IsPrimary = true; }
                return;
            }
            bool created;
            mutex = new Mutex(true, "Local\\" + config.InstanceKey, out created);
            if (created) IsPrimary = true;
            else
            {
                try { IsPrimary = mutex.WaitOne(0); }
                catch (AbandonedMutexException) { IsPrimary = true; }
            }
        }

        private bool OwnerIsRunning()
        {
            if (IsPrimary || mutex == null) return false;
            try
            {
                if (!mutex.WaitOne(0)) return true;
            }
            catch (AbandonedMutexException) { }
            mutex.ReleaseMutex();
            return false;
        }

        internal void Listen(Func<Dictionary<string, object>, Dictionary<string, object>> dispatch, Action<Dictionary<string, object>> completed)
        {
            Task.Run(delegate
            {
                while (!stopped)
                {
                    try
                    {
                        PipeSecurity security = new PipeSecurity();
                        security.SetAccessRuleProtection(true, false);
                        security.AddAccessRule(new PipeAccessRule(WindowsIdentity.GetCurrent().User, PipeAccessRights.FullControl, AccessControlType.Allow));
                        using (NamedPipeServerStream pipe = new NamedPipeServerStream(config.InstanceKey, PipeDirection.InOut, 1,
                            PipeTransmissionMode.Byte, PipeOptions.Asynchronous, 4096, 4096, security))
                        {
                            lock (sync) { if (stopped) return; active = pipe; }
                            pipe.WaitForConnection();
                            // A stalled peer must not prevent subsequent close commands.
                            Task<string> read = Task.Run(delegate { return new StreamReader(pipe, Encoding.UTF8, false, 4096, true).ReadLine(); });
                            if (!read.Wait(3000)) continue;
                            if (String.IsNullOrEmpty(read.Result) || read.Result.Length > 16384) continue;
                            Dictionary<string, object> request = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(read.Result);
                            Dictionary<string, object> response = dispatch(request);
                            using (StreamWriter writer = new StreamWriter(pipe, new UTF8Encoding(false), 4096, true))
                            {
                                writer.WriteLine(new JavaScriptSerializer().Serialize(response));
                                writer.Flush();
                            }
                            completed(request);
                        }
                    }
                    catch (Exception error)
                    {
                        if (!stopped) config.Log("Local command failed: " + error.GetType().Name);
                    }
                    finally { lock (sync) { active = null; } }
                }
            });
        }

        internal Dictionary<string, object> Send(string command, string serverUrl, string tab)
        {
            using (NamedPipeClientStream pipe = new NamedPipeClientStream(".", config.InstanceKey, PipeDirection.InOut, PipeOptions.Asynchronous))
            {
                pipe.Connect(5000);
                using (StreamWriter writer = new StreamWriter(pipe, new UTF8Encoding(false), 4096, true))
                {
                    writer.WriteLine(new JavaScriptSerializer().Serialize(new { command = command, serverUrl = serverUrl, tab = tab }));
                    writer.Flush();
                }
                Task<string> read = Task.Run(delegate { return new StreamReader(pipe, Encoding.UTF8, false, 4096, true).ReadLine(); });
                if (!read.Wait(10000)) throw new TimeoutException("客户端未响应本机命令。");
                return new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(read.Result);
            }
        }

        public void Dispose()
        {
            stopped = true;
            lock (sync) { if (active != null) active.Dispose(); }
            if (mutex != null)
            {
                if (IsPrimary) mutex.ReleaseMutex();
                mutex.Dispose();
            }
        }

        internal static int RunCommand(ClientConfiguration config, ClientInstance instance, string command, string[] args)
        {
            Dictionary<string, object> result;
            try
            {
                result = instance.OwnerIsRunning()
                    ? instance.Send(command, config.Server.AbsoluteUri, ClientConfiguration.Argument(args, "--select-tab", ClientConfiguration.Argument(args, "--show-tab", "")))
                    : new Dictionary<string, object> { { "ok", true }, { "state", "stopped" } };
            }
            catch (Exception)
            {
                // Another close may finish while this caller is connecting/reading.
                if ((command != "close" && command != "status") || instance.OwnerIsRunning()) throw;
                result = new Dictionary<string, object> { { "ok", true }, { "state", "stopped" } };
            }
            object value;
            if (command == "close" && result.TryGetValue("pid", out value))
            {
                try
                {
                    using (Process process = Process.GetProcessById(Convert.ToInt32(value)))
                        if (!process.WaitForExit(15000)) throw new TimeoutException("客户端尚未退出。");
                }
                catch (ArgumentException) { }
            }
            string json = new JavaScriptSerializer().Serialize(result);
            string output = ClientConfiguration.Argument(args, "--result-file", "");
            if (output.Length > 0) File.WriteAllText(Path.GetFullPath(output), json, new UTF8Encoding(false));
            Console.WriteLine(json);
            return result.TryGetValue("ok", out value) && Convert.ToBoolean(value) ? 0 : 8;
        }
    }
}
