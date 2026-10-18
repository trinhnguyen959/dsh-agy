Set sh = CreateObject("WScript.Shell")
sh.Run "cmd /c cd /d ""D:\dev\tools\dsh-agy"" && node start.mjs", 0, False
