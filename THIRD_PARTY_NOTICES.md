# 第三方软件声明

本项目的原创代码许可证见根目录 `LICENSE`。第三方软件按其各自许可证提供，不因本项目的许可而重新授权。本文件是依赖与上游声明的索引；各包自带的完整 LICENSE、NOTICE 及版权声明应随其分发保留。具体安装版本以 `package-lock.json` 为准。

## 前端直接依赖

| 软件 | 作者/版权主体 | 本项目采用的许可 | 用途与上游原文 |
| --- | --- | --- | --- |
| pitchy | Ian Johnson | 0BSD | 实时基频检测。[源码](https://github.com/ianprime0509/pitchy) · [许可原文](https://github.com/ianprime0509/pitchy/blob/main/LICENSE) |
| Tesseract.js | Tesseract.js contributors | Apache-2.0 | 浏览器文字 OCR。[源码](https://github.com/naptha/tesseract.js) · [许可原文](https://github.com/naptha/tesseract.js/blob/master/LICENSE.md) |
| PDF.js / pdfjs-dist | Mozilla Foundation and contributors | Apache-2.0 | PDF 渲染与文字提取。[源码](https://github.com/mozilla/pdf.js) · [许可原文](https://github.com/mozilla/pdf.js/blob/master/LICENSE) |
| @tonejs/midi | Yotam Mann and contributors | MIT | MIDI 解析。[源码](https://github.com/Tonejs/Midi) · [许可原文](https://github.com/Tonejs/Midi/blob/master/LICENSE.md) |
| JSZip | Stuart Knightley, David Duponchel, Franz Buchinger, António Afonso and contributors | MIT（双许可中的 MIT 选项） | MXL/ZIP 解压。[源码](https://github.com/Stuk/jszip) · [许可原文](https://github.com/Stuk/jszip/blob/main/LICENSE.markdown) |
| Lucide | Lucide Icons and Contributors；部分图标源于 Cole Bemis 的 Feather 项目 | ISC；上游列明的 Feather 派生图标保留 MIT 声明 | 界面图标。[源码](https://github.com/lucide-icons/lucide) · [ISC 与 Feather MIT 声明](https://github.com/lucide-icons/lucide/blob/main/LICENSE) |

以上依赖未经本项目修改。构建工具、测试工具及传递依赖保留各自 npm 分发包中的许可；维护者发布新的独立二进制包、离线包或前端构建时，应同步包含所分发代码的完整许可及上游 NOTICE。项目的依赖锁文件是版本清单，不替代许可文本。

## 可选外部工具

[Audiveris](https://github.com/Audiveris/audiveris) 由 Audiveris 项目及贡献者提供，采用 [GNU Affero General Public License v3.0](https://github.com/Audiveris/audiveris/blob/master/LICENSE)。其程序、模型与 Java 运行时不包含在前端分发文件中；仅在用户另行安装并配置识别服务时，通过文件转换流程使用。安装、修改、再分发或部署 Audiveris 时仍需遵守其许可证和通知要求。项目未将 Audiveris 重新授权为 MIT。

Tesseract.js 首次识别时可能加载 OCR 引擎和语言数据，这些资源来自对应上游，适用它们自己的许可；不能仅依据 JavaScript 包的名称省略其声明。

## 调研参考

[Visual Pitch Trainer](https://github.com/iuill/visual-pitch-trainer)（MIT）、[Singing Experience](https://github.com/kunukn/singing-experience)（0BSD）等是功能调研对象。本项目未复制这些完整应用的代码或素材。详细采用边界与来源见 [开源调研](docs/OPEN_SOURCE_RESEARCH.md)。

## 音乐与音色

参考音由本项目通过 Web Audio 合成，不使用第三方钢琴/手风琴采样包。内置练习由项目自行编写。用户导入的谱面、MIDI、MusicXML 等文件的版权与使用权由对应权利人决定，软件的开源许可不授予第三方歌曲或曲谱的权利。
