# 微信小程序材料助手

> 云托管部署已接入，具体步骤以 [backend/DEPLOY.md](backend/DEPLOY.md) 为准。当前本机 config/api.js 使用云托管；下文的本地联调说明仅适用于 mode=local。

已实现原生小程序聊天、资料库、引用证据、逐行原文查看，以及 Node.js 本地后端。当前为开发框架，不是已上线服务。

## 1. 启动

需要 Node.js 22+，在 backend 先运行 npm ci 安装锁定依赖。

在项目根目录用 PowerShell 执行：

    # 首次克隆时复制；已有本地配置请勿覆盖
    Copy-Item project.config.example.json project.config.json
    Copy-Item config/api.example.js config/api.js
    Copy-Item backend/.env.example backend/.env
    Set-Location backend
    npm run import
    npm start

将 UTF-8 编码的 .txt / .md 材料放在 backend/materials 后再次执行 npm run import；导入后服务自动读取最新索引，不必重启。默认目录为空，不会将说明文件冒充业务材料。可在 .env 设置 MATERIALS_ROOT 为独立材料目录的绝对路径（Windows 建议正斜杠）。

默认服务 http://127.0.0.1:3000，GET /health 检查状态。MODEL_MODE=mock 仅用于摘录联调，明确标识未调用模型；正式模型问答使用 MODEL_MODE=api。

## 2. 填写模型 API

只编辑 backend/.env，切勿在小程序里放密钥：

    MODEL_MODE=api
    MODEL_API_URL=https://你的服务商完整地址/v1/chat/completions
    MODEL_API_KEY=你的密钥
    MODEL_NAME=你的模型名称

修改配置后重启后端。MODEL_API_URL 填完整接口地址，不自动拼接路径。当前适配 Chat Completions 格式，其他协议修改 backend/src/model.js 中 MODEL API ADAPTER 标注处（请求头、请求体、响应读取）。生成模型按提示返回 answer / usedIds JSON；不兼容时会明确报错，不会偷偷降级为摘录。

## 3. 微信开发工具

继续以当前目录作为小程序项目根目录，无需移动原有文件。config/api.js 的 baseUrl 填后端服务地址；仅包含后端地址，不能填模型密钥。

开发工具本地联调时可使用 http://127.0.0.1:3000，并开启本地不校验合法域名设置（只用于开发）。本机 project.private.config.json 中的开发调试设置不会提交 Git；新环境需在开发工具里自行开启。手机上的 127.0.0.1 指向手机自身，真机必须换为电脑局域网 IP 或可访问的 HTTPS 服务；局域网联调还需 HOST=0.0.0.0、同一网络及相应防火墙配置。由于当前没有登录和文件权限，不要把该开发服务直接暴露到公网。正式发布前实现鉴权、HTTPS、合法域名和权限隔离。

前端三个页面：pages/index（聊天）、pages/library（材料库）、pages/source（证据和原文）。本机保存最多 30 条消息；每次提问发送最近最多 20 条历史、合计最多 12000 字符，每条最多 4000 字符。模型结合这些历史理解追问；不提供服务端跨设备会话。“清空”删除本机记录，也清除后续提问携带的上下文。

## 4. 存储和更新

- backend/materials：待导入材料，不打包到小程序、不提交 Git。
- backend/data/knowledge.json：原文分块与材料目录；API 模式由模型按语义选择并读取材料，倒排索引只用于 mock 摘录联调。
- backend/data/originals：按哈希保存原文件快照，不覆盖同名旧版本。
- 删除材料并重新导入后，不再可检索或从接口读取；旧快照仍在磁盘保留，需按后续保留策略清理。
- 文档版本变化时旧引用返回明确的版本失效提示，避免打开错误版本；首版不支持历史版本在线查看。
- TXT / Markdown 使用行号定位，不虚构页码；Markdown 作为纯文本显示。原文每次加载 80 行，命中片段单独完整显示。
- 支持 DOC/DOCX/PPTX/XLSX/TXT/MD 和图片/视频；PDF、自动 OCR、语音转写及向量索引尚未实现。云托管与 COS 配置见 backend/DEPLOY.md。

