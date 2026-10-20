# 微信云托管部署（2026-10-20）

使用本项目 backend，不需要把业务代码搬到下载的 Express 计数器模板。现有后端是 Node HTTP 服务，不依赖 Express 或 MySQL。

## 环境变量读取说明

### chat-v6：单次模型调用与实时流式

当前版本为 `2026-10-20-chat-v6`，`/health` 的 `streaming`、`singleModelCall`、`timings` 能力均为 true。需要部署新的 `cloudrun-upload.zip`，并重新编译、发布小程序；无需重新导入材料。

- 模型接口使用 SSE `stream:true`，小程序通过 `wx.cloud.connectContainer` 的 WebSocket 接收增量文字。服务必须支持 WebSocket Upgrade；保持现有微信网关身份校验及私有访问方式。连接失败时自动查询同一个任务的增量快照，不重复提交模型。
- 每个非预设问题只请求模型一次，不再执行工具调用循环。后端一次准备材料：目录上限 18000 字符、正文上限 24000 字符；每个文档先覆盖一段，再补充相关段落和其他段落。关键词评分仅帮助排序，未命中仍提供目录和正文并正常调用模型。超大资料库只提供预算内的部分内容，不能保证穷尽全文。
- 系统提示词集中在 `backend/src/model.js` 的 `SYSTEM_PROMPT`，默认 2–4 个要点、约 150–250 字；明确要求详细时可展开，不硬截断。相关图片与视频继续按名称语义选择并在最终回答下方展示。
- Qwen 默认发送 `enable_thinking=false`，减少隐藏推理等待；`MODEL_ENABLE_THINKING=true` 可显式开启，其他提供商默认不发送该扩展参数。生产已有环境变量会覆盖默认设置。模型总超时仍默认 90000 毫秒。
- 搜索 `[timing] requestId=...` 关联同一问题：`job_create` 是首次持久化；`indexMs` 是索引加载；`prepareMs` 是材料准备；`firstTokenMs` / `firstAnswerMs` 是上游首内容/首可读文字；`generationMs` 是之后生成；`parseMs` / `citationsMs` 是解析和附件组装；`job_finish` 是最终持久化，含存储写入次数和累计耗时。`modelCalls` 应为 1（预设问题为 0）。
- 开发者工具控制台的 `[chat timing]` 记录 `firstDisplayMs`、`totalDisplayMs`、`assetUrlMs`、`imageReadyMs`，用于区分后端生成与客户端网络、素材展示延迟。日志不记录密钥和问题正文。
- 对象存储增量快照每秒最多写一次，不等待其完成再继续接收 token；最终结果等待持久化后交付。跨副本推送可能约延迟 1–2 秒。容器重启仍会影响正在生成的任务，未引入独立任务队列。

### chat-v5：媒体附件与回答展示

历史版本为 `2026-10-20-chat-v5`。模型可按语义直接选择本轮目录中的图片、视频作为回答附件，无需额外读取或正文编号；仅有名称时不描述具体画面。回答不复述内部匹配规则，名称索引说明不再显示在聊天卡片中。需部署新版后端并重新编译、发布小程序，无需重新导入材料。

### chat-v4：等待体验和上下文优化

上一版本为 `2026-10-20-chat-v4`，`/health` 的 `capabilities.chatProgress` 应为 true。需同步部署后端并重新编译小程序。

- 最近历史从最多 20 条 / 12000 字符缩至 8 条 / 6000 字符；助手消息最多 1000 字符，用户消息最多 1500 字符，超长历史保留首尾。较久之前的细节可能需重新补充。
- 默认回答按原详尽回答约三分之二组织，通常 3–5 个要点；保留关键条件和引用，用户要求详细时可展开。通过生成提示控制，不硬裁截答案或引用。
- 小程序显示真实处理阶段和等待秒数，允许预先输入下一问题；可暂停等待、浏览资料库，恢复时继续获取同一任务。重进聊天也会恢复保存的任务，不重复触发模型。暂停仅停止客户端查询，后台任务仍继续。
- 单次云托管请求仍为 12 秒；轮询网络错误、429 和 5xx 使用逐步退避重试，最多 8 次。总等待约 180 秒，超过后仍保留任务号供继续获取。
- 模型默认总预算从 45 秒改为 90 秒，上限 120 秒。已有云端 `MODEL_TIMEOUT_MS=45000` 会继续覆盖默认值；希望容忍慢回答时显式改为 `MODEL_TIMEOUT_MS=90000`。这项只减少慢任务被中止，不代表生成本身加速。
- chat-v4 的阶段提示不是流式输出；chat-v6 已支持实时文字。独立持久任务队列仍未引入。

