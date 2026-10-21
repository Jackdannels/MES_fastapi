using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Text.RegularExpressions;
using MESNetwork;

namespace MESControlCenter
{
    internal sealed class LanInterface
    {
        internal string Name;
        internal string Address;
        internal bool HasGateway;
    }

    internal sealed class MesAccessRow
    {
        public string Adapter { get; set; }
        public string Address { get; set; }
        public string Url { get; set; }
        public string Status { get; set; }
        internal bool Verified;
    }

    internal sealed class MesAccessReport
    {
        internal string LocalUrl;
        internal string BindingSummary;
        internal string Guidance;
        internal List<MesAccessRow> Rows;
    }

    internal static class MESAccessInfo
    {
        internal static string InitialServerUrl()
        {
            // A local deployment already has an explicit endpoint. Do not scan
            // every attached /24 synchronously while the services are starting.
            return MESDesktopSettings.ServerUrl(MESDesktopSettings.IsDocker || MESDesktopSettings.IsNative
                ? "http://127.0.0.1:15173" : "http://127.0.0.1:5173");
        }

        internal static bool IsLanAddress(string value)
        {
            IPAddress address;
            if (!IPAddress.TryParse(value, out address) || address.AddressFamily != AddressFamily.InterNetwork) return false;
            byte[] bytes = address.GetAddressBytes();
            return !IPAddress.IsLoopback(address) && bytes[0] != 0 && bytes[0] < 224
                && !(bytes[0] == 169 && bytes[1] == 254);
        }

        internal static bool IsLanAdapter(string name, string description, NetworkInterfaceType type)
        {
            if (type != NetworkInterfaceType.Ethernet && type != NetworkInterfaceType.Wireless80211
                && type != NetworkInterfaceType.GigabitEthernet && type != NetworkInterfaceType.FastEthernetFx
                && type != NetworkInterfaceType.FastEthernetT) return false;
            return !Regex.IsMatch(name + " " + description,
                @"vEthernet|WSL|Docker|Hyper-V|VirtualBox|VMware|Loopback|Tunnel|TAP-Windows|Virtual Ethernet",
                RegexOptions.IgnoreCase);
        }

        internal static List<LanInterface> Interfaces()
        {
            List<LanInterface> result = new List<LanInterface>();
            foreach (NetworkInterface adapter in NetworkInterface.GetAllNetworkInterfaces())
            {
                if (adapter.OperationalStatus != OperationalStatus.Up
                    || !IsLanAdapter(adapter.Name, adapter.Description, adapter.NetworkInterfaceType)) continue;
                try
                {
                    IPInterfaceProperties properties = adapter.GetIPProperties();
                    bool gateway = properties.GatewayAddresses.Any(item => IsLanAddress(item.Address.ToString()));
                    foreach (UnicastIPAddressInformation item in properties.UnicastAddresses)
                    {
                        string address = item.Address.ToString();
                        if (IsLanAddress(address)) result.Add(new LanInterface { Name = adapter.Name, Address = address, HasGateway = gateway });
                    }
                }
                catch (NetworkInformationException) { }
            }
            return result.OrderByDescending(item => item.HasGateway).ThenBy(item => item.Name).ThenBy(item => item.Address).ToList();
        }

        internal static bool BindingAllows(string binding, string address)
        {
            // An IPv6-only listener does not prove that IPv4 is published.
            return binding == "0.0.0.0" || String.Equals(binding, address, StringComparison.OrdinalIgnoreCase);
        }

        private static List<string> HostBindings(Dictionary<string, object> info, string key, int port)
        {
            object value;
            if (info == null || !info.TryGetValue(key, out value)) return new List<string>();
            System.Collections.IEnumerable items = value as System.Collections.IEnumerable;
            List<string> result = new List<string>();
            if (items == null) return result;
            foreach (object item in items)
            {
                Dictionary<string, object> entry = item as Dictionary<string, object>;
                int published;
                if (entry != null && Int32.TryParse(Value(entry, "port"), out published) && published == port)
                    result.Add(Value(entry, "hostIp"));
            }
            return result;
        }

        private static string Value(Dictionary<string, object> info, string key)
        {
            object value;
            return info != null && info.TryGetValue(key, out value) ? Convert.ToString(value) : "";
        }

