// TRIF's DNS-SD announcer for Windows (helper/lib/win/dnssd.js builds it with Windows' own C# compiler, as
// the fence is built; helper/lib/phonelink/bonjour.js starts it). Windows' own DNS-SD API (dnsapi.dll,
// Windows 10 1809 and later): no Bonjour install.
//
//   trif-dnssd -R <name> <type> <domain> <port> [key=value ...]
//       Registers <name>.<type>.<domain> on <port> with those TXT entries, as the Mac's `dns-sd -R` does, until
//       its standard input closes (the helper ends it so, or by ending); then deregisters and exits 0. Exits 3
//       when Windows refuses the registration, after saying why on stderr.
//   trif-dnssd -B <type> <domain> <seconds>
//       Browses for <type>.<domain> that long and prints each instance found, one a line (CI's smoke step,
//       and a check by hand).
//
// Nothing else: no shell, no files, no network of its own beyond what Windows' DNS client does for it.

using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;

static class TrifDnsSd
{
    const uint DNS_REQUEST_PENDING = 9506;
    const uint VERSION1 = 1;
    const ushort DNS_TYPE_PTR = 12;

    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    delegate void RegisterComplete(uint status, IntPtr context, IntPtr instance);

    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    delegate void BrowseCallback(uint status, IntPtr context, IntPtr record);

    [StructLayout(LayoutKind.Sequential)]
    struct RegisterRequest
    {
        public uint Version;
        public uint InterfaceIndex;
        public IntPtr pServiceInstance;
        public IntPtr pRegisterCompletionCallback;
        public IntPtr pQueryContext;
        public IntPtr hCredentials;
        public int unicastEnabled;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct BrowseRequest
    {
        public uint Version;
        public uint InterfaceIndex;
        public IntPtr QueryName;
        public IntPtr pBrowseCallback;
        public IntPtr pQueryContext;
    }


    [DllImport("dnsapi.dll", CharSet = CharSet.Unicode)]
    static extern IntPtr DnsServiceConstructInstance(string serviceName, string hostName, IntPtr ip4, IntPtr ip6,
        ushort port, ushort priority, ushort weight, uint propertiesCount,
        [MarshalAs(UnmanagedType.LPArray, ArraySubType = UnmanagedType.LPWStr)] string[] keys,
        [MarshalAs(UnmanagedType.LPArray, ArraySubType = UnmanagedType.LPWStr)] string[] values);

    [DllImport("dnsapi.dll")]
    static extern uint DnsServiceRegister(IntPtr request, IntPtr cancel);

    [DllImport("dnsapi.dll")]
    static extern uint DnsServiceDeRegister(IntPtr request, IntPtr cancel);

    [DllImport("dnsapi.dll")]
    static extern uint DnsServiceBrowse(IntPtr request, IntPtr cancel);

    [DllImport("dnsapi.dll")]
    static extern uint DnsServiceBrowseCancel(IntPtr cancel);

    [DllImport("dnsapi.dll")]
    static extern void DnsRecordListFree(IntPtr list, int freeType);

    // (kept here, so the collector never takes a callback Windows still holds)
    static RegisterComplete onRegistered;
    static BrowseCallback onBrowsed;
    static readonly ManualResetEvent answered = new ManualResetEvent(false);
    static uint lastStatus;
    static readonly HashSet<string> seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

    static int Main(string[] args)
    {
        try
        {
            if (args.Length >= 5 && args[0] == "-R") return Register(args);
            if (args.Length == 4 && args[0] == "-B") return Browse(args);
        }
        catch (EntryPointNotFoundException)
        {
            Console.Error.WriteLine("trif-dnssd: this Windows has no DNS-SD API (Windows 10 1809 or later has it)");
            return 4;
        }
        catch (DllNotFoundException)
        {
            Console.Error.WriteLine("trif-dnssd: dnsapi.dll isn't there");
            return 4;
        }
        Console.Error.WriteLine("usage: trif-dnssd -R <name> <type> <domain> <port> [key=value ...] | -B <type> <domain> <seconds>");
        return 2;
    }

