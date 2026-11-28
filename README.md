# 🎙️ 思源语音 · Voice Notes（Full 版）

在思源里录下一场会议，结束后就能边看逐字稿边听原话。Full 自带本地识别模型。Silero VAD 先找出有人说话的时段，SenseVoiceSmall INT8 再把这些片段转成文字。识别在本机完成，音频和逐字稿无需上传云端。

## 哪一句没听清，就重转那几秒

按住 Ctrl（Mac 用 Command）在波形上拖选一句话，点「转写所选片段」。回听这几秒，把新识别的文字和原句对照，确认后再写回。其余逐字稿可以接着用。

![在波形上选中一句话，回听并核对局部转写结果](https://gcore.jsdelivr.net/gh/jiangeeeeee/siyuan-voice-notes@18cf96f9963a22b0d39b5d4dbb461f2218472301/docs/demos/select-transcription.gif)

- **区分发言人。** 识别后，不同颜色标出每个人开口的时段。把“发言人 A”改成同事的姓名，这条录音里归到同一人的发言都会显示新名字。
- **用第二个模型复核。** 在 Windows x64 桌面端另装完整扩展包后，可以让 Qwen3-ASR-0.6B 再听同一段原音。一次可选最多五分钟，逐句对照两份候选，自己决定采用哪种写法。
- **🔗 从笔记回到原话。** 录音或回听时可以加时间标签。用 Pro 把一段原音关联到会议纪要里的一句话，日后点正文就能从对应位置回听。

## Full、Lite 与 Pro 怎么选

需要离线转写、局部重转或按声音自动分人，选 Full。只想录音、导入字幕和回听，选不含识别模型的 [Lite 版](https://github.com/jiangeeeeee/siyuan-voice-notes-lite)。两版使用兼容的语音数据，同一设备上启用其中一版即可。

- **Free** 可录音、回听、离线转写、局部重转，自动区分发言人、改名、加时间标签和导出逐字稿。
- **Pro** 可把正文和选定时间段建立双链，按专业词库预览并批量纠错，还能保留或删除多个音频片段，听过拼接处再确认裁剪。

**💡 第一次同步前**，先启用 Full，在「版本与模型」检查模型同步排除。排除规则为 `/plugins/siyuan-voice-notes/offline/**`。另一台设备需单独安装模型，录音、逐字稿和笔记仍可随思源同步。

适用于思源 3.8.9 及以上。[下载 Full 安装包](https://github.com/jiangeeeeee/siyuan-voice-notes/releases/latest/download/package.zip) · [Windows 扩展安装与版本切换](https://github.com/jiangeeeeee/siyuan-voice-notes/blob/main/INSTALL.md)
