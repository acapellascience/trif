// trif-fence.exe: runs one command inside a Windows AppContainer made for it (a PROTOTYPE of a fence for
// side-panel agent runs' commands on Windows: docs/WINDOWS.md "The sandbox"). Nothing in TRIF uses it yet.
//
//   trif-fence.exe run <spec.json>     run the spec's command inside the container; exits with its status
//   trif-fence.exe sid <name>          print the container's SID (making its profile if need be)
//   trif-fence.exe delete <name>       delete the container's profile
//
// The spec (JSON, UTF-8):
//   name        the AppContainer profile's name, one per run ("trif.run.<id>"): its SID is the run's own
//   capability  a made-up capability name; its SID is given to every run, for what all runs may read
//               (TRIF's code, node)
//   lpac        true: a less-privileged AppContainer (no ALL APPLICATION PACKAGES: what Windows lets
//               every packaged app read, most of HKCU included, is closed too)
//   grant       [{path, rights: "r"|"rw"|"stat", to: "run"|"capability", inherit: true|false}]
//               access-control entries added before the command starts ("stat": read attributes only,
//               this folder only, for programs that look at every folder on a path)
//   deny        [{path, rights: "w"}]  explicit deny entries for the run's SID (a read-only folder inside
//               a writable one)
//   revoke      true: when the command has ended, take the run's entries out again and delete the profile
//   cwd, env    the command's folder and its whole environment ({NAME: value}; none: this program's)
//   command     the command line, as CreateProcess takes it
//   job         true (default): the command and everything it starts are in one job, ended with it; no
//               clipboard, no other programs' windows
//
// No capabilities but the made-up one: no network at all (no internetClient, no privateNetwork, and
// loopback is closed to AppContainers), and no file or registry key that doesn't name the container, the
// capability or (unless lpac) ALL APPLICATION PACKAGES.
//
// Built with the C# compiler every Windows has (.NET Framework 4's csc.exe: C# 5, so no newer syntax):
//   %WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe /nologo /o+ /r:System.Web.Extensions.dll /out:trif-fence.exe fence.cs

using System;
using System.Collections;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Web.Script.Serialization;