生产容器直接读取云托管注入的 process.env，不读取 .env 文件。仅本地开发读取 backend/.env 作为后备，且同一配置的运行环境变量（包括别名）始终优先。

- 模型地址：MODEL_API_URL（也支持 API_URL）。
- 模型密钥：MODEL_API_KEY（也支持 API_KEY）。
- 模型名称：MODEL_NAME（也支持 MODEL）。
- 同一环境同时提供标准名称和别名时，标准名称优先。没有明确 MODEL_MODE 但有模型密钥时，自动启用 api；显式 MODEL_MODE=mock 仍使用摘录。
- COS 使用 COS_BUCKET、COS_REGION、COS_SECRET_ID、COS_SECRET_KEY，以及可选 COS_PREFIX、COS_SESSION_TOKEN。桶名和地域本身不足以访问私有桶，还需要凭据。
- MYSQL_ADDRESS、MYSQL_PASSWORD、MYSQL_USERNAME 是原 Express 计数器模板的数据库变量；本项目没有数据库业务，不读取它们，也不会自动把 COS 资料写入 MySQL。保留这些变量不影响启动。
- 云托管仍需保持 DEPLOYMENT_MODE=cloud、STORAGE_MODE=cos、PORT=8080。所有通过已关联小程序调用的用户都可访问共享资料库；ALLOWED_OPENIDS 已停用，可从环境变量删除，旧值不会限制用户。

修改云端变量后按控制台提示使服务新配置生效；无需把真实密钥写进代码或 GitHub。变量是否生效、COS 是否可读取和模型是否实际响应，需部署后验证。

## GitHub 自动部署（替代手动上传 ZIP）

本项目现有 origin 为 https://github.com/miaojunshihanhan/AIAgent_MiniProgram.git，当前分支 main。建议在已有 express-ec98 服务的流水线中关联此仓库，不要用模板仓库覆盖现有项目。自动部署只会监听流水线绑定的仓库及分支。

在云托管中选择 GitHub 并授权访问此仓库，配置：

- 仓库：miaojunshihanhan/AIAgent_MiniProgram
- 分支：main；开启该分支 Push 触发。
- 构建上下文 / 目标目录 / 代码目录（界面名称可能不同）：backend。
- Dockerfile：backend 目录内的 Dockerfile；若字段相对构建目录填写 Dockerfile，若字段相对仓库根目录填写 backend/Dockerfile。不能只改 Dockerfile 路径而保留仓库根目录为构建上下文，因为当前 COPY package.json 会相对构建上下文查找。
- 服务端口：8080；如使用 HTTP 健康检查，路径 /ready。
- 构建启动由 Dockerfile 的 npm ci 和 node src/server.js 完成，无需配置 Express 模板的 npm start。

若「模板二次开发」只允许复制模板到一个新仓库，可先完成该流程，再编辑已有服务流水线，让它指向上面的现有仓库和 backend 构建目录。若界面不能切换仓库，则克隆实际绑定的新仓库到另一个目录，把本项目 backend 里的 src、Dockerfile、.dockerignore、package.json、package-lock.json 放到新仓库根目录并提交；此时构建上下文为根目录，Dockerfile 为 Dockerfile。保留平台生成的流水线文件，不要复制 .env、node_modules、materials、data 或本机 .git。不要向新仓库强推本项目历史，也不要把本机 origin 盲目改成新仓库。

确认绑定和服务环境变量后，在现有项目 PowerShell 提交后端代码：

```powershell
Set-Location D:\VsCodePrograms\Agent
git status --short
git add -- backend .gitignore README.md
git diff --cached --stat
git diff --cached --name-only
# 核对暂存列表不含 .env、materials、data、node_modules 或 ZIP 后：
git commit -m "Configure cloud hosting backend and COS storage"
git push origin main
```

这组命令只提交后端部署相关文件，不自动包含小程序端尚未提交的更改。小程序 app.js、services/api.js、pages/source/source.js、config/api.example.js 可在确认后单独提交；本机 config/api.js 已配置但被 Git 忽略，在微信开发者工具中重新编译即可生效。云托管流水线不会代替小程序上传发布。

推送后到云托管流水线检查此次提交 SHA、构建日志、部署结果和版本流量。若只创建了版本，按控制台配置完成发布；不要仅凭 GitHub 推送成功判定部署成功。此文档不包含预设的 GitHub Actions YAML，先使用控制台为服务创建的流水线。

自动部署只更新代码镜像：COS 桶、模型密钥和服务环境变量仍须配置；资料仍通过下文的 npm run upload:cos 上传。推送 GitHub 不会上传被忽略的业务资料。

