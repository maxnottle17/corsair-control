# Small helper that reads and changes Windows volume / mute for playback and recording
# devices and for individual apps. It reads one command per line on stdin and answers
# with one line of JSON:
#   list | vol <id> <0-100> | mute <id> <0|1> | appvol <0-100> <app name> | appmute <0|1> <app name>
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;

namespace CC {
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumerator {}

  [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator {
    int EnumAudioEndpoints(int dataFlow, int stateMask, out IMMDeviceCollection devices);
    int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
    int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);
  }
  [Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceCollection { int GetCount(out int n); int Item(int i, out IMMDevice d); }

  [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice {
    int Activate(ref Guid iid, int clsCtx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o);
    int OpenPropertyStore(int access, out IPropertyStore ps);
    int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
    int GetState(out int s);
  }
  [StructLayout(LayoutKind.Sequential)] struct PROPERTYKEY { public Guid fmtid; public int pid; }
  [StructLayout(LayoutKind.Explicit, Size = 24)] struct PROPVARIANT { [FieldOffset(0)] public short vt; [FieldOffset(8)] public IntPtr p; }

  [Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IPropertyStore {
    int GetCount(out int c);
    int GetAt(int i, out PROPERTYKEY k);
    int GetValue(ref PROPERTYKEY key, out PROPVARIANT v);
  }
  [Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioEndpointVolume {
    int RegisterControlChangeNotify(IntPtr p);
    int UnregisterControlChangeNotify(IntPtr p);
    int GetChannelCount(out int n);
    int SetMasterVolumeLevel(float db, ref Guid ctx);
    int SetMasterVolumeLevelScalar(float level, ref Guid ctx);
    int GetMasterVolumeLevel(out float db);
    int GetMasterVolumeLevelScalar(out float level);
    int SetChannelVolumeLevel(int ch, float db, ref Guid ctx);
    int SetChannelVolumeLevelScalar(int ch, float level, ref Guid ctx);
    int GetChannelVolumeLevel(int ch, out float db);
    int GetChannelVolumeLevelScalar(int ch, out float level);
    int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid ctx);
    int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
  }

  // per-app sound
  [Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionManager2 {
    int GetAudioSessionControl(IntPtr a, int b, out IntPtr c);
    int GetSimpleAudioVolume(IntPtr a, int b, out IntPtr c);
    int GetSessionEnumerator(out IAudioSessionEnumerator e);
  }
  [Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionEnumerator { int GetCount(out int n); int GetSession(int i, out IAudioSessionControl2 s); }

  [Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionControl2 {
    int GetState(out int state);
    int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string name);
    int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string name, ref Guid ctx);
    int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string path);
    int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string path, ref Guid ctx);
    int GetGroupingParam(out Guid g);
    int SetGroupingParam(ref Guid g, ref Guid ctx);
    int RegisterAudioSessionNotification(IntPtr p);
    int UnregisterAudioSessionNotification(IntPtr p);
    int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
    int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
    int GetProcessId(out uint pid);
    int IsSystemSoundsSession();
    int SetDuckingPreference([MarshalAs(UnmanagedType.Bool)] bool optOut);
  }
  [Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface ISimpleAudioVolume {
    int SetMasterVolume(float level, ref Guid ctx);
    int GetMasterVolume(out float level);
    int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid ctx);
    int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
  }

  class AppInfo { public float Volume; public bool Muted; public bool Active; public List<ISimpleAudioVolume> Vols = new List<ISimpleAudioVolume>(); }

  public static class Audio {
    static IMMDeviceEnumerator En() { return (IMMDeviceEnumerator)(new MMDeviceEnumerator()); }
    static IAudioEndpointVolume Vol(IMMDevice d) {
      Guid iid = typeof(IAudioEndpointVolume).GUID; object o;
      Marshal.ThrowExceptionForHR(d.Activate(ref iid, 23, IntPtr.Zero, out o));
      return (IAudioEndpointVolume)o;
    }
    static string Name(IMMDevice d) {
      IPropertyStore ps; if (d.OpenPropertyStore(0, out ps) != 0) return "";
      PROPERTYKEY k = new PROPERTYKEY(); k.fmtid = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"); k.pid = 14;
      PROPVARIANT v; if (ps.GetValue(ref k, out v) != 0 || v.vt != 31) return "";
      return Marshal.PtrToStringUni(v.p);
    }
    static string Esc(string s) { return (s ?? "").Replace("\\", "\\\\").Replace("\"", "\\\""); }
    static string DefaultId(IMMDeviceEnumerator en, int flow) {
      IMMDevice d; if (en.GetDefaultAudioEndpoint(flow, 0, out d) != 0) return "";
      string id; d.GetId(out id); return id;
    }
    public static string List() {
      var en = En(); var sb = new StringBuilder("["); bool first = true;
      for (int flow = 0; flow < 2; flow++) {
        string def = DefaultId(en, flow);
        IMMDeviceCollection col; en.EnumAudioEndpoints(flow, 1, out col);
        int n; col.GetCount(out n);
        for (int i = 0; i < n; i++) {
          IMMDevice d; col.Item(i, out d);
          string id; d.GetId(out id);
          float lvl = 0; bool mute = false;
          try { var v = Vol(d); v.GetMasterVolumeLevelScalar(out lvl); v.GetMute(out mute); } catch { }
          if (!first) sb.Append(","); first = false;
          sb.AppendFormat("{{\"id\":\"{0}\",\"name\":\"{1}\",\"flow\":\"{2}\",\"volume\":{3},\"muted\":{4},\"isDefault\":{5}}}",
            Esc(id), Esc(Name(d)), flow == 0 ? "playback" : "recording", (int)Math.Round(lvl * 100),
            mute ? "true" : "false", id == def ? "true" : "false");
        }
      }
      return sb.Append("]").ToString();
    }
    static IMMDevice Get(string id) { IMMDevice d; Marshal.ThrowExceptionForHR(En().GetDevice(id, out d)); return d; }
    public static void SetVolume(string id, int percent) {
      Guid g = Guid.Empty; Vol(Get(id)).SetMasterVolumeLevelScalar(Math.Max(0, Math.Min(100, percent)) / 100f, ref g);
    }
    public static void SetMute(string id, bool mute) { Guid g = Guid.Empty; Vol(Get(id)).SetMute(mute, ref g); }

    // Every app that currently has a sound session on any playback device, keyed by program name.
    static Dictionary<string, AppInfo> Apps() {
      var apps = new Dictionary<string, AppInfo>(StringComparer.OrdinalIgnoreCase);
      var en = En(); IMMDeviceCollection col; en.EnumAudioEndpoints(0, 1, out col);
      int n; col.GetCount(out n);
      for (int i = 0; i < n; i++) {
        try {
          IMMDevice d; col.Item(i, out d);
          Guid iid = typeof(IAudioSessionManager2).GUID; object o;
          if (d.Activate(ref iid, 23, IntPtr.Zero, out o) != 0) continue;
          IAudioSessionEnumerator se; if (((IAudioSessionManager2)o).GetSessionEnumerator(out se) != 0) continue;
          int count; se.GetCount(out count);
          for (int j = 0; j < count; j++) {
            try {
              IAudioSessionControl2 s; if (se.GetSession(j, out s) != 0) continue;
              int state; s.GetState(out state);
              if (state == 2) continue; // session has ended
              uint pid; s.GetProcessId(out pid);
              string name = "System sounds";
              if (pid != 0) { // process 0 is Windows' own system sounds
                try { name = System.Diagnostics.Process.GetProcessById((int)pid).ProcessName; } catch { continue; }
              }
              var sv = (ISimpleAudioVolume)s;
              float lvl; bool mute; sv.GetMasterVolume(out lvl); sv.GetMute(out mute);
              AppInfo a;
              if (!apps.TryGetValue(name, out a)) { a = new AppInfo(); a.Volume = lvl; a.Muted = mute; apps[name] = a; }
              a.Vols.Add(sv);
              if (state == 1) { a.Active = true; a.Volume = lvl; a.Muted = mute; }
            } catch { }
          }
        } catch { }
      }
      return apps;
    }
    public static string ListApps() {
      var sb = new StringBuilder("["); bool first = true;
      foreach (var kv in Apps()) {
        if (!first) sb.Append(","); first = false;
        sb.AppendFormat("{{\"name\":\"{0}\",\"volume\":{1},\"muted\":{2},\"active\":{3}}}", Esc(kv.Key),
          (int)Math.Round(kv.Value.Volume * 100), kv.Value.Muted ? "true" : "false", kv.Value.Active ? "true" : "false");
      }
      return sb.Append("]").ToString();
    }
    public static void SetAppVolume(string name, int percent) {
      AppInfo a; if (!Apps().TryGetValue(name, out a)) return;
      Guid g = Guid.Empty; foreach (var v in a.Vols) v.SetMasterVolume(Math.Max(0, Math.Min(100, percent)) / 100f, ref g);
    }
    public static void SetAppMute(string name, bool mute) {
      AppInfo a; if (!Apps().TryGetValue(name, out a)) return;
      Guid g = Guid.Empty; foreach (var v in a.Vols) v.SetMute(mute, ref g);
    }
  }
}
'@

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::Out.WriteLine('{"ready":true}')
while ($null -ne ($line = [Console]::In.ReadLine())) {
  try {
    $parts = $line.Trim() -split ' ', 3
    switch ($parts[0]) {
      'list' { }
      'vol'  { [CC.Audio]::SetVolume($parts[1], [int]$parts[2]) }
      'mute' { [CC.Audio]::SetMute($parts[1], $parts[2] -eq '1') }
      'appvol'  { [CC.Audio]::SetAppVolume($parts[2], [int]$parts[1]) }
      'appmute' { [CC.Audio]::SetAppMute($parts[2], $parts[1] -eq '1') }
    }
    [Console]::Out.WriteLine('{"devices":' + [CC.Audio]::List() + ',"apps":' + [CC.Audio]::ListApps() + '}')
  } catch {
    [Console]::Out.WriteLine('{"error":"' + ($_.Exception.Message -replace '["\\\r\n]', ' ') + '"}')
  }
}