API 模式除三种预设问题外都调用模型，不再以关键词命中与否拦截。模型一次接收材料目录、预算内正文和对话历史，按语义选择依据和媒体；实际引用原文由后端返回。没有相关材料时可正常提供通用回答，并区分材料依据与通用知识。引用合法性校验不等于事实支持度验证。

## 5. API

- GET /health：模式、配置状态、材料数量。
- GET /documents：材料列表。
- POST /chat：JSON {"question":"问题","history":[{"role":"user","content":"此前问题"},{"role":"assistant","content":"此前回答"}]}，history 可省略，返回 answer、mode、modelInvoked、citations。
- GET /documents/:id?version=...&offset=0：原文行分页。
- GET /documents/:id/chunks/:chunkId?version=...：指定原始片段。
- GET /documents/:id/original?version=...：下载原文件，当前前端使用原文查看页。

开发版共享单一知识库，无登录、多租户或对话服务端持久化。禁止直接作为生产部署。

## 6. 验证

在 backend 执行 npm test。测试使用独立临时目录，不写入业务材料或业务索引。涵盖导入、中文检索、原文一致性、版本更新与撤销、无依据返回、API 适配和错误引用拒绝。小程序 UI 需要在微信开发工具及真机验证；本地 Node 测试不能代替微信渲染验收。

## 7. 不使用业务材料的快速演示

可选：在项目根目录执行以下命令，将明确标识的示例复制到材料目录，然后导入：

    Copy-Item backend/examples/入门示例.md backend/materials/入门示例.md
    Set-Location backend
    npm run import
    npm start

在小程序提问“如何导入材料”或“模型配置在哪里”，即可检查摘录、来源和全文流程。该示例不是业务知识；正式导入前可删除。

本轮实现日期：2026-10-20。

### 云托管问答等待方式（chat-v3）

最新版本为 **chat-v6**：单次模型调用，SSE 生成 + WebSocket 实时展示，默认只回 2–4 个要点、约 150–250 字。保留最近 8 条 / 6000 字符历史、暂停恢复和媒体附件。部署后 `/health` 应返回 `2026-10-20-chat-v6`，且 `capabilities.streaming`、`capabilities.singleModelCall` 为 true；需同步重新编译发布小程序。

云托管小程序通过 `/chat/jobs` 提交任务，再通过 `wx.cloud.connectContainer` 订阅实时文字；连接失败自动获取原任务快照，不重新调用模型。COS 任务状态需要 `chat-jobs/` 子目录读写权限。分阶段耗时与部署说明见 backend/DEPLOY.md。

## 多格式材料更新（2026-10-20）

后端现在需要先运行 npm ci 安装锁定依赖，再执行 npm run import。支持 DOC、DOCX、PPTX、XLSX、TXT、MD；PPT 保留幻灯片编号，Excel 保留工作表和行位置。文档只提取文字，不自动 OCR 图片；Excel 读取保存值，不计算公式。旧版 DOC 直接解析正文。

JPG/JPEG/PNG/WebP/MP4 原件收录后支持图片预览/视频播放。无文字时状态为 name_only，模型按文件名称语义匹配并引用；这不代表模型识别了画面或音频。旧索引中的无文字媒体也会自动补充名称元数据，无需先重新导入。可添加完整文件名加 .txt 的配套文本，例如 1.jpg.txt 或 1..mp4.txt；重新导入后文本作为该媒体的问答依据。配套文本不得超过 5MB。

Office 与媒体上限 512MB；按流计算哈希和传输视频，视频支持 Range。大 Office 文件在手机端可能无法打开，可先查看提取文本或在电脑打开原件。原件快照保存在 backend/data/originals，需预留磁盘空间；材料无修改时不会重复复制。详细结果见 backend/data/import-report.json。

