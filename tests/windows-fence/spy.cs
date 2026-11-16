// spy.exe: tries, from inside the fence, what a node script can't ask Windows for (tests/windows-fence/run.js).
//   spy clip           print the clipboard's text
//   spy cmdline <pid>  print another program's command line: asked of WMI, then of the kernel
//                      (NtQueryInformationProcess, which needs only the "limited" right to the process)
//   spy open <pid>     try to open another program to read its memory (where its environment is)
using System;
using System.Management;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

static class Spy {
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(IntPtr h, int cls, IntPtr info, int len, out int ret);

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
      Console.Error.WriteLine("usage: spy clip | cmdline <pid> | open <pid>");
      return 2;
    } catch (Exception e) { Console.WriteLine("SPY-ERROR " + e.Message); return 1; }
  }
}
