using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;

namespace MESProcessControl
{
    public sealed class TcpListenerOwner
    {
        public int Port { get; set; }
        public int ProcessId { get; set; }
    }

    public static class TcpListeners
    {
        // TCP_TABLE_OWNER_PID_LISTENER avoids enumerating established/TIME_WAIT
        // connections through the much heavier NetTCPIP CIM provider.
        private const int ListenerTable = 3;
        private const uint InsufficientBuffer = 122;

        [DllImport("iphlpapi.dll", SetLastError = false)]
        private static extern uint GetExtendedTcpTable(IntPtr table, ref int size,
            [MarshalAs(UnmanagedType.Bool)] bool ordered, int family, int tableClass, uint reserved);

        [StructLayout(LayoutKind.Sequential)]
        private struct Ipv4Row
        {
            public uint State, LocalAddress, LocalPort, RemoteAddress, RemotePort, ProcessId;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct Ipv6Row
        {
            [MarshalAs(UnmanagedType.ByValArray, SizeConst = 16)] public byte[] LocalAddress;
            public uint LocalScope, LocalPort;
            [MarshalAs(UnmanagedType.ByValArray, SizeConst = 16)] public byte[] RemoteAddress;
            public uint RemoteScope, RemotePort, State, ProcessId;
        }

        private static int Port(uint networkOrder)
        {
            return (int)(((networkOrder & 255) << 8) | ((networkOrder >> 8) & 255));
        }

        public static TcpListenerOwner[] Read(int[] ports)
        {
            HashSet<int> wanted = new HashSet<int>(ports);
            List<TcpListenerOwner> result = new List<TcpListenerOwner>();
            ReadFamily(2, wanted, result);
            ReadFamily(23, wanted, result);
            return result.ToArray();
        }

        private static void ReadFamily(int family, HashSet<int> ports, List<TcpListenerOwner> result)
        {
            int size = 0;
            uint status = GetExtendedTcpTable(IntPtr.Zero, ref size, false, family, ListenerTable, 0);
            if (status != 0 && status != InsufficientBuffer) throw new Win32Exception((int)status);
            for (int attempt = 0; attempt < 5; attempt++)
            {
                int capacity = size;
                IntPtr buffer = Marshal.AllocHGlobal(capacity);
                try
                {
                    status = GetExtendedTcpTable(buffer, ref size, false, family, ListenerTable, 0);
                    if (status == InsufficientBuffer) continue;
                    if (status != 0) throw new Win32Exception((int)status);
                    int rowSize = Marshal.SizeOf(family == 2 ? typeof(Ipv4Row) : typeof(Ipv6Row));
                    int count = Marshal.ReadInt32(buffer);
                    if (count < 0 || count > (capacity - 4) / rowSize)
                        throw new InvalidOperationException("Invalid Windows listener table size.");
                    for (int index = 0; index < count; index++)
                    {
                        IntPtr rowPointer = IntPtr.Add(buffer, 4 + index * rowSize);
                        int port, processId;
                        if (family == 2)
                        {
                            Ipv4Row row = (Ipv4Row)Marshal.PtrToStructure(rowPointer, typeof(Ipv4Row));
                            port = Port(row.LocalPort);
                            processId = checked((int)row.ProcessId);
                        }
                        else
                        {
                            Ipv6Row row = (Ipv6Row)Marshal.PtrToStructure(rowPointer, typeof(Ipv6Row));
                            port = Port(row.LocalPort);
                            processId = checked((int)row.ProcessId);
                        }
                        if (ports.Contains(port)) result.Add(new TcpListenerOwner { Port = port, ProcessId = processId });
                    }
                    return;
                }
                finally { Marshal.FreeHGlobal(buffer); }
            }
            throw new InvalidOperationException("Windows listener table changed repeatedly; retry the service action.");
        }
    }
}