    static int Register(string[] args)
    {
        ushort port;
        if (!ushort.TryParse(args[4], out port) || port == 0) { Console.Error.WriteLine("trif-dnssd: bad port " + args[4]); return 2; }
        string domain = args[3].TrimEnd('.');
        string service = args[1] + "." + args[2] + "." + domain;
        string host = Environment.MachineName + "." + domain;
        var keys = new List<string>();
        var values = new List<string>();
        for (int i = 5; i < args.Length; i++)
        {
            int eq = args[i].IndexOf('=');
            keys.Add(eq < 0 ? args[i] : args[i].Substring(0, eq));
            values.Add(eq < 0 ? "" : args[i].Substring(eq + 1));
        }
        IntPtr instance = DnsServiceConstructInstance(service, host, IntPtr.Zero, IntPtr.Zero, port, 0, 0,
            (uint)keys.Count, keys.ToArray(), values.ToArray());
        if (instance == IntPtr.Zero) { Console.Error.WriteLine("trif-dnssd: Windows couldn't make the record"); return 3; }

        onRegistered = (status, context, inst) => { lastStatus = status; answered.Set(); };
        var req = new RegisterRequest
        {
            Version = VERSION1,
            InterfaceIndex = 0,
            pServiceInstance = instance,
            pRegisterCompletionCallback = Marshal.GetFunctionPointerForDelegate(onRegistered),
            pQueryContext = IntPtr.Zero,
            hCredentials = IntPtr.Zero,
            unicastEnabled = 0,
        };
        IntPtr request = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(RegisterRequest)));
        Marshal.StructureToPtr(req, request, false);

        uint r = DnsServiceRegister(request, IntPtr.Zero);
        if (r != DNS_REQUEST_PENDING) { Console.Error.WriteLine("trif-dnssd: DnsServiceRegister said " + r); return 3; }
        if (!answered.WaitOne(15000)) { Console.Error.WriteLine("trif-dnssd: no answer to the registration in 15 s"); return 3; }
        if (lastStatus != 0) { Console.Error.WriteLine("trif-dnssd: the registration failed (" + lastStatus + ")"); return 3; }
        Console.Out.WriteLine("registered " + service + " port " + port);
        Console.Out.Flush();

        // Until the helper closes our standard input (or ends, which closes it too).
        try { while (Console.In.ReadLine() != null) { } } catch (Exception) { }

        answered.Reset();
        if (DnsServiceDeRegister(request, IntPtr.Zero) == DNS_REQUEST_PENDING) answered.WaitOne(3000);
        return 0;
    }

    static int Browse(string[] args)
    {
        int seconds;
        if (!int.TryParse(args[3], out seconds) || seconds < 1 || seconds > 120) { Console.Error.WriteLine("trif-dnssd: bad seconds " + args[3]); return 2; }
        onBrowsed = (status, context, record) =>
        {
            if (status != 0 || record == IntPtr.Zero) return;
            int ps = IntPtr.Size;
            for (IntPtr p = record; p != IntPtr.Zero; p = Marshal.ReadIntPtr(p, 0))
            {
                ushort type = (ushort)Marshal.ReadInt16(p, 2 * ps);
                if (type != DNS_TYPE_PTR) continue;
                string name = Marshal.PtrToStringUni(Marshal.ReadIntPtr(p, 2 * ps + 16));
                if (name != null && seen.Add(name)) { Console.Out.WriteLine(name); Console.Out.Flush(); }
            }
            DnsRecordListFree(record, 1);
        };
        // (all of it in memory Windows can keep using while the browse goes on: never freed, the process ends)
        var req = new BrowseRequest
        {
            Version = VERSION1,
            InterfaceIndex = 0,
            QueryName = Marshal.StringToHGlobalUni(args[1] + "." + args[2].TrimEnd('.')),
            pBrowseCallback = Marshal.GetFunctionPointerForDelegate(onBrowsed),
            pQueryContext = IntPtr.Zero,
        };
        IntPtr request = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(BrowseRequest)));
        Marshal.StructureToPtr(req, request, false);
        IntPtr cancel = Marshal.AllocHGlobal(IntPtr.Size);
        Marshal.WriteIntPtr(cancel, IntPtr.Zero);
        uint r = DnsServiceBrowse(request, cancel);
        if (r != DNS_REQUEST_PENDING) { Console.Error.WriteLine("trif-dnssd: DnsServiceBrowse said " + r); return 3; }
        Thread.Sleep(seconds * 1000);
        DnsServiceBrowseCancel(cancel);
        return 0;
    }
}
