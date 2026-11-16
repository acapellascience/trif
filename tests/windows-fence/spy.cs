// spy.exe: tries, from inside the fence, what a node script can't ask Windows for (tests/windows-fence/run.js).
//   spy clip           print the clipboard's text
//   spy cmdline <pid>  print another program's command line: asked of WMI, then of the kernel
//                      (NtQueryInformationProcess, which needs only the "limited" right to the process)
//   spy open <pid>     try to open another program to read its memory (where its environment is)
//   spy cred <name>    read a generic credential from Windows Credential Manager (where TRIF keeps API
//                      keys), by its name, then list every credential's name
using System;
using System.Management;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

static class Spy {
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(IntPtr h, int cls, IntPtr info, int len, out int ret);
  [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool CredRead(string target, uint type, uint flags, out IntPtr cred);
  [DllImport("advapi32.dll", EntryPoint = "CredEnumerateW", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool CredEnumerate(string filter, uint flags, out uint count, out IntPtr creds);
  [DllImport("advapi32.dll")] static extern void CredFree(IntPtr p);

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct CREDENTIAL {
    public uint Flags; public uint Type; public string TargetName; public string Comment;
    public uint LastWrittenLow; public uint LastWrittenHigh;
    public uint CredentialBlobSize; public IntPtr CredentialBlob;
    public uint Persist; public uint AttributeCount; public IntPtr Attributes;
    public string TargetAlias; public string UserName;
  }

  static string clip;

  static void ReadClip() {
    try { clip = Clipboard.GetText(); } catch (Exception e) { clip = "CLIPBOARD-ERROR " + e.Message; }
  }

  static int Main(string[] a) {
    try {
      if (a.Length == 1 && a[0] == "clip") {
        Thread t = new Thread(new ThreadStart(ReadClip));
        t.SetApartmentState(ApartmentState.STA);
        t.Start();
        t.Join(8000);
        Console.WriteLine("CLIP[" + (clip ?? "no answer") + "]");
        return 0;
      }
      if (a.Length == 2 && a[0] == "cmdline") {
        int pid = int.Parse(a[1]);
        try {
          using (ManagementObjectSearcher s = new ManagementObjectSearcher("SELECT CommandLine FROM Win32_Process WHERE ProcessId=" + pid)) {
            foreach (ManagementObject o in s.Get()) Console.WriteLine("WMI[" + o["CommandLine"] + "]");
          }
        } catch (Exception e) { Console.WriteLine("WMI-ERROR " + e.Message); }
        IntPtr h = OpenProcess(0x1000, false, pid); // PROCESS_QUERY_LIMITED_INFORMATION
        if (h == IntPtr.Zero) { Console.WriteLine("OPEN-LIMITED-ERROR " + Marshal.GetLastWin32Error()); return 0; }
        IntPtr buf = Marshal.AllocHGlobal(65536);
        int ret;
        int st = NtQueryInformationProcess(h, 60, buf, 65536, out ret); // ProcessCommandLineInformation
        if (st == 0) Console.WriteLine("KERNEL[" + Marshal.PtrToStringUni(Marshal.ReadIntPtr(buf, IntPtr.Size), Marshal.ReadInt16(buf) / 2) + "]");
        else Console.WriteLine("KERNEL-ERROR 0x" + st.ToString("x8"));
        CloseHandle(h);
        return 0;
      }
      if (a.Length == 2 && a[0] == "open") {
        IntPtr h = OpenProcess(0x0410, false, int.Parse(a[1])); // PROCESS_QUERY_INFORMATION | PROCESS_VM_READ
        if (h == IntPtr.Zero) Console.WriteLine("OPEN-ERROR " + Marshal.GetLastWin32Error());
        else { Console.WriteLine("OPENED-FOR-READ"); CloseHandle(h); }
        return 0;
      }
      if (a.Length == 2 && a[0] == "cred") {
        IntPtr p;
        if (!CredRead(a[1], 1, 0, out p)) Console.WriteLine("CRED-ERROR " + Marshal.GetLastWin32Error()); // (1168: no such credential; 5: access denied; 1312: no logon session)
        else {
          CREDENTIAL c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL));
          byte[] b = new byte[c.CredentialBlobSize];
          if (b.Length > 0) Marshal.Copy(c.CredentialBlob, b, 0, b.Length);
          Console.WriteLine("CRED[" + System.Text.Encoding.UTF8.GetString(b) + "]");
          CredFree(p);
        }
        uint n; IntPtr list;
        if (!CredEnumerate(null, 0, out n, out list)) Console.WriteLine("CRED-LIST-ERROR " + Marshal.GetLastWin32Error());
        else {
          int trif = 0;
          for (int i = 0; i < n; i++) {
            CREDENTIAL c = (CREDENTIAL)Marshal.PtrToStructure(Marshal.ReadIntPtr(list, i * IntPtr.Size), typeof(CREDENTIAL));
            if (c.TargetName != null && c.TargetName.Contains("TRIF")) trif++;
          }
          Console.WriteLine("CRED-LIST " + n + " credential(s), " + trif + " of TRIF's");
          CredFree(list);
        }
        return 0;
      }
      Console.Error.WriteLine("usage: spy clip | cmdline <pid> | open <pid> | cred <name>");
      return 2;
    } catch (Exception e) { Console.WriteLine("SPY-ERROR " + e.Message); return 1; }
  }
}
