# 音准练习工具：开源调研与采用决策

调研日期：2026-10-23。来源限项目自身的仓库、许可证与官方文档。下文是实现选择的依据；没有把第三方完整应用的代码复制进本项目。

## 类似应用

| 项目 | 与本项目相近的能力 | 已核实许可 | 本项目的使用方式 |
| --- | --- | --- | --- |
| [Visual Pitch Trainer](https://github.com/iuill/visual-pitch-trainer) | 浏览器麦克风音高、目标音偏差、随时间变化的曲线、多种参考音色、桌面/平板/手机界面；使用 TypeScript 与 Vite | [MIT](https://github.com/iuill/visual-pitch-trainer/blob/main/LICENSE) | 功能与交互对照，不复制界面、应用代码或模型文件。 |
| [Singing Experience](https://github.com/kunukn/singing-experience) | 实时人声音高、唱名练习、浏览器本地处理、可安装的离线网页 | [0BSD](https://github.com/kunukn/singing-experience/blob/main/LICENSE) | 参考轻量网页、设备端分析与麦克风提示的思路，自行实现练习流程。 |
| [Vocal Trainer](https://github.com/IoannesBracciano/vocal-trainer) | 随机目标音、虚拟琴键、逐音模唱、曲目练习 | README [声明 MIT](https://github.com/IoannesBracciano/vocal-trainer#license)，本次未取得独立 LICENSE 文件 | 仅列为产品参考；不据此复制代码。其上传音频提取旋律与扫描乐谱识别是不同能力。 |
| [440 Lab](https://github.com/qwell/440lab) | 音准、听音、音程与节奏练习，Web Audio 与实时调音器 | README [声明 GPL-3.0-or-later](https://github.com/qwell/440lab#license) | 仅参考产品范围；本项目未纳入其代码。 |

最接近需求的应用已证明“本地麦克风分析 + 参考音 + 可视化反馈”能用静态网页实现。它们的存在不等于扫描曲谱可自动准确转换；曲谱导入需要单独的识别、校对与格式解析流程。

## 可复用模块

| 模块 | 已核实许可 | 采用范围与边界 |
| --- | --- | --- |
| [pitchy](https://github.com/ianprime0509/pitchy) | [0BSD](https://github.com/ianprime0509/pitchy/blob/main/LICENSE)，并非 MIT/ISC | 实时单一基频估计，使用 McLeod Pitch Method；输出频率和清晰度，适合独唱与持续音。不能把伴奏、合唱或和弦可靠拆成人声旋律。 |
| [Tesseract.js](https://github.com/naptha/tesseract.js) | [Apache-2.0](https://github.com/naptha/tesseract.js/blob/master/LICENSE.md) | 在浏览器提取简谱中的数字与文字，供人工核对后导入。它是文字 OCR，不是五线谱识别器；上游也明确不直接读取 PDF。 |
| [PDF.js / pdfjs-dist](https://github.com/mozilla/pdf.js) | [Apache-2.0](https://github.com/mozilla/pdf.js/blob/master/LICENSE) | PDF 页面渲染、预览和文字提取；扫描 PDF 先渲染成图像，再进行识别。PDF.js 本身不理解音符、节奏或谱表。 |
| [@tonejs/midi](https://github.com/Tonejs/Midi) | [MIT](https://github.com/Tonejs/Midi/blob/master/LICENSE.md) | 读取 MIDI 音符、时间与轨道；多轨 MIDI 必须选择要唱的旋律轨道。MIDI 不包含原始乐谱版式。 |
| [JSZip](https://github.com/Stuk/jszip) | [MIT OR GPL-3.0](https://github.com/Stuk/jszip/blob/main/LICENSE.markdown)，本项目选择 MIT | 解压压缩 MusicXML（`.mxl`）。它仅负责 ZIP 容器，音符语义由本项目解析。 |
| [Audiveris](https://github.com/Audiveris/audiveris) | [AGPL-3.0](https://github.com/Audiveris/audiveris/blob/master/LICENSE) | 可选的五线谱 OMR 工具：从图像识别音乐结构并导出 MusicXML。需要独立安装/服务，不能当作浏览器内的轻量库。 |

Audiveris 上游说明：真实曲谱无法普遍达到 100% 识别率，编辑器用于修正识别结果；可导出的 MusicXML 也只是其内部数据的一个子集。[官方说明](https://github.com/Audiveris/audiveris#key-characteristics)

Audiveris 保留独立工具的许可，不包含在前端构建中。部署其服务或修改其代码时，应依据上游 AGPL 条款处理对应源码与声明；“独立进程”本身并不取消上游许可义务。本项目的 MusicXML 文件接口也可读取用户用其他工具生成的文件。

## 首版的能力定义

1. **实时音准**：Web Audio 获取麦克风的单声道信号，pitchy 估计基频，再转换为音名、八度和音分偏差；低音量、低清晰度的帧不当作有效音符。
2. **目标音模唱**：以 A4 = 440 Hz 的十二平均律计算目标频率；用 Web Audio 合成钢琴风格和手风琴风格的音色。合成音色是听音参考，不宣称与真实乐器采样相同。
3. **曲谱模板**：优先导入 MusicXML / MXL / MIDI 等包含明确音高与时值的文件，再转换为统一练习事件。简谱文字或 OCR 文本需核对调号、八度、休止与时值后应用。
4. **图片/PDF**：页面可预览与识别简谱文字；五线谱需要配置可选 OMR 服务，或先在 Audiveris 中转换为 MusicXML。未配置时必须显示真实限制，不能把文字 OCR 的结果包装成完整五线谱识别。
5. **练习反馈**：把演唱基频与当前目标音及时序比较，提供音高与节奏的练习反馈。单音估计算法和浏览器输入延迟都会影响结果，不能把练习百分比分数视为专业声乐考试成绩。
6. **跨端**：响应式界面和 PWA 适配桌面、平板、手机。公网麦克风需安全上下文（HTTPS）；浏览器也要求用户主动触发发声和麦克风授权。设备兼容性以实际测试记录为准。

参考音外放可能被麦克风重新拾取。练习可采用先听后唱或耳机方式，不能把外放参考音误判为使用者已唱准。麦克风信号默认留在当前设备；若用户选择识别服务，则该服务接收的是待识别的曲谱文件，界面应说明这一点。

## 许可证与资源决策

- 本项目原创代码采用根目录 `LICENSE` 指定的开源许可；第三方依赖仍适用各自许可。
- `THIRD_PARTY_NOTICES.md` 记录直接依赖及上游许可。锁定版本以 `package-lock.json` 为准，分发时保留依赖中的许可证与通知文件。
- 使用自编练习旋律与自行合成的参考音，避免把网上曲谱、录音、字体或乐器音源的许可误当作程序库许可。
- 相似项目的功能清单只用于调研，没有复制其品牌、素材、页面或完整架构。

## 一手来源

- [Visual Pitch Trainer README](https://github.com/iuill/visual-pitch-trainer/blob/main/README_en.md) 与 [MIT License](https://github.com/iuill/visual-pitch-trainer/blob/main/LICENSE)
- [Singing Experience README](https://github.com/kunukn/singing-experience) 与 [0BSD License](https://github.com/kunukn/singing-experience/blob/main/LICENSE)
- [pitchy README](https://github.com/ianprime0509/pitchy) 与 [0BSD License](https://github.com/ianprime0509/pitchy/blob/main/LICENSE)
- [Tesseract.js：Project Scope](https://github.com/naptha/tesseract.js#project-scope)
- [PDF.js 官方仓库](https://github.com/mozilla/pdf.js)
- [Tone.js MIDI 官方仓库](https://github.com/Tonejs/Midi)
- [JSZip 双许可文本](https://github.com/Stuk/jszip/blob/main/LICENSE.markdown)
- [Audiveris 官方仓库与识别边界](https://github.com/Audiveris/audiveris)
