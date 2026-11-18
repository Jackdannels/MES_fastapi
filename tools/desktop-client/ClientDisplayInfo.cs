using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace MESDesktopClient
{
    internal static class ClientDisplayInfo
    {
        [DllImport("user32.dll")] private static extern uint GetDpiForWindow(IntPtr window);
        [DllImport("user32.dll")] private static extern IntPtr GetWindowDpiAwarenessContext(IntPtr window);
        [DllImport("user32.dll")] private static extern int GetAwarenessFromDpiAwarenessContext(IntPtr context);
        [DllImport("user32.dll")] private static extern bool AreDpiAwarenessContextsEqual(IntPtr left, IntPtr right);

        internal static Dictionary<string,object> Read(Control window)
        {
            Dictionary<string,object> result=new Dictionary<string,object> { {"deviceDpi",window.DeviceDpi}, {"windowDpi",window.DeviceDpi}, {"dpiAwareness","unknown"} };
            try {
                IntPtr context=GetWindowDpiAwarenessContext(window.Handle);
                int awareness=GetAwarenessFromDpiAwarenessContext(context);
                result["windowDpi"]=GetDpiForWindow(window.Handle);
                result["dpiAwareness"]=AreDpiAwarenessContextsEqual(context,new IntPtr(-4)) ? "PerMonitorV2" : awareness == 2 ? "PerMonitor" : awareness == 1 ? "SystemAware" : awareness == 0 ? "Unaware" : "unknown";
            } catch (EntryPointNotFoundException) { } catch (DllNotFoundException) { }
            return result;
        }
    }
}