导入结果区分 documentCount（全部收录）、searchableCount（含可检索文本）、pendingTextCount（待识别）。新规则替代本文前面的“仅支持 TXT/Markdown”和“无需安装依赖”说明。

## 真机、模型与视频联调修正

局域网联调时，将 config/api.js 的 baseUrl 改为 http://<电脑局域网IP>:3000，并在 backend/.env 设置 HOST=0.0.0.0；模拟器与手机共用此地址。电脑换网络/IP 后需更新。手机浏览器访问该地址的 /health 先验证连通；后端重启才能使 .env 生效。手机与电脑需同一网络且路由器允许设备互访。若 Windows 防火墙提示，允许 Node 在可信的专用网络通信，不要关闭整个防火墙。微信调试需要启用开发网络设置，正式使用配置 HTTPS 合法域名。

已有模型配置时，将 MODEL_MODE=api；显式保留 mock 不会调用模型。API 地址可填完整 chat/completions 或兼容服务根地址，适配器自动补齐路径。模型接口需兼容 Chat Completions SSE 输出，不再需要 tools/tool_calls。后台日志 [model] requesting/completed 可验证是否调用，响应包含 modelInvoked；没有检索依据也会调用模型。模型 Key 不输出到日志。未执行真实模型测试时，不代表供应商接口已经验证。

原文媒体页面使用 webview 渲染器，视频支持错误详情与下载到本机后播放作为后备方式。当前材料的 MP4 检测到 AVC/AAC 标记，仍以微信实际解码为准。无需重新导入材料。

## 按页引用与输入节省（2026-10-20）

仅“你好”“再见”“你是什么模型”使用本地预设回复（忽略首尾空白及常见标点）；“你是什么模型”直接返回后端配置 MODEL_NAME 的值，未配置时明确提示。“谢谢”“你是谁”和带业务内容的混合提问都调用模型。

导入生成 backend/data/catalog.json 目录与 knowledge.json 分块、索引和 PPT 页文字。按文件哈希及配套文本哈希复用解析结果。API 模式在后端一次准备目录（18000 字符）与正文（24000 字符），保持多文档覆盖并补充相关段落；不再执行模型工具调用循环。超出预算的正文不会全部发送。mock 摘录保留 3 段 / 1800 字限额。

回答下方直接展示依赖材料的完整引用分块，不再裁切或要求点击展开；PPT 展示引用页全文并尝试加载页图，图片直接显示，视频直接播放。完整文件入口仍保留。聊天页使用 webview 渲染器以支持视频；云端媒体使用短期签名链接，重进页面或点击重试会刷新。PPT 页图存放 backend/data/previews/{documentId}/{version}/{页号}.png，不发送给文本模型。PowerPoint 导出脚本 backend/scripts/export-slides.ps1 只读打开原件并禁用宏。

输入框占据可用宽度，发送按钮固定 112rpx。变更后重启后端并重新编译小程序。

## GitHub 提交与本地隐私配置

仅提交脱敏模板：project.config.example.json、config/api.example.js、backend/.env.example。首次克隆按启动命令复制配置，再在微信开发工具中填写自己的 AppID。AppID 是应用标识，不是 AppSecret；为避免混用个人项目，真实配置仅保留本地。config/api.js 仍会打包进小程序，不能填写模型密钥。

以下内容不提交：backend/.env 等环境变量文件、backend/materials 原始业务材料、backend/data 解析索引/原件快照/PPT 页图、本机 project.config.json 和 project.private.config.json、config/api.js 的局域网地址、CloudBase 本地调试配置、私钥与证书容器。示例材料 backend/examples 和依赖锁文件可以提交。

.gitignore 只能防止后续跟踪，不能清除已有提交历史。首次提交若包含本机地址或 AppID，取消跟踪后旧提交仍然保留；发布前应检查 git log。若曾提交真实密钥，应先在供应商处撤销或轮换，再清理历史。不要将真实材料复制到未忽略的目录。
