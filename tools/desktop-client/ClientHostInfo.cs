using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Text.RegularExpressions;

namespace MESDesktopClient
{
    internal static class ClientHostInfo
    {
        internal static string[] LocalIpAddresses()
        {
            List<Tuple<bool, string>> addresses = new List<Tuple<bool, string>>();
            try
            {
                foreach (NetworkInterface adapter in NetworkInterface.GetAllNetworkInterfaces())
                {
                    if (adapter.OperationalStatus != OperationalStatus.Up) continue;
                    NetworkInterfaceType type = adapter.NetworkInterfaceType;
                    if (type != NetworkInterfaceType.Ethernet && type != NetworkInterfaceType.Wireless80211
                        && type != NetworkInterfaceType.GigabitEthernet && type != NetworkInterfaceType.FastEthernetFx
                        && type != NetworkInterfaceType.FastEthernetT) continue;
                    if (Regex.IsMatch(adapter.Name + " " + adapter.Description,
                        @"vEthernet|WSL|Docker|Hyper-V|VirtualBox|VMware|Loopback|Tunnel|TAP-Windows|Virtual Ethernet", RegexOptions.IgnoreCase)) continue;
                    try
                    {
                        IPInterfaceProperties properties = adapter.GetIPProperties();
                        bool gateway = properties.GatewayAddresses.Any(item => !IPAddress.IsLoopback(item.Address));
                        foreach (UnicastIPAddressInformation item in properties.UnicastAddresses)
                        {
                            IPAddress ip = item.Address;
                            byte[] bytes = ip.GetAddressBytes();
                            if (ip.AddressFamily == AddressFamily.InterNetwork && !IPAddress.IsLoopback(ip)
                                && bytes[0] != 0 && bytes[0] < 224 && !(bytes[0] == 169 && bytes[1] == 254))
                                addresses.Add(Tuple.Create(gateway, ip.ToString()));
                        }
                    }
                    catch (NetworkInformationException) { }
                }
            }
            catch (NetworkInformationException) { }
            return addresses.OrderByDescending(item => item.Item1).ThenBy(item => item.Item2).Select(item => item.Item2).Distinct().ToArray();
        }
    }
}
