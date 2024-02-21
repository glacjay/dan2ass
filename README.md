# 简介

## macOS 快捷方式

可以写一个 Automator 脚本，然后放在 Dock 上，这样就可以把视频文件直接播放到其图标上来自动下载弹幕并播放了：

``` applescript
on run {input, parameters}
 set fileName to (the POSIX path of input)
 tell application "Terminal"
  do script with command "/usr/local/bin/node ~/study/dan²ass/dist/index.js '" & fileName & "'; sleep 7; killall Terminal"
  activate
 end tell
end run
```