        internal static MesAccessReport Build(string serverUrl, bool docker, Dictionary<string, object> info,
            List<LanInterface> interfaces, Func<string, bool> probe)
        {
            Uri server = new Uri(serverUrl);
            int port = server.Port;
            int configuredPort;
            if (docker && Int32.TryParse(Value(info, "webPort"), out configuredPort) && configuredPort > 0 && configuredPort <= 65535)
                port = configuredPort;
            bool engineAvailable = String.Equals(Value(info, "engineAvailable"), "true", StringComparison.OrdinalIgnoreCase);
            bool running = String.Equals(Value(info, "running"), "true", StringComparison.OrdinalIgnoreCase);
            List<string> bindings = HostBindings(info, "bindings", port);
            List<string> configured = HostBindings(info, "configuredBindings", port);
            if (!docker)
            {
                bindings = IPGlobalProperties.GetIPGlobalProperties().GetActiveTcpListeners()
                    .Where(endpoint => endpoint.Port == port).Select(endpoint => endpoint.Address.ToString()).ToList();
                running = bindings.Count > 0;
            }
            List<string> displayed = bindings.Count > 0 ? bindings : configured;
            MesAccessReport report = new MesAccessReport
            {
                LocalUrl = new UriBuilder(server.Scheme, "127.0.0.1", port).Uri.GetLeftPart(UriPartial.Authority),
                BindingSummary = (bindings.Count > 0 ? "当前 Web 监听：" : "配置的 Web 绑定：")
                    + (displayed.Count > 0 ? String.Join("、", displayed.Select(ip => ip + ":" + port)) : "尚未读取")
                    + (docker && !engineAvailable ? "  ·  Docker 未运行或状态不可查询" : running ? "  ·  服务运行中" : "  ·  服务未运行"),
                Guidance = "其他电脑需与 MES 主机网络互通，并使用下方主机地址。主机验证通过不代表已通过其他电脑或防火墙验证。",
                Rows = new List<MesAccessRow>()
            };
            foreach (LanInterface adapter in interfaces)
            {
                string url = new UriBuilder(server.Scheme, adapter.Address, port).Uri.GetLeftPart(UriPartial.Authority);
                bool allowed = bindings.Any(binding => BindingAllows(binding, adapter.Address));
                bool verified = allowed && running && probe(url);
                string status = verified ? "主机访问通过；待异机验证"
                    : allowed && running ? "已监听；MES 尚未响应"
                    : docker && !engineAvailable ? "未验证 Docker 当前监听"
                    : !running ? "服务未运行（候选地址）"
                    : "未开放该网卡（候选地址）";
                report.Rows.Add(new MesAccessRow { Adapter = adapter.Name, Address = adapter.Address, Url = url, Status = status, Verified = verified });
            }
            if (docker && displayed.Count > 0 && displayed.All(ip => ip == "127.0.0.1" || ip == "::1"))
                report.Guidance = "当前 Web 仅绑定本机，其他电脑无法访问。v2.5 默认自动配置局域网：请点击“重启系统”应用新的 Web 监听和公开地址，首次可用管理员身份运行以配置防火墙。若显式设置了 MES_NETWORK_MODE=manual，则按现场配置处理。下方是候选地址。";
            if (interfaces.Count == 0)
                report.Guidance = "未检测到启用的有线或 Wi-Fi IPv4 地址。请连接局域网后刷新。WSL、Docker、虚拟机及回环网卡不列为工作站访问地址。";
            string preferred = Value(info, "publicUrl").TrimEnd('/');
            report.Rows = report.Rows.OrderByDescending(row => String.Equals(row.Url, preferred, StringComparison.OrdinalIgnoreCase)).ToList();
            return report;
        }

        internal static bool RunSelfTest()
        {
            if (IsLanAddress("127.0.0.1") || IsLanAddress("169.254.1.2") || IsLanAddress("0.0.0.0")
                || IsLanAddress("224.0.0.1") || IsLanAddress("::1") || !IsLanAddress("192.168.110.15")) return false;
            if (IsLanAdapter("vEthernet (WSL)", "", NetworkInterfaceType.Ethernet)
                || !IsLanAdapter("以太网", "Intel Ethernet", NetworkInterfaceType.Ethernet)) return false;
            if (BindingAllows("127.0.0.1", "192.168.110.15") || BindingAllows("::", "192.168.110.15")
                || !BindingAllows("0.0.0.0", "192.168.110.15")) return false;
            return true;
        }
    }
}
