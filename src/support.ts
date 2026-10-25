import { version } from "../package.json";

export const APP_VERSION = version;

export const helpContent = `
  <p class="support-intro">从听见一个音，到唱好一段旋律。每天留一点时间给自己的声音。</p>
  <div class="help-quickstart"><span><b>01</b> 听标准音</span><span><b>02</b> 自然模唱</span><span><b>03</b> 看反馈再练</span></div>
  <details open><summary>第一次练习，从哪里开始？</summary><p>先在「标准音模唱」选一个舒服的音，播放后再唱。开启麦克风，观察曲线是否靠近目标音；±25 音分以内显示为唱准。然后到「曲谱练习」，选一个短片段、放慢速度，听示范后开始。练习前有 4 拍预备。</p><p>建议佩戴耳机，保持自然音量。收音设置里的「自动校准」会先听 4 秒环境声，等你准备好后再试唱 6 秒；保存前可继续微调。</p></details>
  <details><summary>没有声音、没有曲线，或曲线跳动？</summary><p>手机请使用 HTTPS 地址，在浏览器与系统设置中允许麦克风。如果已拒绝过权限，打开地址栏的网站权限修改后再试。连接耳机或麦克风后，重新点击「开启麦克风」。</p><p>有输入音量但没有音高：调低音量门限，检查识别音域，尝试持续唱一个音。音高跳动：远离噪声，关闭扬声器伴奏，重新自动校准。检测适用于独唱的单旋律，多人声音和伴奏会干扰。</p><p>切到后台、锁屏或系统打断音频时会停止练习。返回后主动重新开启。若标准音无声，请检查设备媒体音量和网页播放音量。</p></details>
  <details><summary>怎样理解练习结果？</summary><p>音准命中率只计算检测到有效音高的时段，要和「有效发声覆盖」一起看。未检测到有效人声时显示「—」，不会给出虚假的满分。换音偏差是发声时机的估算，连续同音的节奏不易区分。</p><p>完成曲谱或片段后会留下练习记录，最多保留最近 100 次。循环每唱完一遍记一次；示范与中途停止不记为完成。最近 7 天概览仅统计这些完成记录，今日监听时长单独显示。可载入原速度、移调与片段，再练一遍。</p></details>
  <details><summary>如何导入曲谱、转移数据？</summary><p>优先导入 MusicXML / MIDI，或用简谱手动编谱。图片和 PDF 简谱先生成文字草稿，必须核对八度与时值；五线谱扫描件需要自行连接 Audiveris 服务。手机无法通过 127.0.0.1 使用电脑的服务。</p><p>曲谱可逐首导出 JSON。练习记录中可导出或导入记录备份，导入会按记录 ID 合并并保留最近 100 次。记录备份不包含曲谱与收音设置；换设备或域名后，需另行导入曲谱并重新校准。</p></details>
  <details><summary>声音和数据保存在哪里？</summary><p>麦克风声音仅在设备上分析，不录音、不上传。曲谱、设置与练习记录保存在当前浏览器和域名下，没有账号或云同步。清理网站数据会删除这些内容，请先导出需要保留的数据。</p><p>普通曲谱与简谱 OCR 在本地处理，首次 OCR 需要联网下载模型；仅选择五线谱服务时，曲谱才会发送到你填写的地址。当前不保证离线重新打开。</p></details>
  <section class="support-panel" aria-labelledby="support-title"><h3 id="support-title">帮助我们把 Auralis 做得更好</h3><p>遇到问题时，附上复现步骤与下方诊断信息。诊断仅包含应用版本、浏览器、音频支持和当前收音参数，不包含录音、曲谱内容或练习历史；不会自动发送。</p><textarea id="support-diagnostics" rows="5" readonly aria-label="诊断信息"></textarea><div class="support-actions"><button class="button secondary" data-action="copy-diagnostics">复制诊断信息</button><a class="button secondary" href="https://github.com/Ruoyu-Tianyi/singing-key-practice/issues/new?template=bug_report.yml" target="_blank" rel="noopener noreferrer">反馈问题 ↗</a></div><a class="support-guide-link" href="https://github.com/Ruoyu-Tianyi/singing-key-practice/blob/main/docs/USER_GUIDE.md" target="_blank" rel="noopener noreferrer">阅读完整使用指南 ↗</a><small>Auralis ${version} · 开源 · 本机音频分析</small></section>
`;

export const historyDialogMarkup = `
<dialog id="history-dialog" class="journal-dialog" aria-labelledby="history-dialog-title">
  <div class="dialog-head"><div><span class="eyebrow">YOUR VOICE, OVER TIME</span><h2 id="history-dialog-title">每一次练习，都算数</h2></div><button class="icon-button" data-close aria-label="关闭练习记录">×</button></div>
  <div class="journal-body"><p class="journal-intro">最近 7 天 · 已完成的曲谱练习</p><div id="history-summary" class="journal-summary"></div><div id="history-week" class="journal-week" aria-label="最近七天练习次数"></div><div class="journal-list-heading"><h3>练习记录</h3><span id="history-count"></span></div><p id="history-storage-warning" class="notice" role="status" hidden>本次记录暂存在页面内，浏览器未能保存。请导出备份，避免关闭后丢失。</p><div id="history-list" class="journal-list"></div><p class="journal-note">仅保留最近 100 次完成记录。音准需结合覆盖率理解；这些反馈用于日常练习。</p></div>
  <div class="journal-actions"><button class="button secondary" data-action="export-history">导出记录</button><button class="button secondary" data-action="import-history">导入记录</button><input id="history-file" type="file" accept=".json,application/json" hidden><span id="history-message" role="status">仅存于此浏览器 · 记得备份</span></div>
</dialog>`;