static class Fence {
  [DllImport("userenv.dll", CharSet = CharSet.Unicode)]
  static extern int CreateAppContainerProfile(string name, string displayName, string description, IntPtr caps, uint capCount, out IntPtr sid);
  [DllImport("userenv.dll", CharSet = CharSet.Unicode)]
  static extern int DeriveAppContainerSidFromAppContainerName(string name, out IntPtr sid);
  [DllImport("userenv.dll", CharSet = CharSet.Unicode)]
  static extern int DeleteAppContainerProfile(string name);
  [DllImport("kernelbase.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool DeriveCapabilitySidsFromName(string name, out IntPtr groupSids, out uint groupCount, out IntPtr capSids, out uint capCount);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref IntPtr size);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr prev, IntPtr ret);
  [DllImport("kernel32.dll")]
  static extern void DeleteProcThreadAttributeList(IntPtr list);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool CreateProcessW(string app, StringBuilder cmd, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string cwd, ref STARTUPINFOEX si, out PROCESS_INFORMATION pi);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern IntPtr GetStdHandle(int n);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern uint WaitForSingleObject(IntPtr h, uint ms);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool GetExitCodeProcess(IntPtr h, out uint code);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern uint ResumeThread(IntPtr h);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern IntPtr CreateJobObjectW(IntPtr sa, string name);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool SetInformationJobObject(IntPtr job, int cls, IntPtr info, uint len);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool SetHandleInformation(IntPtr h, uint mask, uint flags);

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct STARTUPINFO {
    public int cb; public string lpReserved; public string lpDesktop; public string lpTitle;
    public int dwX; public int dwY; public int dwXSize; public int dwYSize; public int dwXCountChars; public int dwYCountChars;
    public int dwFillAttribute; public int dwFlags; public short wShowWindow; public short cbReserved2; public IntPtr lpReserved2;
    public IntPtr hStdInput; public IntPtr hStdOutput; public IntPtr hStdError;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct STARTUPINFOEX { public STARTUPINFO StartupInfo; public IntPtr lpAttributeList; }
  [StructLayout(LayoutKind.Sequential)]
  struct PROCESS_INFORMATION { public IntPtr hProcess; public IntPtr hThread; public int dwProcessId; public int dwThreadId; }
  [StructLayout(LayoutKind.Sequential)]
  struct SID_AND_ATTRIBUTES { public IntPtr Sid; public uint Attributes; }
  [StructLayout(LayoutKind.Sequential)]
  struct SECURITY_CAPABILITIES { public IntPtr AppContainerSid; public IntPtr Capabilities; public uint CapabilityCount; public uint Reserved; }
  [StructLayout(LayoutKind.Sequential)]
  struct JOBOBJECT_BASIC_LIMIT_INFORMATION {
    public long PerProcessUserTimeLimit; public long PerJobUserTimeLimit; public uint LimitFlags; public UIntPtr MinimumWorkingSetSize; public UIntPtr MaximumWorkingSetSize;
    public uint ActiveProcessLimit; public UIntPtr Affinity; public uint PriorityClass; public uint SchedulingClass;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct IO_COUNTERS { public ulong a; public ulong b; public ulong c; public ulong d; public ulong e; public ulong f; }
  [StructLayout(LayoutKind.Sequential)]
  struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
    public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation; public IO_COUNTERS IoInfo;
    public UIntPtr ProcessMemoryLimit; public UIntPtr JobMemoryLimit; public UIntPtr PeakProcessMemoryUsed; public UIntPtr PeakJobMemoryUsed;
  }

  const uint EXTENDED_STARTUPINFO_PRESENT = 0x00080000, CREATE_UNICODE_ENVIRONMENT = 0x00000400, CREATE_SUSPENDED = 0x00000004, CREATE_NO_WINDOW = 0x08000000;
  const int STARTF_USESTDHANDLES = 0x100;
  static readonly IntPtr PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES = (IntPtr)0x00020009;
  static readonly IntPtr PROC_THREAD_ATTRIBUTE_ALL_APPLICATION_PACKAGES_POLICY = (IntPtr)0x0002000F;
  const uint SE_GROUP_ENABLED = 4;
  const int ALREADY_EXISTS = unchecked((int)0x800700B7);

  static int Fail(string what) { Console.Error.WriteLine("trif-fence: " + what); return 125; }

  static IntPtr ContainerSid(string name) {
    IntPtr sid;
    int hr = CreateAppContainerProfile(name, name, "TRIF: one agent run's commands", IntPtr.Zero, 0, out sid);
    if (hr == ALREADY_EXISTS) hr = DeriveAppContainerSidFromAppContainerName(name, out sid);
    if (hr != 0) throw new Exception("couldn't make the AppContainer " + name + ": 0x" + hr.ToString("x8"));
    return sid;
  }

  static IntPtr CapabilitySid(string name) {
    IntPtr groups, caps; uint ng, nc;
    if (!DeriveCapabilitySidsFromName(name, out groups, out ng, out caps, out nc) || nc < 1) throw new Win32Exception(Marshal.GetLastWin32Error(), "DeriveCapabilitySidsFromName");
    return Marshal.ReadIntPtr(caps);
  }

  static FileSystemRights Rights(string r) {
    if (r == "stat") return FileSystemRights.ReadAttributes | FileSystemRights.Synchronize;
    if (r == "r") return FileSystemRights.ReadAndExecute | FileSystemRights.Synchronize;
    if (r == "rw") return FileSystemRights.Modify | FileSystemRights.Synchronize;
    // "w", for a deny: everything that changes the folder or what's in it (reading stays as granted)
    if (r == "w") return FileSystemRights.Write | FileSystemRights.Delete | FileSystemRights.DeleteSubdirectoriesAndFiles | FileSystemRights.ChangePermissions | FileSystemRights.TakeOwnership;
    throw new Exception("unknown rights " + r);
  }

  static void Acl(string path, SecurityIdentifier who, FileSystemRights rights, bool inherit, AccessControlType type, bool remove) {
    if (Directory.Exists(path)) {
      DirectoryInfo d = new DirectoryInfo(path);
      DirectorySecurity s = d.GetAccessControl(AccessControlSections.Access);
      FileSystemAccessRule rule = new FileSystemAccessRule(who, rights, inherit ? (InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit) : InheritanceFlags.None, PropagationFlags.None, type);
      if (remove) s.RemoveAccessRuleAll(rule); else s.AddAccessRule(rule);
      d.SetAccessControl(s);
    } else if (File.Exists(path)) {
      FileInfo f = new FileInfo(path);
      FileSecurity s = f.GetAccessControl(AccessControlSections.Access);
      FileSystemAccessRule rule = new FileSystemAccessRule(who, rights, type);
      if (remove) s.RemoveAccessRuleAll(rule); else s.AddAccessRule(rule);
      f.SetAccessControl(s);
    } else if (!remove) throw new Exception("nothing at " + path);
  }

  static string Str(Dictionary<string, object> d, string k, string dflt) { object v; return d.TryGetValue(k, out v) && v != null ? Convert.ToString(v) : dflt; }
  static bool Bool(Dictionary<string, object> d, string k, bool dflt) { object v; return d.TryGetValue(k, out v) && v is bool ? (bool)v : dflt; }
  static IEnumerable<Dictionary<string, object>> List(Dictionary<string, object> d, string k) {
    object v;
    if (!d.TryGetValue(k, out v) || v == null) yield break;
    foreach (object o in (IEnumerable)v) yield return (Dictionary<string, object>)o;
  }

  static IntPtr EnvBlock(Dictionary<string, object> env) {
    List<string> keys = new List<string>(env.Keys);
    keys.Sort(StringComparer.OrdinalIgnoreCase);
    StringBuilder b = new StringBuilder();
    foreach (string k in keys) { b.Append(k).Append('=').Append(Convert.ToString(env[k])).Append('\0'); }
    b.Append('\0');
    return Marshal.StringToHGlobalUni(b.ToString());
  }

  static int Run(string specFile) {
    JavaScriptSerializer json = new JavaScriptSerializer();
    json.MaxJsonLength = 16 * 1024 * 1024;
    Dictionary<string, object> spec = json.Deserialize<Dictionary<string, object>>(File.ReadAllText(specFile, Encoding.UTF8));
    string name = Str(spec, "name", null), command = Str(spec, "command", null), capName = Str(spec, "capability", null);
    if (name == null || command == null) return Fail("the spec needs a name and a command");
    bool lpac = Bool(spec, "lpac", false), revoke = Bool(spec, "revoke", false), job = Bool(spec, "job", true);

    IntPtr sid = ContainerSid(name);
    SecurityIdentifier run = new SecurityIdentifier(sid);
    IntPtr capSid = capName != null ? CapabilitySid(capName) : IntPtr.Zero;
    SecurityIdentifier cap = capName != null ? new SecurityIdentifier(capSid) : null;

    List<object[]> mine = new List<object[]>(); // the run's own entries, to take out again
    foreach (Dictionary<string, object> g in List(spec, "grant")) {
      bool toCap = Str(g, "to", "run") == "capability";
      if (toCap && cap == null) return Fail("a grant to the capability, but the spec names none");
      string rights = Str(g, "rights", "r");
      bool inherit = rights != "stat" && Bool(g, "inherit", true);
      Acl(Str(g, "path", ""), toCap ? cap : run, Rights(rights), inherit, AccessControlType.Allow, false);
      if (!toCap) mine.Add(new object[] { Str(g, "path", ""), Rights(rights), inherit, AccessControlType.Allow });
    }
    foreach (Dictionary<string, object> g in List(spec, "deny")) {
      Acl(Str(g, "path", ""), run, Rights(Str(g, "rights", "w")), true, AccessControlType.Deny, false);
      mine.Add(new object[] { Str(g, "path", ""), Rights(Str(g, "rights", "w")), true, AccessControlType.Deny });
    }

    // The attribute list: the container (with the made-up capability), and for lpac the opt-out of ALL
    // APPLICATION PACKAGES.
    IntPtr capsArray = IntPtr.Zero;
    SECURITY_CAPABILITIES sc = new SECURITY_CAPABILITIES();
    sc.AppContainerSid = sid;
    if (capSid != IntPtr.Zero) {
      capsArray = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(SID_AND_ATTRIBUTES)));
      SID_AND_ATTRIBUTES sa = new SID_AND_ATTRIBUTES();
      sa.Sid = capSid; sa.Attributes = SE_GROUP_ENABLED;
      Marshal.StructureToPtr(sa, capsArray, false);
      sc.Capabilities = capsArray; sc.CapabilityCount = 1;
    }
    IntPtr scPtr = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(SECURITY_CAPABILITIES)));
    Marshal.StructureToPtr(sc, scPtr, false);
    int attrs = lpac ? 2 : 1;
    IntPtr size = IntPtr.Zero;
    InitializeProcThreadAttributeList(IntPtr.Zero, attrs, 0, ref size);
    IntPtr list = Marshal.AllocHGlobal(size);
    if (!InitializeProcThreadAttributeList(list, attrs, 0, ref size)) throw new Win32Exception(Marshal.GetLastWin32Error(), "InitializeProcThreadAttributeList");
    if (!UpdateProcThreadAttribute(list, 0, PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES, scPtr, (IntPtr)Marshal.SizeOf(typeof(SECURITY_CAPABILITIES)), IntPtr.Zero, IntPtr.Zero)) throw new Win32Exception(Marshal.GetLastWin32Error(), "UpdateProcThreadAttribute (container)");
    IntPtr optOut = IntPtr.Zero;
    if (lpac) {
      optOut = Marshal.AllocHGlobal(4);
      Marshal.WriteInt32(optOut, 1); // PROCESS_CREATION_ALL_APPLICATION_PACKAGES_OPT_OUT
      if (!UpdateProcThreadAttribute(list, 0, PROC_THREAD_ATTRIBUTE_ALL_APPLICATION_PACKAGES_POLICY, optOut, (IntPtr)4, IntPtr.Zero, IntPtr.Zero)) throw new Win32Exception(Marshal.GetLastWin32Error(), "UpdateProcThreadAttribute (lpac)");
    }

