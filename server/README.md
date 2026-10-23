# 可选的五线谱识别服务

网页自带的本地 OCR 只能给出**简谱数字文本草稿**；它不能可靠还原上下八度点、减时线、连音或五线谱。准确的练习模板优先使用 MusicXML / MXL 或 MIDI。导入结果会说明所采用的声部和简化。

此服务把图片或 PDF 交给本机 [Audiveris](https://github.com/Audiveris/audiveris)，得到 MusicXML，再由网页导入。Audiveris 是独立安装的开源 OMR 程序（AGPL-3.0）；本仓库没有捆绑或复制它。它主要识别清晰的印刷五线谱。复杂谱、手写谱和低清图片需要人工检查，识别不保证正确。

## Windows 免系统安装启动

项目提供 Windows x64 的可复现便携准备脚本，需要已安装 Python 3.10 或更新版本。它从官方来源下载固定版本的 Audiveris（自带 Java）和 Tesseract 英语数据，校验 SHA-256 后，**只读提取 MSI 文件，不执行安装器**。所有二进制、缓存、识别模型和日志保存在 Git 忽略的 `.tools/` 内，不安装系统 Java，不改变 PATH 或持久环境变量。

在项目根目录运行：

```powershell
.\scripts\setup-omr.ps1
.\server\start-omr.ps1
```

服务地址为 `http://127.0.0.1:8765/api/recognize`。在网页曲谱导入区域填写此地址即可。启动脚本只为子进程设置环境，保留 Windows 实际用户配置位置供 Java 的系统目录查询使用，同时把 Audiveris 的 APPDATA、LOCALAPPDATA、临时文件及 Java 用户目录定向到 `.tools/`。通过 `_JAVA_OPTIONS` 将 Java 堆上限设为 1.5 GB，覆盖官方启动器的 8 GB 默认值。

默认允许的网页来源为 `http://localhost:5173`、`http://127.0.0.1:5173` 和 `https://ruoyu-tianyi.github.io`。**来源只包含协议、主机和端口，不包含 `/singing-key-practice/` 路径。**使用不同地址时可指定：

```powershell
.\server\start-omr.ps1 -AllowedOrigins 'https://你的网页域名,http://localhost:5173'
```

2026-10-23 已在当前工作区准备便携运行时，并使用官方 `data/examples/cucaracha.png` 完成实测：HTTP 文件上传得到 200，返回约 59 KB 的 MusicXML，包含 16 个小节；浏览器实际导入为《29 - LA CUCARACHA》、3/4 拍、68 个旋律音符。实际旋律、节奏和识别错误仍须对照原谱校对。测试图片与运行时仅放在忽略目录内，不随仓库发布；**从 GitHub 全新克隆的用户仍需先运行准备脚本**。启动脚本也已在独立端口通过同样的 HTTP 识别测试，确认没有在系统 AppData 中创建 Audiveris 目录。

便携资源来源及校验值：

| 资源 | 固定官方地址 | SHA-256 |
| --- | --- | --- |
| Audiveris 5.11.0 Windows console MSI（含 Java） | [官方 GitHub 发布文件](https://github.com/Audiveris/audiveris/releases/download/5.11.0/Audiveris-5.11.0-windowsConsole-x86_64.msi) | `5f1b4e96a12c53c7da426814b76e599363c4181e291855996e0a6878dda95f71` |
| Tesseract 4.1.0 完整英语模型（含 legacy） | [官方 tessdata 文件](https://raw.githubusercontent.com/tesseract-ocr/tessdata/4.1.0/eng.traineddata) | `daa0c97d651c19fba3b25e81317cd697e9908c8208090c94c3905381c23fc047` |

Audiveris 校验值与 GitHub 发布资产的官方 `digest` 字段一致。英语模型校验值为该固定标签文件的本地 SHA-256；脚本发现下载内容不匹配时会停止。Audiveris、其附带依赖及识别模型各自的许可证随上游文件保留。便携方式是本项目的只读提取工作流，并非上游声明的独立便携发行版。

## 安装与启动

1. 安装 Python 3.10 或更新版本。此适配器仅使用 Python 标准库。
2. 从 [Audiveris 官方发布页](https://github.com/Audiveris/audiveris/releases)安装 Audiveris，按该版本的官方要求安装 Java。先用 Audiveris 桌面程序打开一份曲谱，确认可导出 MusicXML。
3. 在项目目录运行下面的 PowerShell 命令，将路径替换为本机实际安装的启动程序（也可使用官方的 `.bat` 启动器）：

```powershell
$env:AUDIVERIS_BIN = 'C:\Program Files\Audiveris\bin\Audiveris.bat'
python server/omr_server.py
```

4. 网页的曲谱导入区域填写 `http://127.0.0.1:8765/api/recognize` 为 OMR 服务地址，再选择五线谱图片或 PDF。服务只在显式填写地址时使用，文件将发送到指定地址。未填写地址时，图片 / PDF 简谱 OCR 在浏览器本地进行。
5. 对照原谱校对识别结果的旋律与节奏，然后开始练习。复杂曲谱可直接在 Audiveris 中修正后导出 `.mxl`，再导入网页。

服务健康检查地址：`http://127.0.0.1:8765/health`。已配置仅代表找到了启动程序；仍需实际安装 Java / Audiveris 并完成一次识别确认。

网页地址或开发端口不同时，在启动前设置允许的来源（精确匹配，逗号分隔）：

```powershell
$env:OMR_ALLOWED_ORIGINS = 'http://localhost:5173,http://127.0.0.1:5173,https://你的网页地址'
python server/omr_server.py
```

默认绑定 `127.0.0.1:8765`，只接受本机请求，避免把执行本机程序的接口直接暴露到网络。浏览器访问公网 HTTPS 网页后连接本机服务时，可能需要用户允许“本地网络访问”；此权限由浏览器控制。平板和手机可以导入现成 MusicXML、MIDI 和简谱；它们的 `127.0.0.1` 指向设备自身，不能直接访问电脑的此服务。跨设备可先在电脑完成识别，再把导出的 JSON / MusicXML 传到设备。部署面向公网的 OMR 服务需要单独实现身份认证、隔离执行和资源配额，不应仅修改绑定地址。

## 接口与限制

`POST /api/recognize`，`multipart/form-data` 的 `file` 字段。成功返回 `application/vnd.recordare.musicxml+xml`，失败返回可读错误信息。接受 PDF、PNG、JPEG、TIFF、BMP；最大 20 MB；一次一个任务，超时 180 秒；Java 堆上限 1.5 GB；输出最多 32 MB。临时输入 / 输出在任务结束后删除，上传文件名不会成为命令参数，客户端不能传入可执行程序路径或启动参数。每个任务应尽量只包含几页，避免高分辨率文件耗尽本机资源。

网页通过本地浏览器 OCR 识别简谱时，Tesseract.js 首次使用会下载引擎和英语识别资源，需要联网；图片本身不上传给 OCR 提供方。图片和 PDF OCR 结果始终标记为待校对。纯数字的普通文本也可能被 OCR 误判为音符，应只上传真实曲谱并在编辑器中检查。

## 数据解释

- 内部 `beats` 始终以四分音符为一拍，6/8 中的一个八分音符为 0.5。
- MusicXML 读取首个含有音高的 part，以及该 part 第一个旋律音符所属的 voice / staff；不会猜测哪一条才是主唱。
- 音高采用实际发声 MIDI 音高，MusicXML 中的移调指令会生效。
- 和弦 / 重叠音简化为单旋律；反复记号单次读取；整首采用统一速度。导入来源文字会注明相关情况。
- 简谱使用中央 C 的 `1`，可写 `1=D` 选择调号；`0` 休止、`1'` 高八度、`1,` 低八度、`1_` 半拍、`1__` 四分之一拍、`1-` 两拍、`1.` 附点。上下标八度点 OCR 结果不可靠。

实现依据：[Tesseract.js API](https://github.com/naptha/tesseract.js/blob/master/docs/api.md)、[PDF.js 官方打包示例](https://github.com/mozilla/pdf.js/blob/master/examples/webpack/main.mjs)、[Audiveris 启动说明](https://github.com/Audiveris/audiveris/wiki/Launching)。
