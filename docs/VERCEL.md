# 在 Vercel 部署 Auralis

Auralis 前端是 Vite 静态网站，可部署到 Vercel，并通过 HTTPS 在电脑、手机和平板访问。麦克风分析、标准音播放、MusicXML/MIDI/JSON 导入、简谱 OCR 和跟唱练习均在浏览器中完成，不需要服务器或 API 密钥。

**生产地址：[https://singing-key-practice.vercel.app/](https://singing-key-practice.vercel.app/)**。已验证无需 Vercel 登录即可访问，首页及许可证页面返回 200，手机宽度下曲线放大、还原正常，A4 参考音显示 440 Hz。

## 从 GitHub 导入

1. 登录 Vercel，选择自己的工作空间，点击 **Add New → Project**。
2. 导入公开仓库 [`Ruoyu-Tianyi/singing-key-practice`](https://github.com/Ruoyu-Tianyi/singing-key-practice)，生产分支选择 `main`。
3. Framework Preset 选择 **Vite**，Root Directory 保持仓库根目录，Node.js 选择 **22.x**。
4. 保留仓库 `vercel.json` 提供的安装、构建命令和 `dist` 输出目录，点击 **Deploy**。
5. 构建成功后，用手机直接打开项目的生产 HTTPS 地址。首次点击“开启麦克风”时允许浏览器使用麦克风；播放声音需要手动点击播放。

`vercel.json` 通过 `npx` 固定使用 `pnpm@11.25.0`，避免安装命令覆盖后使用到旧版 pnpm。构建会运行第三方许可证导出、TypeScript 检查和 Vite 打包；不要只上传已有的 `dist` 后跳过这些步骤。首次构建和首次 OCR 需要网络连接。

连接 GitHub 后，后续对 `main` 的推送会触发 Vercel 的生产构建。生产地址应使用 Vercel 项目页面确认的域名；预览地址可能需要 Vercel 账号登录。公开练习入口应使用允许公众访问的生产域名，并先在未登录窗口检查访问。

## 手机和平板使用

- iPhone/iPad 优先使用 Safari，Android 可使用 Chrome。保持页面前台运行；切到后台时工具会停止监听和播放。
- 建议使用耳机，减少扬声器声音再次进入麦克风而影响音高判断。
- 可以用浏览器“添加到主屏幕”创建快捷入口。当前版本没有离线缓存，不保证断网后重新打开。
- 曲谱、设置和统计保存在当前浏览器。Vercel 域名和原 GitHub Pages 域名各自独立；迁移时先在旧地址导出曲谱 JSON，再在新地址导入。

## 五线谱图片/PDF 识别

Vercel 此配置只托管前端，不运行 `server/` 的 Python/Audiveris 服务。手机的 `127.0.0.1` 指向手机自身，不能连接电脑本地的识别服务。

当前可在电脑启动 [Audiveris 本地服务](../server/README.md)，识别并校对五线谱后导出 JSON，再在手机导入练习。若以后希望手机直接上传五线谱识别，需要另行部署可访问的 HTTPS 识别服务，并为文件上传、访问控制和资源用量单独设计。

## 参考

- [Vercel：部署 Vite](https://vercel.com/docs/frameworks/frontend/vite)
- [Vercel：包管理器与版本](https://vercel.com/docs/package-managers)
- [Vercel：项目配置](https://vercel.com/docs/project-configuration)
- [浏览器麦克风安全上下文要求](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)
