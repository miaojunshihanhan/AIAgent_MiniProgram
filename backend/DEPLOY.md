# 微信云托管部署（2026-10-20）

使用本项目 backend，不需要把业务代码搬到下载的 Express 计数器模板。现有后端是 Node HTTP 服务，不依赖 Express 或 MySQL。

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

自动部署只更新代码镜像：COS 桶、模型密钥、服务环境变量和 OpenID 白名单仍须配置；资料仍通过下文的 npm run upload:cos 上传。推送 GitHub 不会上传被忽略的业务资料。

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
# 已有 data/knowledge.json 与 originals、previews 时可直接上传。
# 新增、删除或修改 materials 中的资料后，先执行：
npm run import
npm run upload:cos
```

脚本会将当前索引引用的原件、已有 PPT 页图以及索引上传到 COS：

```text
knowledge-agent/knowledge.json
knowledge-agent/originals/...
knowledge-agent/previews/文档ID/版本/页号.png
```

上传采用分块方式，支持现有较大 PPT 和视频；已存在且大小相同的哈希原件、页图会跳过。索引在文件成功后最后发布，云端最长约 60 秒刷新。不需要手动把 materials 原件再传到别处，不需要创建 MySQL。旧版本对象不会自动删除。桶地域、前缀必须和服务端一致。

## 3. 在已有 express-ec98 服务创建新版本

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
ALLOWED_OPENIDS=下一步获取的OpenID
```

先不配置 ALLOWED_OPENIDS 也能启动并调用 /whoami，但无法读取任何资料。只联调时可 MODEL_MODE=mock。若本地模型使用 localhost 或电脑代理地址，应改为云端可访问的供应商 HTTPS 地址。不得将占位说明当作实际配置。构建完成后发布该版本并分配流量。

## 4. 关联小程序与访问权限

确认此云托管环境关联了当前小程序。**关闭服务公网访问入口**，仅允许关联小程序通过微信网关调用；服务器读取网关注入的身份头，不能把这些头当作开放公网接口的身份校验。/whoami 仅返回当前调用人的 OpenID。

小程序 config/api.js 已设置好环境和服务名；app.js 会初始化 wx.cloud。重新编译小程序，在开发者工具控制台执行：

```js
wx.cloud.callContainer({
  config: { env: 'prod-d9ggn765cba2ad61f' },
  path: '/whoami',
  header: { 'X-WX-SERVICE': 'express-ec98' },
  method: 'GET'
}).then(res => console.log(res.data))
```

将返回的 openid 填入云托管环境变量 ALLOWED_OPENIDS 并按控制台提示使新配置生效；多人访问用英文逗号分隔各自 OpenID。空名单默认拒绝资料访问；客户端不能自行指定 OpenID。只允许名单成员访问共享资料库，不提供多租户隔离。

在小程序管理后台的服务器域名设置中，将该 COS 桶的 HTTPS 域名加入 downloadFile 合法域名，如 https://完整桶名.cos.地域.myqcloud.com。不要带路径或签名参数。图片、视频、PPT 原件和页图从 COS 临时签名链接下载，链接有效期 10 分钟，不要分享。视频长时间停留后失败时点「下载到本机后播放」，会重新获取链接。页面和元数据通过 callContainer 请求。

## 5. 验证与日常更新

重新编译小程序，首页应显示材料数；测试一个材料问题，检查回答引用；在资料库打开图片、视频、PPT 页图和原文件。若报 503 先检查环境变量和 COS 权限、索引是否上传；403 检查当前微信账号的 OpenID 白名单；下载失败检查 downloadFile 域名。

资料变动：在电脑 backend/materials 修改 → npm run import → npm run upload:cos。不必重建代码镜像。已有 PPT 页图来自本地 data/previews；新 PPT 未生成页图时仍可查看提取文字。

代码变动：上传 backend 创建新版本 → 构建 → 发布。小程序代码变动：重新编译/上传小程序。模型密钥变动：只更新服务环境变量。原计数器 /api/count 已被本业务 API 替代，不应再用于验证聊天功能。

部署前本机执行 npm test。真实 COS 上传、云托管构建和真机验收需要在你自己的账号配置后完成；本地测试不代表已发布。
