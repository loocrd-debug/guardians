Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = Replace(WScript.ScriptFullName, WScript.ScriptName, "")
sh.Run "cmd /c """ & sh.CurrentDirectory & "START.bat"" --no-browser", 0, False
