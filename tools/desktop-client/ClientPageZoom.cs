using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Web.Script.Serialization;
using Microsoft.Web.WebView2.WinForms;

namespace MESDesktopClient
{
    // Page zoom is independent of Windows DPI and belongs to this test installation.
    internal sealed class ClientPageZoom
    {
        internal static readonly int[] Levels = { 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200 };
        private const string Prefix = "mes-client-zoom:";
        private readonly ClientConfiguration config;
        private readonly string preferencesPath;
        private WebView2 web;
        private bool applying;
        internal int Percent { get; private set; }

        internal ClientPageZoom(ClientConfiguration configuration)
        {
            config = configuration;
            preferencesPath = Path.Combine(config.DataDirectory, "page-zoom.json");
            Percent = ReadPreference();
        }

        private int ReadPreference()
        {
            try {
                if (!File.Exists(preferencesPath) || new FileInfo(preferencesPath).Length > 4096) return 100;
                Dictionary<string, object> saved = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(File.ReadAllText(preferencesPath, Encoding.UTF8));
                object value;
                if (saved != null && saved.TryGetValue("percent", out value) && value is int && Array.IndexOf(Levels, (int)value) >= 0)
                    return (int)value;
            }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
            catch (ArgumentException) { }
            catch (InvalidOperationException) { }
            return 100;
        }

        private void SavePreference()
        {
            string temporary = preferencesPath + ".new";
            try {
                Directory.CreateDirectory(config.DataDirectory);
                File.WriteAllText(temporary, new JavaScriptSerializer().Serialize(new { percent = Percent }), new UTF8Encoding(false));
                if (File.Exists(preferencesPath)) File.Replace(temporary, preferencesPath, null);
                else File.Move(temporary, preferencesPath);
            }
            catch (IOException error) { config.Log("Page zoom preference could not be saved: " + error.Message); }
            catch (UnauthorizedAccessException error) { config.Log("Page zoom preference could not be saved: " + error.Message); }
        }

        internal void Attach(WebView2 view)
        {
            Detach();
            web = view;
            web.ZoomFactorChanged += OnZoomFactorChanged;
            Restore();
        }

        internal void Detach()
        {
            if (web != null) web.ZoomFactorChanged -= OnZoomFactorChanged;
            web = null;
        }

        private void OnZoomFactorChanged(object sender, EventArgs args)
        {
            // Navigations can change the renderer's site zoom; keep the saved page size.
            if (!applying) Restore();
        }

        internal void Restore()
        {
            if (web == null || web.IsDisposed || web.CoreWebView2 == null || applying) return;
            applying = true;
            try {
                double factor = Percent / 100.0;
                if (Math.Abs(web.ZoomFactor - factor) > 0.0001) web.ZoomFactor = factor;
                if (config.AllowsNavigation(web.CoreWebView2.Source))
                    web.CoreWebView2.PostWebMessageAsJson(new JavaScriptSerializer().Serialize(new {
                        type = "mes-client-zoom", percent = (int)Math.Round(web.ZoomFactor * 100), levels = Levels
                    }));
            }
            finally { applying = false; }
        }

        internal bool HandleRequest(string request)
        {
            if (request == null || !request.StartsWith(Prefix, StringComparison.Ordinal)) return false;
            int index = Array.IndexOf(Levels, Percent);
            int next = Percent;
            switch (request.Substring(Prefix.Length)) {
                case "get": break;
                case "in": next = Levels[Math.Min(Levels.Length - 1, index + 1)]; break;
                case "out": next = Levels[Math.Max(0, index - 1)]; break;
                case "reset": next = 100; break;
                default: return true;
            }
            if (next != Percent) { Percent = next; SavePreference(); }
            Restore();
            return true;
        }

        internal static string InputScript()
        {
            // One owner handles each gesture. Browser zoom remains disabled, so
            // the same wheel/key cannot also trigger a second browser zoom step.
            return @"(()=>{
                if(window.top!==window)return;
                const send=action=>window.chrome.webview.postMessage('mes-client-zoom:'+action);
                window.addEventListener('wheel',event=>{
                    if(!event.ctrlKey||event.altKey||event.metaKey||!event.deltaY)return;
                    event.preventDefault();event.stopImmediatePropagation();
                    send(event.deltaY<0?'in':'out');
                },{capture:true,passive:false});
                window.addEventListener('keydown',event=>{
                    if(!event.ctrlKey||event.altKey||event.metaKey)return;
                    const action=event.key==='0'||event.code==='Numpad0'?'reset'
                        :event.key==='+'||event.key==='='||event.code==='NumpadAdd'?'in'
                        :event.key==='-'||event.code==='NumpadSubtract'?'out':'';
                    if(!action)return;
                    event.preventDefault();event.stopImmediatePropagation();send(action);
                },{capture:true});
            })();";
        }
    }
}