    STARTUPINFOEX si = new STARTUPINFOEX();
    si.StartupInfo.cb = Marshal.SizeOf(typeof(STARTUPINFOEX));
    si.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
    si.StartupInfo.hStdInput = GetStdHandle(-10);
    si.StartupInfo.hStdOutput = GetStdHandle(-11);
    si.StartupInfo.hStdError = GetStdHandle(-12);
    // (this program's own are inheritable when a parent gave them as pipes; made so in any case)
    foreach (IntPtr h in new IntPtr[] { si.StartupInfo.hStdInput, si.StartupInfo.hStdOutput, si.StartupInfo.hStdError }) { if (h != IntPtr.Zero && h != (IntPtr)(-1)) SetHandleInformation(h, 1, 1); }
    si.lpAttributeList = list;

    object envObj;
    IntPtr env = spec.TryGetValue("env", out envObj) && envObj != null ? EnvBlock((Dictionary<string, object>)envObj) : IntPtr.Zero;
    uint flags = EXTENDED_STARTUPINFO_PRESENT | CREATE_NO_WINDOW | (env != IntPtr.Zero ? CREATE_UNICODE_ENVIRONMENT : 0) | (job ? CREATE_SUSPENDED : 0);
    PROCESS_INFORMATION pi;
    int exit = 125;
    IntPtr hJob = IntPtr.Zero;
    try {
      if (!CreateProcessW(null, new StringBuilder(command), IntPtr.Zero, IntPtr.Zero, true, flags, env, Str(spec, "cwd", null), ref si, out pi)) {
        int e = Marshal.GetLastWin32Error();
        return Fail("couldn't start the command in the container: " + new Win32Exception(e).Message + " (" + e + ")");
      }
      if (job) {
        hJob = CreateJobObjectW(IntPtr.Zero, null);
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
        info.BasicLimitInformation.LimitFlags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        int len = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
        IntPtr p = Marshal.AllocHGlobal(len);
        Marshal.StructureToPtr(info, p, false);
        bool ok = SetInformationJobObject(hJob, 9, p, (uint)len); // JobObjectExtendedLimitInformation
        Marshal.FreeHGlobal(p);
        IntPtr ui = Marshal.AllocHGlobal(4);
        Marshal.WriteInt32(ui, 0xFF); // no clipboard, no other programs' windows or handles, no desktop or display changes
        ok = SetInformationJobObject(hJob, 4, ui, 4) && ok; // JobObjectBasicUIRestrictions
        Marshal.FreeHGlobal(ui);
        ok = AssignProcessToJobObject(hJob, pi.hProcess) && ok;
        if (!ok) Console.Error.WriteLine("trif-fence: warning: the job couldn't be set up fully (" + Marshal.GetLastWin32Error() + ")");
        ResumeThread(pi.hThread);
      }
      WaitForSingleObject(pi.hProcess, 0xFFFFFFFF);
      uint code;
      GetExitCodeProcess(pi.hProcess, out code);
      exit = unchecked((int)code);
      CloseHandle(pi.hThread);
      CloseHandle(pi.hProcess);
    } finally {
      if (hJob != IntPtr.Zero) CloseHandle(hJob); // whatever the command left running ends here
      DeleteProcThreadAttributeList(list);
      if (revoke) {
        foreach (object[] m in mine) { try { Acl((string)m[0], run, (FileSystemRights)m[1], (bool)m[2], (AccessControlType)m[3], true); } catch (Exception) { /* the folder went with the run */ } }
        DeleteAppContainerProfile(name);
      }
    }
    return exit;
  }

  static int Main(string[] args) {
    try {
      if (args.Length == 2 && args[0] == "run") return Run(args[1]);
      if (args.Length == 2 && args[0] == "sid") { Console.WriteLine(new SecurityIdentifier(ContainerSid(args[1])).Value); return 0; }
      if (args.Length == 2 && args[0] == "delete") { int hr = DeleteAppContainerProfile(args[1]); return hr == 0 ? 0 : Fail("0x" + hr.ToString("x8")); }
      return Fail("usage: trif-fence run <spec.json> | sid <name> | delete <name>");
    } catch (Exception e) {
      return Fail(e.Message);
    }
  }
}
