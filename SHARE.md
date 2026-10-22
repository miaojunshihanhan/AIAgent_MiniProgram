# 小程序分享配置

好友分享和朋友圈分享已接入五个页面：AI 聊天、产品介绍、资料库、介绍/主题详情、资料详情。页面右上角菜单会显示分享入口。好友卡片通过 `onShareAppMessage` 返回标题、页面路径和可选图片；朋友圈通过 `onShareTimeline` 返回标题、查询参数和可选图片。朋友圈不能自定义页面路径，因此资料与指南的 query 会带上资料版本/片段或页面章节。

## 配置位置

编辑项目根目录的 `config/share.js`。`pages` 里的 `title`、`imageUrl`、`timelineTitle`、`timelineImageUrl` 分别配置好友标题/封面和朋友圈标题/封面。图片字段留空时微信使用默认图。`defaults` 是全局回退值。

`sections` 以 `about`、`checklist`、`faq`、`contact` 为键；`topics` 以 `config/introduction.js` 里的主题 id（目前 `organize`、`reading`、`review`）为键。留空字段沿用 `pages.information` 设置。标题模板可用 `{title}`，它会替换成当前章节或主题标题。`documents` 可以按资料 ID 或资料完整标题增加独立设置，留空字段沿用 `pages.document` 设置。资料标题默认采用资料库中的真实标题。

标题和图片的配置对象示例：

```js
checklist: {
  title: '我的学习清单',
  imageUrl: 'https://你的公开域名/share/checklist.jpg',
  timelineTitle: '开始整理本周学习计划',
  timelineImageUrl: 'https://你的公开域名/share/checklist-square.jpg'
}
```

## 本地图片与 COS

当前分享封面使用小程序包内的本地 JPG 文件，不需要 COS：

- 聊天、介绍、章节和主题：`pages/index/share-home.jpg`
- 资料库：`pages/index/share-library.jpg`
- 资料详情：`pages/index/share-document.jpg`

微信分享回调可以直接使用小程序代码包内的图片路径。三张压缩图合计约 300 KB。替换图片时保持文件名不变即可；若使用新文件名，记得同步修改 `config/share.js`。

如以后需要在线分享图，仍可选用 COS 上传：

将 JPG/PNG 文件放入 `backend/share-images`，可以按用途命名，例如 `chat.jpg`、`introduction.jpg`、`library.jpg`、`checklist.jpg`、`document.jpg`；脚本也会上传子目录。复用已有的 `backend/.env` 中的 `COS_BUCKET`、`COS_REGION`、`COS_PREFIX` 和 COS 凭据：

```powershell
Set-Location backend
npm run upload:share-images
```

脚本将对象写到现有 COS 前缀下的 `share/`，并打印每张图片的 HTTPS 对象 URL。按用途将 URL 填回 `config/share.js` 对应字段。在线图片需要微信可直接访问的长期 HTTPS 地址；脚本不会更改桶 ACL，也不会打印任何密钥。当前本地封面按约 1.06:1 制作，好友和朋友圈共用。

分享回调和参数格式依据 `onShareAppMessage` / `onShareTimeline` 微信开放文档；`onShareTimeline` 要求基础库 2.11.3 或以上。

## 发布前验证

修改分享配置后需重新编译并上传小程序。请在真机逐页从右上角菜单测试好友和朋友圈，并从分享卡片打开对应内容。聊天分享的是聊天入口，不包含本机聊天记录；清单分享的是清单入口，不携带本机勾选进度。现有 UPLOAD_CHECK 模式切换仍然生效：介绍模式下打开资料分享会回到介绍入口，业务模式下打开介绍分享会回到聊天入口。资料撤销或版本更新后，旧卡片仍按现有版本校验提示失效。
