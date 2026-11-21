// TRIF's full sandbox on Windows: TRIF's own Windows Filtering Platform filters (whole-box step 9b', W3).
//
// Round 10 found that Windows Firewall rules don't filter traffic inside this computer (loopback): with the
// loopback exemption the container reached every port here. These filters are TRIF's own, below the
// firewall, for TRIF's one container (its package SID), in a sublayer of TRIF's at the highest weight:
//   - connect (IPv4): permit TCP to 127.0.0.1 at TRIF's two ports (the relay, the key proxy); block the rest
//   - connect (IPv6), accept (inbound, both), listen (both): block
// A block in any sublayer wins over the firewall's permits (WFP arbitration), so whatever else allows, the
// container reaches TRIF's two ports and nothing else. Persistent (they stay across restarts), added and
// removed in the one administrator step (winbox.js: compiled there from this text with Add-Type), and read
// back without one (`status`).
//
//   wfp add <container SID> <relay port> <key proxy port>    (administrator)
//   wfp remove                                                (administrator)
//   wfp status                                                (what's there, as JSON)
//
// Every command prints one line of JSON. TrifWfp.Run(args) returns the same (for PowerShell's Add-Type).
// x64 only (the struct offsets below).

using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class TrifWfp
{
    // ------------------------------------------------------------------ TRIF's keys (fixed, so remove/status find them)
    public static readonly Guid Provider = new Guid("5452e1f0-7769-4b49-8000-747269660001");
    public static readonly Guid SubLayer = new Guid("5452e1f0-7769-4b49-8000-747269660002");
    const ushort SubLayerWeight = 0xFFFF;

    // ------------------------------------------------------------------ Windows' names
    static readonly Guid LAYER_CONNECT_V4 = new Guid("c38d57d1-05a7-4c33-904f-7fbceee60e82");
    static readonly Guid LAYER_CONNECT_V6 = new Guid("4a72393b-319f-44bc-84c3-ba54dcb3b6b4");
    static readonly Guid LAYER_ACCEPT_V4 = new Guid("e1cd9fe7-f4b5-4273-96c0-592e487b8650");
    static readonly Guid LAYER_ACCEPT_V6 = new Guid("a3b42c97-9f04-4672-b87e-cee9c483257f");
    static readonly Guid LAYER_LISTEN_V4 = new Guid("88bb5dad-76d7-4227-9c71-df0a3ed7be7e");
    static readonly Guid LAYER_LISTEN_V6 = new Guid("7ac9de24-17dd-4814-b4bd-a9fbc95a321b");
    static readonly Guid COND_PACKAGE = new Guid("71bc78fa-f17c-4997-a602-6abb261f351c");
    static readonly Guid COND_REMOTE_ADDR = new Guid("b235ae9a-1d64-49b8-a44c-5ff3d9095045");
    static readonly Guid COND_REMOTE_PORT = new Guid("c35a604d-d22b-4e1a-91b4-68f674ee674b");
    static readonly Guid COND_PROTOCOL = new Guid("3971ef2b-623e-4f9a-8cb1-6e79b806b9a7");

    static readonly Dictionary<Guid, string> Names = new Dictionary<Guid, string> {
        { LAYER_CONNECT_V4, "connect4" }, { LAYER_CONNECT_V6, "connect6" }, { LAYER_ACCEPT_V4, "accept4" },
        { LAYER_ACCEPT_V6, "accept6" }, { LAYER_LISTEN_V4, "listen4" }, { LAYER_LISTEN_V6, "listen6" },
        { COND_PACKAGE, "package" }, { COND_REMOTE_ADDR, "remoteAddress" }, { COND_REMOTE_PORT, "remotePort" },
        { COND_PROTOCOL, "protocol" },
    };

    const uint RPC_C_AUTHN_WINNT = 10;
    const uint FWP_UINT8 = 1, FWP_UINT16 = 2, FWP_UINT32 = 3, FWP_SID = 13, FWP_RANGE = 0x102;
    const uint MATCH_EQUAL = 0, MATCH_RANGE = 5;
    const uint ACTION_BLOCK = 0x1001, ACTION_PERMIT = 0x1002;
    const uint FILTER_PERSISTENT = 0x1, FILTER_CLEAR_ACTION_RIGHT = 0x8;
    const uint E_FILTER_NOT_FOUND = 0x80320003, E_PROVIDER_NOT_FOUND = 0x80320005, E_SUBLAYER_NOT_FOUND = 0x80320007;

    // The filters: key, name, layer, permit?, weight in the sublayer (permit above the blocks).
    class Spec { public Guid Key; public string Name; public Guid Layer; public bool Permit; public byte Weight; }
    static readonly Spec[] Filters = {
        new Spec { Key = new Guid("5452e1f0-7769-4b49-8000-747269660010"), Name = "TRIF full sandbox: TRIF's relay and key proxy", Layer = LAYER_CONNECT_V4, Permit = true, Weight = 15 },
        new Spec { Key = new Guid("5452e1f0-7769-4b49-8000-747269660011"), Name = "TRIF full sandbox: every other connection (IPv4)", Layer = LAYER_CONNECT_V4, Weight = 1 },
        new Spec { Key = new Guid("5452e1f0-7769-4b49-8000-747269660012"), Name = "TRIF full sandbox: every connection (IPv6)", Layer = LAYER_CONNECT_V6, Weight = 1 },
        new Spec { Key = new Guid("5452e1f0-7769-4b49-8000-747269660013"), Name = "TRIF full sandbox: inbound (IPv4)", Layer = LAYER_ACCEPT_V4, Weight = 1 },
        new Spec { Key = new Guid("5452e1f0-7769-4b49-8000-747269660014"), Name = "TRIF full sandbox: inbound (IPv6)", Layer = LAYER_ACCEPT_V6, Weight = 1 },
        new Spec { Key = new Guid("5452e1f0-7769-4b49-8000-747269660015"), Name = "TRIF full sandbox: listening (IPv4)", Layer = LAYER_LISTEN_V4, Weight = 1 },
        new Spec { Key = new Guid("5452e1f0-7769-4b49-8000-747269660016"), Name = "TRIF full sandbox: listening (IPv6)", Layer = LAYER_LISTEN_V6, Weight = 1 },
    };

    // ------------------------------------------------------------------ fwpuclnt.dll
    [DllImport("fwpuclnt.dll", CharSet = CharSet.Unicode)] static extern uint FwpmEngineOpen0(string server, uint authn, IntPtr ident, IntPtr session, out IntPtr engine);
    [DllImport("fwpuclnt.dll")] static extern uint FwpmEngineClose0(IntPtr engine);
    [DllImport("fwpuclnt.dll")] static extern uint FwpmTransactionBegin0(IntPtr engine, uint flags);
    [DllImport("fwpuclnt.dll")] static extern uint FwpmTransactionCommit0(IntPtr engine);
    [DllImport("fwpuclnt.dll")] static extern uint FwpmTransactionAbort0(IntPtr engine);
    [DllImport("fwpuclnt.dll")] static extern uint FwpmProviderAdd0(IntPtr engine, IntPtr provider, IntPtr sd);
    [DllImport("fwpuclnt.dll")] static extern uint FwpmProviderDeleteByKey0(IntPtr engine, ref Guid key);
    [DllImport("fwpuclnt.dll")] static extern uint FwpmSubLayerAdd0(IntPtr engine, IntPtr subLayer, IntPtr sd);
    [DllImport("fwpuclnt.dll")] static extern uint FwpmSubLayerDeleteByKey0(IntPtr engine, ref Guid key);
    [DllImport("fwpuclnt.dll")] static extern uint FwpmSubLayerGetByKey0(IntPtr engine, ref Guid key, out IntPtr subLayer);
    [DllImport("fwpuclnt.dll")] static extern uint FwpmFilterAdd0(IntPtr engine, IntPtr filter, IntPtr sd, out ulong id);
    [DllImport("fwpuclnt.dll")] static extern uint FwpmFilterDeleteByKey0(IntPtr engine, ref Guid key);
    [DllImport("fwpuclnt.dll")] static extern uint FwpmFilterGetByKey0(IntPtr engine, ref Guid key, out IntPtr filter);
    [DllImport("fwpuclnt.dll")] static extern void FwpmFreeMemory0(ref IntPtr p);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool ConvertStringSidToSidW(string sid, out IntPtr psid);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool ConvertSidToStringSidW(IntPtr psid, out IntPtr str);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool ConvertStringSecurityDescriptorToSecurityDescriptorW(string sddl, uint revision, out IntPtr sd, IntPtr size);
    [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr p);

    // Who may do what with TRIF's provider, sublayer and filters: the system and administrators everything;
    // signed-in users read them (WFP's default is administrators only, and `status` runs before every boxed
    // run as the person, round 11). Reading shows the container's SID and TRIF's two ports, nothing else.
    const string Sddl = "D:(A;;GA;;;SY)(A;;GA;;;BA)(A;;GR;;;AU)";

    // ------------------------------------------------------------------ unmanaged memory (x64 layouts)
    // FWPM_FILTER0 200 bytes: key 0, name 16, description 24, flags 32, providerKey* 40, providerData 48,
    // layerKey 64, subLayerKey 80, weight 96 (type) / 104, numConditions 112, conditions* 120, action 128
    // (type) / 132, context 152, reserved* 168, filterId 176, effectiveWeight 184.
    // FWPM_FILTER_CONDITION0 40: field 0, match 16, value 24 (type) / 32. FWP_RANGE0 32: low 0/8, high 16/24.
    // FWPM_PROVIDER0 64: key 0, name 16, description 24, flags 32, data 40, service* 56.
    // FWPM_SUBLAYER0 72: key 0, name 16, description 24, flags 32, providerKey* 40, data 48, weight 64 (u16).
    class Mem : IDisposable
    {
        readonly List<IntPtr> blocks = new List<IntPtr>();
        readonly List<IntPtr> sids = new List<IntPtr>();
        public IntPtr Alloc(int n) { IntPtr p = Marshal.AllocHGlobal(n); for (int i = 0; i < n; i++) Marshal.WriteByte(p, i, 0); blocks.Add(p); return p; }
        public IntPtr Str(string s) { IntPtr p = Marshal.StringToHGlobalUni(s); blocks.Add(p); return p; }
        public IntPtr GuidPtr(Guid g) { IntPtr p = Alloc(16); WriteGuid(p, 0, g); return p; }
        public IntPtr Sid(string s) { IntPtr p; if (!ConvertStringSidToSidW(s, out p)) throw new Exception("not a SID: " + s); sids.Add(p); return p; }
        public IntPtr Sd(string sddl) { IntPtr p; if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl, 1, out p, IntPtr.Zero)) throw new Exception("security descriptor " + Marshal.GetLastWin32Error()); sids.Add(p); return p; }
        public void Dispose() { foreach (var p in blocks) Marshal.FreeHGlobal(p); foreach (var p in sids) LocalFree(p); }
    }
    static void WriteGuid(IntPtr p, int off, Guid g) { Marshal.Copy(g.ToByteArray(), 0, p + off, 16); }
    static Guid ReadGuid(IntPtr p, int off) { var b = new byte[16]; Marshal.Copy(p + off, b, 0, 16); return new Guid(b); }

    class Cond { public Guid Field; public uint Match; public uint Type; public ulong Value; public IntPtr Ptr; }

    static IntPtr Conditions(Mem m, List<Cond> cs)
    {
        IntPtr a = m.Alloc(40 * Math.Max(1, cs.Count));
        for (int i = 0; i < cs.Count; i++)
        {
            IntPtr c = a + 40 * i;
            WriteGuid(c, 0, cs[i].Field);
            Marshal.WriteInt32(c, 16, (int)cs[i].Match);
            Marshal.WriteInt32(c, 24, (int)cs[i].Type);
            if (cs[i].Ptr != IntPtr.Zero) Marshal.WriteIntPtr(c, 32, cs[i].Ptr); else Marshal.WriteInt64(c, 32, (long)cs[i].Value);
        }
        return a;
    }

    static IntPtr PortRange(Mem m, int low, int high)
    {
        IntPtr r = m.Alloc(32);
        Marshal.WriteInt32(r, 0, (int)FWP_UINT16); Marshal.WriteInt64(r, 8, low);
        Marshal.WriteInt32(r, 16, (int)FWP_UINT16); Marshal.WriteInt64(r, 24, high);
        return r;
    }

    static IntPtr Filter(Mem m, Spec s, List<Cond> cs)
    {
        IntPtr f = m.Alloc(200);
        WriteGuid(f, 0, s.Key);
        Marshal.WriteIntPtr(f, 16, m.Str(s.Name));
        Marshal.WriteIntPtr(f, 24, m.Str("Added by TRIF's full sandbox setting (TRIF.FullSandbox); removed when it's turned off."));
        Marshal.WriteInt32(f, 32, (int)(FILTER_PERSISTENT | (s.Permit ? 0 : FILTER_CLEAR_ACTION_RIGHT)));
        Marshal.WriteIntPtr(f, 40, m.GuidPtr(Provider));
        WriteGuid(f, 64, s.Layer);
        WriteGuid(f, 80, SubLayer);
        Marshal.WriteInt32(f, 96, (int)FWP_UINT8); Marshal.WriteInt64(f, 104, s.Weight);
        Marshal.WriteInt32(f, 112, cs.Count);
        Marshal.WriteIntPtr(f, 120, Conditions(m, cs));
        Marshal.WriteInt32(f, 128, (int)(s.Permit ? ACTION_PERMIT : ACTION_BLOCK));
        return f;
    }

    // ------------------------------------------------------------------ commands
    static string Hex(uint e) { return "0x" + e.ToString("x8"); }

    static string Add(IntPtr eng, string sid, int relay, int keyProxy)
    {
        if (!System.Text.RegularExpressions.Regex.IsMatch(sid, @"^S-1-15-2(-\d{1,10}){7}$")) throw new Exception("not an AppContainer SID: " + sid);
        if (relay < 2 || relay > 65534 || keyProxy != relay + 1) throw new Exception("bad ports");
        var steps = new List<string>();
        using (var m = new Mem())
        {
            uint e = FwpmTransactionBegin0(eng, 0);
            if (e != 0) return Fail("transaction " + Hex(e), steps);
            try
            {
                RemoveIn(eng, steps);
                IntPtr sd = m.Sd(Sddl);
                IntPtr p = m.Alloc(64);
                WriteGuid(p, 0, Provider);
                Marshal.WriteIntPtr(p, 16, m.Str("TRIF"));
                Marshal.WriteIntPtr(p, 24, m.Str("TRIF's full sandbox"));
                Marshal.WriteInt32(p, 32, 1); // FWPM_PROVIDER_FLAG_PERSISTENT
                e = FwpmProviderAdd0(eng, p, sd);
                if (e != 0) throw new Exception("provider " + Hex(e));
                steps.Add("provider");
                IntPtr s = m.Alloc(72);
                WriteGuid(s, 0, SubLayer);
                Marshal.WriteIntPtr(s, 16, m.Str("TRIF full sandbox"));
                Marshal.WriteIntPtr(s, 24, m.Str("TRIF's full sandbox: only TRIF's relay and key proxy on this computer"));
                Marshal.WriteInt32(s, 32, 1); // FWPM_SUBLAYER_FLAG_PERSISTENT
                Marshal.WriteIntPtr(s, 40, m.GuidPtr(Provider));
                Marshal.WriteInt16(s, 64, unchecked((short)SubLayerWeight));
                e = FwpmSubLayerAdd0(eng, s, sd);
                if (e != 0) throw new Exception("sublayer " + Hex(e));
                steps.Add("sublayer");
                IntPtr psid = m.Sid(sid);
                foreach (var spec in Filters)
                {
                    var cs = new List<Cond> { new Cond { Field = COND_PACKAGE, Match = MATCH_EQUAL, Type = FWP_SID, Ptr = psid } };
                    if (spec.Permit)
                    {
                        cs.Add(new Cond { Field = COND_PROTOCOL, Match = MATCH_EQUAL, Type = FWP_UINT8, Value = 6 });
                        cs.Add(new Cond { Field = COND_REMOTE_ADDR, Match = MATCH_EQUAL, Type = FWP_UINT32, Value = 0x7F000001 });
                        cs.Add(new Cond { Field = COND_REMOTE_PORT, Match = MATCH_RANGE, Type = FWP_RANGE, Ptr = PortRange(m, relay, keyProxy) });
                    }
                    ulong id;
                    e = FwpmFilterAdd0(eng, Filter(m, spec, cs), sd, out id);
                    if (e != 0) throw new Exception("filter '" + spec.Name + "' " + Hex(e));
                    steps.Add(spec.Key.ToString());
                }
                e = FwpmTransactionCommit0(eng);
                if (e != 0) throw new Exception("commit " + Hex(e));
            }
            catch (Exception x) { FwpmTransactionAbort0(eng); return Fail(x.Message, steps); }
        }
        return "{\"ok\":true,\"steps\":" + List(steps) + "}";
    }

    static void RemoveIn(IntPtr eng, List<string> steps)
    {
        foreach (var spec in Filters)
        {
            Guid k = spec.Key;
            uint e = FwpmFilterDeleteByKey0(eng, ref k);
            if (e != 0 && e != E_FILTER_NOT_FOUND) throw new Exception("delete filter " + Hex(e));
        }
        Guid sl = SubLayer;
        uint r = FwpmSubLayerDeleteByKey0(eng, ref sl);
        if (r != 0 && r != E_SUBLAYER_NOT_FOUND) throw new Exception("delete sublayer " + Hex(r));
        Guid pv = Provider;
        r = FwpmProviderDeleteByKey0(eng, ref pv);
        if (r != 0 && r != E_PROVIDER_NOT_FOUND) throw new Exception("delete provider " + Hex(r));
        steps.Add("removed");
    }

    static string Remove(IntPtr eng)
    {
        var steps = new List<string>();
        uint e = FwpmTransactionBegin0(eng, 0);
        if (e != 0) return Fail("transaction " + Hex(e), steps);
        try
        {
            RemoveIn(eng, steps);
            e = FwpmTransactionCommit0(eng);
            if (e != 0) throw new Exception("commit " + Hex(e));
        }
        catch (Exception x) { FwpmTransactionAbort0(eng); return Fail(x.Message, steps); }
        return "{\"ok\":true,\"steps\":" + List(steps) + "}";
    }

    static string ValueJson(uint type, IntPtr at)
    {
        if (type == FWP_UINT8) return Marshal.ReadByte(at).ToString();
        if (type == FWP_UINT16) return ((ushort)Marshal.ReadInt16(at)).ToString();
        if (type == FWP_UINT32) return ((uint)Marshal.ReadInt32(at)).ToString();
        if (type == FWP_SID)
        {
            IntPtr s; IntPtr psid = Marshal.ReadIntPtr(at);
            if (psid == IntPtr.Zero || !ConvertSidToStringSidW(psid, out s)) return "null";
            string t = Marshal.PtrToStringUni(s); LocalFree(s);
            return Q(t);
        }
        if (type == FWP_RANGE)
        {
            IntPtr r = Marshal.ReadIntPtr(at);
            if (r == IntPtr.Zero) return "null";
            return "[" + ValueJson((uint)Marshal.ReadInt32(r, 0), r + 8) + "," + ValueJson((uint)Marshal.ReadInt32(r, 16), r + 24) + "]";
        }
        return Q("type " + type);
    }

    static string Status(IntPtr eng)
    {
        var sb = new StringBuilder("{\"ok\":true,");
        Guid sl = SubLayer;
        IntPtr s;
        uint e = FwpmSubLayerGetByKey0(eng, ref sl, out s);
        if (e == 0)
        {
            sb.Append("\"sublayer\":{\"weight\":" + ((ushort)Marshal.ReadInt16(s, 64)) + ",\"flags\":" + Marshal.ReadInt32(s, 32) + "},");
            FwpmFreeMemory0(ref s);
        }
        else sb.Append("\"sublayer\":null,\"sublayerError\":" + Q(Hex(e)) + ",");
        sb.Append("\"filters\":[");
        bool first = true;
        foreach (var spec in Filters)
        {
            Guid k = spec.Key;
            IntPtr f;
            e = FwpmFilterGetByKey0(eng, ref k, out f);
            if (!first) sb.Append(",");
            first = false;
            if (e != 0) { sb.Append("{\"key\":" + Q(k.ToString()) + ",\"missing\":" + Q(Hex(e)) + "}"); continue; }
            Guid layer = ReadGuid(f, 64), sub = ReadGuid(f, 80);
            uint action = (uint)Marshal.ReadInt32(f, 128);
            sb.Append("{\"key\":" + Q(k.ToString()) + ",\"name\":" + Q(Marshal.PtrToStringUni(Marshal.ReadIntPtr(f, 16)))
                + ",\"layer\":" + Q(Names.ContainsKey(layer) ? Names[layer] : layer.ToString())
                + ",\"ourSublayer\":" + (sub == SubLayer ? "true" : "false")
                + ",\"flags\":" + Marshal.ReadInt32(f, 32)
                + ",\"action\":" + Q(action == ACTION_BLOCK ? "block" : action == ACTION_PERMIT ? "permit" : Hex(action))
                + ",\"weight\":" + ValueJson((uint)Marshal.ReadInt32(f, 96), f + 104)
                + ",\"conditions\":[");
            int n = Marshal.ReadInt32(f, 112);
            IntPtr cs = Marshal.ReadIntPtr(f, 120);
            for (int i = 0; i < n; i++)
            {
                IntPtr c = cs + 40 * i;
                Guid field = ReadGuid(c, 0);
                uint match = (uint)Marshal.ReadInt32(c, 16), type = (uint)Marshal.ReadInt32(c, 24);
                if (i > 0) sb.Append(",");
                sb.Append("{\"field\":" + Q(Names.ContainsKey(field) ? Names[field] : field.ToString()) + ",\"match\":" + match + ",\"value\":" + ValueJson(type, c + 32) + "}");
            }
            sb.Append("]}");
            FwpmFreeMemory0(ref f);
        }
        sb.Append("]}");
        return sb.ToString();
    }

    // ------------------------------------------------------------------ JSON, entry points
    static string Q(string s)
    {
        if (s == null) return "null";
        var b = new StringBuilder("\"");
        foreach (char c in s)
        {
            if (c == '"' || c == '\\') b.Append('\\').Append(c);
            else if (c < 0x20) b.Append("\\u" + ((int)c).ToString("x4"));
            else b.Append(c);
        }
        return b.Append('"').ToString();
    }
    static string List(List<string> xs) { var p = new List<string>(); foreach (var x in xs) p.Add(Q(x)); return "[" + string.Join(",", p.ToArray()) + "]"; }
    static string Fail(string why, List<string> steps) { return "{\"ok\":false,\"error\":" + Q(why) + ",\"steps\":" + List(steps) + "}"; }

    public static string Run(string[] args)
    {
        if (IntPtr.Size != 8) return Fail("64-bit only", new List<string>());
        string cmd = args.Length > 0 ? args[0] : "";
        IntPtr eng;
        uint e = FwpmEngineOpen0(null, RPC_C_AUTHN_WINNT, IntPtr.Zero, IntPtr.Zero, out eng);
        if (e != 0) return Fail("open the filtering engine " + Hex(e), new List<string>());
        try
        {
            if (cmd == "add" && args.Length == 4) return Add(eng, args[1], int.Parse(args[2]), int.Parse(args[3]));
            if (cmd == "remove") return Remove(eng);
            if (cmd == "status") return Status(eng);
            return Fail("usage: wfp add <sid> <relay port> <key proxy port> | remove | status", new List<string>());
        }
        catch (Exception x) { return Fail(x.Message, new List<string>()); }
        finally { FwpmEngineClose0(eng); }
    }

    public static int Main(string[] args)
    {
        string r = Run(args);
        Console.WriteLine(r);
        return r.StartsWith("{\"ok\":true") ? 0 : 1;
    }
}
