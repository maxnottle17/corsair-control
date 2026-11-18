' Starts Corsair Control (if it is not already running), waits until it is ready, then opens its window.
' Run with the word "background" to start it without opening the window.
Option Explicit
Const APP_URL = "http://127.0.0.1:47821/"
Dim sh, fso, i, background
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
sh.CurrentDirectory = fso.GetParentFolderName(WScript.ScriptFullName)

background = False
If WScript.Arguments.Count > 0 Then background = (LCase(WScript.Arguments(0)) = "background")

If Not Ready() Then sh.Run "node src\server.js", 0, False

' Right after Windows starts, things can be slow: wait up to a minute for the app to answer.
For i = 1 To 120
  If Ready() Then Exit For
  WScript.Sleep 500
Next

If Not background Then sh.Run "msedge --app=" & APP_URL & " --window-size=1240,920", 1, False

Function Ready()
  Dim h
  On Error Resume Next
  Set h = CreateObject("MSXML2.ServerXMLHTTP.6.0")
  h.setTimeouts 1000, 1000, 1000, 1000
  h.Open "GET", APP_URL & "?t=" & Timer, False
  h.Send
  Ready = (Err.Number = 0 And h.Status = 200)
  On Error GoTo 0
End Function
