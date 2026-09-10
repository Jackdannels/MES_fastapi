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
                BuildLocalSubnetCandidateUrls(),
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
            return true;
        }

        private static IEnumerable<string> BuildLocalSubnetCandidateUrls()
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
                        candidates.Add("http://" + bytes[0] + "." + bytes[1] + "." + bytes[2] + "." + host + ":" + FrontendPort);
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
                    return payload != null
                        && payload.ContainsKey("service")
                        && String.Equals(Convert.ToString(payload["service"]), ServiceMarker, StringComparison.Ordinal)
                        && payload.ContainsKey("frontendPort")
                        && Convert.ToInt32(payload["frontendPort"]) == FrontendPort;
                }
            }
            catch
            {
                return false;
            }
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