## 1. 创建资料存储桶

在腾讯云 COS 控制台新建标准存储桶，权限选「私有读写」，建议与云托管同地域。记录完整桶名（含 APPID 后缀）和地域英文标识，例如 ap-shanghai。不要将整个桶改成公有读。

创建仅有此桶 knowledge-agent/* 对象读写、分块上传所需权限的 CAM 子用户密钥，用于本地上传；服务端可以配置另一套只读密钥（GetObject、HeadObject），不要使用主账号密钥。凭据只填 backend/.env 或云托管环境变量，不能填小程序。COS 与模型服务会产生按量费用。

## 2. 上传已有资料（本机 PowerShell）

编辑 backend/.env，保留原有模型参数和本地 HOST/PORT，补充：

```dotenv
COS_BUCKET=你的完整桶名
COS_REGION=你的桶地域英文标识
COS_PREFIX=knowledge-agent
COS_SECRET_ID=你的上传凭据SecretId
COS_SECRET_KEY=你的上传凭据SecretKey
```

不要将上述占位文字原样填写。临时凭据还需 COS_SESSION_TOKEN。

```powershell
Set-Location D:\VsCodePrograms\Agent\backend
npm ci
# 自动扫描 materials 并重新生成本地索引，支持新增、删除、改名和内容修改：
npm run upload:cos
```

脚本默认读取 D:\VsCodePrograms\Agent\backend\materials（可通过 MATERIALS_ROOT 修改），先同步材料名称和内容到 data，再将新索引引用的原件、已有 PPT 页图以及索引上传到 COS。只改文件名也会更新资料库标题和文档 ID，旧名称不会保留在新索引中；改名后的 PPT 页图需按新的文档 ID 重新生成。媒体的配套说明文件也应一起改名，例如 视频.mp4.txt：

```text
knowledge-agent/knowledge.json
knowledge-agent/originals/...
knowledge-agent/previews/文档ID/版本/页号.png
```

上传采用分块方式，支持现有较大 PPT 和视频；已存在且大小相同的哈希原件、页图会跳过。索引在文件成功后最后发布，云端最长约 60 秒刷新。不需要手动把 materials 原件再传到别处，不需要创建 MySQL。旧版本对象不会自动删除。桶地域、前缀必须和服务端一致。

## 3. 在已有 express-ec98 服务创建新版本

每次改后端后，在项目根目录先执行 `powershell -NoProfile -ExecutionPolicy Bypass -File backend/scripts/package-cloud.ps1`，重新生成并校验 `backend/cloudrun-upload.zip`。旧 ZIP 不会随源码修改自动更新。打包只包含运行代码、Dockerfile 和依赖清单，不包含密钥、材料或本地索引。

部署发布并分配流量后，在小程序请求 `/health`，确认 `runtimeVersion` 为 `2026-10-20-chat-v6`，且 `capabilities.materialTools`、`capabilities.conversation` 和 `capabilities.asyncChat` 为 true。没有这些字段说明流量还在旧后端；仅在本机重新编译小程序不会更新云托管。新版小程序会在顶部提示“云端仍为旧版，请部署新版后端”。

### 问答超时修正（chat-v3）

小程序通过 `POST /chat/jobs` 创建任务，使用 `/chat/jobs/:jobId/stream` WebSocket 接收实时文字；断线时 `GET /chat/jobs/:jobId` 获取同一任务的增量快照和最终结果。普通请求设置 12 秒超时，模型默认总预算 90 秒，轮询等待预算 180 秒。旧的同步 `/chat` 保留给兼容客户端。

部署后端和重新编译小程序必须一起完成。后台日志包含 requestId、modelCalls、分阶段耗时和总 elapsedMs，便于区分多次请求；`citations=0` 只表示本轮未引用材料，不代表网络请求失败。

任务状态和回答写到私有 COS 的 `knowledge-agent/chat-jobs/`（使用自定义 COS_PREFIX 时随前缀变化），支持轮询落到其他实例。不会把问题和历史存入任务文件；回答和引用仍属于业务数据。服务现有 COS 凭据需有此子目录的 GetObject / PutObject 权限；不必扩大整个桶权限，也不要改公有读。对象接口有效期 15 分钟，物理文件可配置仅限 chat-jobs/ 前缀的一天生命周期回收。

后台任务在容器进程内执行，不是独立持久队列；建议服务最小实例数设为 1 以保持任务运行（会增加常驻实例费用）。发布或重启期间在途任务可能失败，客户端会显示任务超时或模型错误，而不再统一提示权限异常。

进入微信云托管环境 prod-d9ggn765cba2ad61f，打开已有服务 express-ec98，创建新版本，使用本地代码上传。

- 上传源代码目录：D:\VsCodePrograms\Agent\backend（不要选整个小程序，也不要选下载的 Express 模板）。
- 如果界面需要 ZIP：直接上传已生成的 backend/cloudrun-upload.zip；以后改代码后需重新打包，包含 Dockerfile、.dockerignore、package.json、package-lock.json、src，Dockerfile 必须在包根目录。
- 构建目录为 backend 的内容根目录；Dockerfile 路径 Dockerfile；服务监听端口 8080。
- Dockerfile 使用非 root 用户，预设 HOST=0.0.0.0、PORT=8080、DEPLOYMENT_MODE=cloud、STORAGE_MODE=cos。若旧服务环境变量覆盖了它们，请在控制台显式改为这些值。
- 如配置健康检查，使用 HTTP GET /ready。/ready 只返回存活状态，真正的资料读取通过 /health 验证。
- 不上传 .env、node_modules、materials 或 data。镜像只包含代码和依赖；现有 Dockerfile 已限制 COPY 范围。

在服务设置中配置环境变量（不是 container.config.json）：

```dotenv
HOST=0.0.0.0
PORT=8080
DEPLOYMENT_MODE=cloud
STORAGE_MODE=cos
COS_BUCKET=同一个完整桶名
COS_REGION=同一个桶地域
COS_PREFIX=knowledge-agent
COS_SECRET_ID=服务端只读凭据SecretId
COS_SECRET_KEY=服务端只读凭据SecretKey
MODEL_MODE=api
MODEL_API_URL=沿用本地.env里的模型接口地址
MODEL_API_KEY=沿用本地.env里的模型密钥
MODEL_NAME=沿用本地.env里的模型名称
MODEL_TIMEOUT_MS=45000
MODEL_ENABLE_THINKING=false
```

无需配置 ALLOWED_OPENIDS，所有小程序用户都能访问。只联调时可 MODEL_MODE=mock。若本地模型使用 localhost 或电脑代理地址，应改为云端可访问的供应商 HTTPS 地址。不得将占位说明当作实际配置。构建完成后发布该版本并分配流量。

## 4. 关联小程序与访问权限

确认此云托管环境关联了当前小程序。**关闭服务公网访问入口**，仅允许关联小程序通过微信网关调用；服务器读取网关注入的身份头，不能把这些头当作开放公网接口的身份校验。/whoami 仅返回当前调用人的 OpenID。

小程序 config/api.js 已设置好环境和服务名；app.js 会初始化 wx.cloud。无需收集用户 OpenID 或配置白名单，重新编译即可调用。需要调试当前调用身份时，可在开发者工具控制台执行：

```js
wx.cloud.callContainer({
  config: { env: 'prod-d9ggn765cba2ad61f' },
  path: '/whoami',
  header: { 'X-WX-SERVICE': 'express-ec98' },
  method: 'GET'
}).then(res => console.log(res.data))
```

返回的 openid 仅用于身份调试，不需要填入环境变量。所有小程序用户共享同一资料库；云端仍要求微信网关注入的身份头。ALLOWED_OPENIDS 旧配置可以删除。

在小程序管理后台的服务器域名设置中，将该 COS 桶的 HTTPS 域名加入 downloadFile 合法域名，如 https://完整桶名.cos.地域.myqcloud.com。不要带路径或签名参数。图片、视频、PPT 原件和页图从 COS 临时签名链接下载，链接有效期 10 分钟，不要分享。视频长时间停留后失败时点「下载到本机后播放」，会重新获取链接。页面和元数据通过 callContainer 请求。

## 5. 验证与日常更新

重新编译小程序，首页应显示材料数；测试一个材料问题，检查回答引用；在资料库打开图片、视频、PPT 页图和原文件。若报 503 先检查环境变量和 COS 权限、索引是否上传；401 检查小程序关联与云调用身份；下载失败检查 downloadFile 域名。

资料变动：在电脑 backend/materials 修改或改名 → npm run upload:cos（自动导入后上传）。不必重建代码镜像。已有 PPT 页图来自本地 data/previews；新 PPT 未生成页图时仍可查看提取文字。

代码变动：上传 backend 创建新版本 → 构建 → 发布。小程序代码变动：重新编译/上传小程序。模型密钥变动：只更新服务环境变量。原计数器 /api/count 已被本业务 API 替代，不应再用于验证聊天功能。

部署前本机执行 npm test。真实 COS 上传、云托管构建和真机验收需要在你自己的账号配置后完成；本地测试不代表已发布。
