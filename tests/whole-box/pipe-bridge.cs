// trif-pipe-bridge.exe (whole-box step 9, Windows): a named pipe that one AppContainer may open, each
// connection carried to a TCP port on this computer (TRIF's relay). It runs outside the box, as the user,
// so it reaches 127.0.0.1, which an AppContainer can't without an administrator's loopback exemption.
//
//   trif-pipe-bridge.exe <pipe name> <container SID | -> <label: low | none> <port>
//
// The pipe, \\.\pipe\<name>, is made with its own security, not Windows' default (which a container
// can't open):
//   - its access list names only this user (all rights) and SYSTEM, and the container (read and write)
//     when a SID is given ("-": none, to see what a container gets without one);
//   - "low": a low mandatory label, no write up: an AppContainer runs at low integrity, and an object with
//     no label counts as medium, which a low process can't write to;
//   - remote clients refused (PIPE_REJECT_REMOTE_CLIENTS); the first instance FILE_FLAG_FIRST_PIPE_INSTANCE,
//     so a pipe someone made first under that name makes this fail instead of being shared.
// Bytes are carried both ways untouched (no parsing: the relay parses). Prints "listening <name>", then
// one line per connection ("connection <n>", "closed <n> up <bytes> down <bytes>"). Ends when its standard
// input closes (the helper going away).
//
// Built like trif-fence.exe, with .NET Framework 4's csc.exe (C# 5):
//   %WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe /nologo /o+ /out:trif-pipe-bridge.exe pipe-bridge.cs

using System;
using System.ComponentModel;
using System.IO;
using System.IO.Pipes;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Threading;
using Microsoft.Win32.SafeHandles;

static class Bridge {
  [StructLayout(LayoutKind.Sequential)]
  struct SECURITY_ATTRIBUTES { public int nLength; public IntPtr lpSecurityDescriptor; public bool bInheritHandle; }

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern IntPtr CreateNamedPipeW(string name, uint openMode, uint pipeMode, uint maxInstances, uint outBuf, uint inBuf, uint timeout, ref SECURITY_ATTRIBUTES sa);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool ConvertStringSecurityDescriptorToSecurityDescriptorW(string sddl, uint revision, out IntPtr sd, out uint size);
  [DllImport("kernel32.dll")]
  static extern IntPtr LocalFree(IntPtr p);

  const uint PIPE_ACCESS_DUPLEX = 0x3, FILE_FLAG_OVERLAPPED = 0x40000000, FILE_FLAG_FIRST_PIPE_INSTANCE = 0x80000;
  const uint PIPE_TYPE_BYTE = 0, PIPE_READMODE_BYTE = 0, PIPE_WAIT = 0, PIPE_REJECT_REMOTE_CLIENTS = 0x8;
  const uint PIPE_UNLIMITED_INSTANCES = 255;

  static readonly object outLock = new object();
  static void Say(string s) { lock (outLock) { Console.Out.WriteLine(s); Console.Out.Flush(); } }

  static SafePipeHandle Make(string full, string sddl, bool first) {
    IntPtr sd; uint size;
    if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl, 1, out sd, out size)) throw new Win32Exception(Marshal.GetLastWin32Error(), "security descriptor " + sddl);
    try {
      SECURITY_ATTRIBUTES sa = new SECURITY_ATTRIBUTES();
      sa.nLength = Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES));
      sa.lpSecurityDescriptor = sd;
      sa.bInheritHandle = false;
      uint open = PIPE_ACCESS_DUPLEX | FILE_FLAG_OVERLAPPED | (first ? FILE_FLAG_FIRST_PIPE_INSTANCE : 0);
      IntPtr h = CreateNamedPipeW(full, open, PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS, PIPE_UNLIMITED_INSTANCES, 65536, 65536, 0, ref sa);
      if (h == new IntPtr(-1)) throw new Win32Exception(Marshal.GetLastWin32Error(), "CreateNamedPipe " + full);
      return new SafePipeHandle(h, true);
    } finally { LocalFree(sd); }
  }

  static long Pump(Stream from, Stream to) {
    long n = 0;
    byte[] buf = new byte[65536];
    try {
      int r;
      while ((r = from.Read(buf, 0, buf.Length)) > 0) { to.Write(buf, 0, r); to.Flush(); n += r; }
    } catch (Exception) { /* the other side went away */ }
    return n;
  }

  static void Serve(NamedPipeServerStream pipe, int port, int id) {
    long up = 0, down = 0;
    TcpClient tcp = null;
    try {
      tcp = new TcpClient();
      tcp.Connect("127.0.0.1", port);
      NetworkStream net = tcp.GetStream();
      long[] d = new long[1];
      Thread back = new Thread(delegate () { d[0] = Pump(net, pipe); try { pipe.Disconnect(); } catch (Exception) { } try { pipe.Close(); } catch (Exception) { } });
      back.IsBackground = true;
      back.Start();
      up = Pump(pipe, net);
      try { tcp.Client.Shutdown(SocketShutdown.Send); } catch (Exception) { }
      back.Join(30000);
      down = d[0];
    } catch (Exception e) {
      Say("error " + id + " " + e.Message);
    } finally {
      try { if (tcp != null) tcp.Close(); } catch (Exception) { }
      try { pipe.Close(); } catch (Exception) { }
      Say("closed " + id + " up " + up + " down " + down);
    }
  }

  static int Main(string[] args) {
    if (args.Length != 4) { Console.Error.WriteLine("usage: trif-pipe-bridge.exe <pipe name> <container SID | -> <low | none> <port>"); return 2; }
    string name = args[0], sid = args[1], label = args[2];
    int port = int.Parse(args[3]);
    if (name.IndexOf('\\') >= 0 || name.Length == 0 || name.Length > 200) { Console.Error.WriteLine("bad pipe name"); return 2; }
    if (sid != "-") new SecurityIdentifier(sid); // (throws on a malformed SID)
    string user = WindowsIdentity.GetCurrent().User.Value;
    string sddl = "D:P(A;;GA;;;" + user + ")(A;;GA;;;SY)" + (sid != "-" ? "(A;;GRGW;;;" + sid + ")" : "") + (label == "low" ? "S:(ML;;NW;;;LW)" : "");
    string full = "\\\\.\\pipe\\" + name;

    // (the helper going away ends the bridge: its standard input closes)
    Thread watch = new Thread(delegate () { try { while (Console.In.Read() >= 0) { } } catch (Exception) { } Environment.Exit(0); });
    watch.IsBackground = true;
    watch.Start();

    int n = 0;
    bool first = true;
    try {
      while (true) {
        SafePipeHandle h = Make(full, sddl, first);
        NamedPipeServerStream pipe = new NamedPipeServerStream(PipeDirection.InOut, true, false, h);
        if (first) { Say("listening " + full + " " + sddl); first = false; }
        pipe.WaitForConnection();
        int id = ++n;
        Say("connection " + id);
        Thread t = new Thread(delegate () { Serve(pipe, port, id); });
        t.IsBackground = true;
        t.Start();
      }
    } catch (Exception e) {
      Console.Error.WriteLine("trif-pipe-bridge: " + e.Message);
      return 1;
    }
  }
}
