using System;
using System.IO;
using System.Net;
using System.Threading.Tasks;

namespace MESProcessControl
{
    public sealed class HttpProbeResponse
    {
        public int StatusCode { get; set; }
        public string Content { get; set; }
    }

    public static class HttpProbes
    {
        // Only transport runs on worker threads. PowerShell keeps the existing
        // HTTP/JSON readiness rules when consuming this ordered response array.
        public static HttpProbeResponse[] Read(string[] urls, int timeoutMilliseconds)
        {
            Task<HttpProbeResponse>[] tasks = new Task<HttpProbeResponse>[urls.Length];
            for (int i = 0; i < urls.Length; i++)
            {
                string url = urls[i];
                tasks[i] = Task.Run(delegate { return ReadOne(url, timeoutMilliseconds); });
            }
            Task.WaitAll(tasks);
            HttpProbeResponse[] responses = new HttpProbeResponse[tasks.Length];
            for (int i = 0; i < tasks.Length; i++) responses[i] = tasks[i].Result;
            return responses;
        }

        private static HttpProbeResponse ReadOne(string url, int timeoutMilliseconds)
        {
            try
            {
                HttpWebRequest request = (HttpWebRequest)WebRequest.Create(url);
                request.Method = "GET";
                request.Proxy = null;
                request.Timeout = Math.Max(1, timeoutMilliseconds);
                request.ReadWriteTimeout = Math.Max(1, timeoutMilliseconds);
                using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
                using (StreamReader reader = new StreamReader(response.GetResponseStream()))
                    return new HttpProbeResponse { StatusCode = (int)response.StatusCode, Content = reader.ReadToEnd() };
            }
            catch (Exception)
            {
                // One unavailable endpoint must not discard the other results.
                return new HttpProbeResponse { StatusCode = 0, Content = "" };
            }
        }
    }
}
