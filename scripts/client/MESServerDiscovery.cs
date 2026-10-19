using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

namespace MESNetwork
{
    internal static class MESDesktopSettings
    {
        private static readonly string BaseDirectory = Path.GetDirectoryName(typeof(MESDesktopSettings).Assembly.Location);
        private static readonly Dictionary<string, object> Values = Load();

        private static Dictionary<string, object> Load()
        {
            string path = Path.Combine(BaseDirectory, "mes-desktop-tools.json");
            if (!File.Exists(path)) return new Dictionary<string, object>();
            return new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(File.ReadAllText(path))
                ?? new Dictionary<string, object>();
        }

        internal static string Get(string key, string fallback)
        {
            object value;
            return Values.TryGetValue(key, out value) && !String.IsNullOrWhiteSpace(Convert.ToString(value))
                ? Convert.ToString(value).Trim().TrimEnd('/') : fallback;
        }

        internal static string ServerUrl(string fallback) { return Get("serverUrl", fallback); }
        internal static string PortLabel(string key, string fallback)
        {
            return ":" + new Uri(Get(key, fallback)).Port;
        }

        internal static bool IsDocker
        {
            get { return File.Exists(Path.Combine(BaseDirectory, "scripts", "docker-service-control.ps1")); }
        }

        internal static string ControlRoot(string fallback) { return IsDocker ? BaseDirectory : fallback; }
    }

    internal static class MESServerDiscovery
    {
        internal const string ServiceMarker = "MES_FASTAPI";
        internal const int FrontendPort = 5173;
        private const int ProbeTimeoutMilliseconds = 600;
        private const int MaxParallelProbes = 32;

        internal static string Discover(string configuredUrl)
        {
            string fallback = NormalizeBaseUrl(configuredUrl);
            if (IsMesEndpoint(fallback)) return fallback;

            List<string> matches = new List<string>();
            object matchesLock = new object();
            Parallel.ForEach(
                BuildLocalSubnetCandidateUrls(new Uri(fallback).Port),
                new ParallelOptions { MaxDegreeOfParallelism = MaxParallelProbes },
                candidate =>
                {
                    if (!IsMesEndpoint(candidate)) return;
                    lock (matchesLock)
                    {
                        if (!matches.Contains(candidate, StringComparer.OrdinalIgnoreCase)) matches.Add(candidate);
                    }
                }
            );
            return SelectUniqueDiscoveredUrl(fallback, matches);
        }

        internal static string SelectUniqueDiscoveredUrl(string fallback, IEnumerable<string> matches)
        {
            List<string> unique = (matches ?? Enumerable.Empty<string>())
                .Where(value => !String.IsNullOrWhiteSpace(value))
                .Select(NormalizeBaseUrl)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();
            return unique.Count == 1 ? unique[0] : NormalizeBaseUrl(fallback);
        }

        internal static bool RunSelfTest()
        {
            string fallback = "http://192.168.110.15:5173";
            if (SelectUniqueDiscoveredUrl(fallback, new string[0]) != fallback) return false;
            if (SelectUniqueDiscoveredUrl(fallback, new[] { "http://192.168.110.19:5173/" }) != "http://192.168.110.19:5173") return false;
            if (SelectUniqueDiscoveredUrl(fallback, new[] { "http://192.168.110.19:5173", "http://192.168.110.20:5173" }) != fallback) return false;
            if (NormalizeBaseUrl("http://192.0.2.1:15173/") != "http://192.0.2.1:15173") return false;
            Dictionary<string, object> payload = new Dictionary<string, object>
            {
                { "service", ServiceMarker }, { "frontendPort", 5173 }
            };
            // Reverse proxies can publish another port; the reachable MES marker
            // identifies the server, while frontendPort remains a legacy hint.
            if (!IsValidDiscoveryPayload(payload)) return false;
            payload["service"] = "OTHER_SERVICE";
            if (IsValidDiscoveryPayload(payload)) return false;
            return true;
        }

        private static IEnumerable<string> BuildLocalSubnetCandidateUrls(int frontendPort)
        {
            HashSet<string> candidates = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (NetworkInterface adapter in NetworkInterface.GetAllNetworkInterfaces())
            {
                if (adapter.OperationalStatus != OperationalStatus.Up) continue;
                foreach (UnicastIPAddressInformation addressInfo in adapter.GetIPProperties().UnicastAddresses)
                {
                    IPAddress address = addressInfo.Address;
                    if (address.AddressFamily != AddressFamily.InterNetwork || IPAddress.IsLoopback(address)) continue;
                    byte[] bytes = address.GetAddressBytes();
                    if (bytes[0] == 169 && bytes[1] == 254) continue;
                    for (int host = 1; host < 255; host++)
                    {
                        candidates.Add("http://" + bytes[0] + "." + bytes[1] + "." + bytes[2] + "." + host + ":" + frontendPort);
                    }
                }
            }
            return candidates;
        }

        private static bool IsMesEndpoint(string baseUrl)
        {
            try
            {
                HttpWebRequest request = (HttpWebRequest)WebRequest.Create(
                    NormalizeBaseUrl(baseUrl) + "/api/system/discovery"
                );
                request.Method = "GET";
                request.Accept = "application/json";
                request.Timeout = ProbeTimeoutMilliseconds;
                request.ReadWriteTimeout = ProbeTimeoutMilliseconds;
                request.Proxy = null;
                using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
                using (StreamReader reader = new StreamReader(response.GetResponseStream()))
                {
                    Dictionary<string, object> payload = new JavaScriptSerializer()
                        .Deserialize<Dictionary<string, object>>(reader.ReadToEnd());
                    return IsValidDiscoveryPayload(payload);
                }
            }
            catch
            {
                return false;
            }
        }

        private static bool IsValidDiscoveryPayload(Dictionary<string, object> payload)
        {
            int advertisedPort;
            return payload != null && payload.ContainsKey("service")
                && String.Equals(Convert.ToString(payload["service"]), ServiceMarker, StringComparison.Ordinal)
                && payload.ContainsKey("frontendPort")
                && Int32.TryParse(Convert.ToString(payload["frontendPort"]), out advertisedPort)
                && advertisedPort > 0 && advertisedPort <= 65535;
        }

        private static string NormalizeBaseUrl(string value)
        {
            string normalized = (value ?? String.Empty).Trim().TrimEnd('/');
            if (!normalized.StartsWith("http://", StringComparison.OrdinalIgnoreCase)
                && !normalized.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
            {
                normalized = "http://" + normalized;
            }
            Uri uri;
            if (!Uri.TryCreate(normalized, UriKind.Absolute, out uri))
            {
                return "http://192.168.110.15:" + FrontendPort;
            }
            UriBuilder builder = new UriBuilder(uri);
            if (uri.IsDefaultPort && uri.Scheme == Uri.UriSchemeHttp) builder.Port = FrontendPort;
            return builder.Uri.GetLeftPart(UriPartial.Authority).TrimEnd('/');
        }
    }
}
