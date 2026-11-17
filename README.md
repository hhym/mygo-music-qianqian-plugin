# 千千音乐 · MyGo Music 插件

按 [egoist/mygo-music](https://github.com/egoist/mygo-music) 插件规范写的千千音乐（原百度音乐，`music.91q.com`）音源：
一个文件夹、一份 `plugin.json`、一个 `index.js`，无构建、跨平台。

当前版本 **1.0.0**。

> 这一版最大的收获是：千千音乐网页端的接口不需要登录，但**每个请求都要签名**。
> 签名规则下面写全了，照着抄就能直接调。

## 安装

- **本地文件夹**：设置 → 插件 → `+` → 从文件夹安装，选这个目录。
- **zip**：`mygo-music-qianqian-plugin.zip` 同样从 `+` 里装。
- 手动：把整个文件夹放进应用的 `plugins` 目录（设置 → 插件 → `+` → 显示插件文件夹）。

最低应用版本 `0.1.20`（用了 `imageUrl` 的 `{size}` 占位符，让封面按 40 / 600 px 取图）。

## 能做什么

| 能力 | 数据来源 |
| --- | --- |
| 首页：今日歌曲、歌单、新碟、歌手入口 | `api-qianqian.91q.com/v1/index` + `/v1/tracklist/list` |
| 搜索：歌曲 / 专辑 / 歌手，分页 30 条 | `/v1/search?word=…&pageNo=…&pageSize=…` |
| 歌单页：曲目（实测 26 首的整张能取到，`pageSize=50`） | `/v1/tracklist/info?id=…`（纯数字 id） |
| 专辑页：曲目、简介、发行日期、封面（实测 13 首整张都在） | `/v1/album/info?albumAssetCode=P…` |
| 歌手页：资料、歌曲、专辑 | `/v1/artist/info` + `/v1/artist/song` + `/v1/artist/albumlist`（`A…`） |
| 歌词 | `/v1/song/info?TSID=…` 返回 `lyric` 直链，就是标准 `.lrc` |
| 播放 | `/v1/song/tracklink?TSID=…&rate=…` → 直链，**FLAC 免登录可用** |
| 收藏 / 收藏歌单 / 关注歌手 / 最近播放 | 插件自己的 `host.storage` |
| 电台 | 今日歌曲、随机歌单两档“频率” |

### 音质

`/v1/song/tracklink` 的 `rate` 决定格式与码率，`bitrate` 参数会被忽略：

| `rate` | 返回 |
| --- | --- |
| `3000` | FLAC（`format=flac`，`rate` 字段 1714） |
| `320` | MP3 320 kbps |
| `128` | MP3 128 kbps |
| `64` | AAC 64 kbps |

不用账号、不用会员，FLAC 直接给——这是千千音乐现在最实在的地方，所以插件默认取 `3000`。
设置里的 **音质** 只是“降档开关”：选了 320 / 128 就走低码率。

## 关键：请求签名

网页端所有请求都带 `appid`、`timestamp`、`sign`、`from=web`，缺一项就被拒。算法（从 `static1-qianqian.91q.com/client/*.js` 里 `WebEngine` / `createApi` 读出）：

1. 取秒级 `timestamp`；
2. 把业务参数 + `appid=16073360` + `timestamp` + `from=web` 合在一起，**按键名升序**拼成 `k=v&k=v`；
3. 末尾拼密钥 `0b50b02fd0d73a9c4c8c3a781c30845f`，取 md5，得 `sign`；
4. 查询串带上 `appid`、`timestamp`、`sign`、`from=web`。

容易踩的三个坑：

- **`from=web` 必须参与签名**，只放进查询串不签，报 `sign无效`；
- **`appid` 必须同时进签名和查询串**，只进签名报 `缺少appid参数`；
- 唱歌单详情时参数名是 **`id`**，写 `trackListId` / `tracklistId` 会报 `23010 歌单id不能为空:`。

插件里的 `md5()` 是手写的（运行时没有 crypto）。顺手记一个 JS 上的坑：
`bitLen >>> 32` 在 JS 里等于 `bitLen >>> 0`（位移量按 32 取模），长度字段会被写两遍，结果是**空串算得对、非空串全错**。现在长度只写低 32 位 + 四个零字节。

## 数据形态

- 歌曲 id 是 TSID，形如 `T10065400429`；同一个对象的 `id` / `assetId` / `TSID` 三字段同值。纯数字 id 会报 `23001 TSID格式错误`。
- 歌手 `artistCode`：`A10273267`。
- 专辑 `albumAssetCode`：`P10004348672`。
- 歌单 `id`：纯数字，如 `309746`。


## 微信扫码登录能干什么（实测）

网页端可以微信扫码登录（面板里「微信登录」→ `open.weixin.qq.com/connect/qrconnect?appid=wxde1ddeb8ea5bd75a`，scope `snsapi_login`，回调 `music.91q.com/?from=weixin`）。登录后顶部出现头像与「赫赫有鸣」这类昵称，说明会话成立。

但**登录不改变播放**：

- 付费/VIP 歌曲（`pay_model=3`）即使用账号登录、即使降到 `rate=128`，`/v1/song/tracklink` 也**只回 `format`/`rate`、不回 `path`**；只有真会员才给地址。
- 免费歌曲（`pay_model=2` 或字段缺省）不登录一样能给到 FLAC。

所以插件的策略是：把 `pay_model=3` 的曲目直接标成 **不可播放**（应用里会灰掉、点不动），而不是等到点播放才失败。
插件本身也不保存登录态——音源插件是无状态的，装了就用的那份体验就是匿名体验。

另外，扫码回调还踩过一次坑：回调页被重复打开会报 `web_weixin getAccessToken failed, code been used`，微信的 code 只能换一次 token，重登必须重新出二维码。

## 两个限制，别找不存在的接口

- **没有排行榜。** 站点 `/rank`、`/billboard`、`/top`、`/ranklist` 全是 404（2600 字节的空页，没有 `window.__NUXT__`），`/v1/rank/*`、`/v1/billboard/*` 也不存在。千千现在做的是“场景音乐”，所以插件用 `/v1/index` 的今日歌曲 + 歌单列表顶上，不伪造榜单。
- **搜索没有歌单类型，歌单也没有分类筛选。** `/v1/search` 加 `type` / `searchType` / `cate=tracklist` 都无效，返回键固定只有 `displayorder / typeTrack / typeArtist / typeAlbum`；`/v1/tracklist/list` 传 `cateId` / `categoryId` / `tagId` 结果不变。所以搜索只做三类，歌单走独立页面。

## 图片

`img01.dmhmusic.com` 的原图很大（实测单张 987 KB），`?param=` / `?x-oss-process=` / `?w=` 都不生效，只有 **`?imageView2/2/w/{size}`**（七牛风格）能缩：600 px ≈ 25 KB，40 px ≈ 0.6 KB。
插件因此把封面统一改写成 `<原图>?imageView2/2/w/{size}`，由应用填 `{size}`。

## 已试过、确认不存在的路径（省得再试）

`/v1/search/song|track|all|merge|list|songs`、`/v1/artist/tracklist`、`/v1/artist/album`、`/v1/album/tracklist`、`/v1/album/song`、`/v1/tracklist/detail|song|tracklist`、`/v1/rank/*`、`/v1/billboard/*`、`/v1/tag/list`、`/v1/category/list` —— 全部 404。

老百度 / 太合接口也别再试：`music.taihe.com/data/api/search/song` 会 302 到 SSR 网页、`tingapi.ting.baidu.com/v1/restserver/ting` 一律 500、`music.91q.com/v1/restserver/ting` 同样要求签名。

## 错误码

| errno | 含义 |
| --- | --- |
| `22000` | 成功 |
| `22001` | 签名错误：`缺少appid参数` / `sign无效` |
| `23001` | `TSID格式错误` |
| `23010` | `歌单id不能为空:` |

## 文件

```
plugin.json      # id / 版本 / 网络权限 / 音质设置 / 导航
index.js         # 全部导出：搜索、首页、浏览、专辑、歌手、歌单、歌词、播放、本地库、电台
locales/zh-CN.json
```

默认请求头带桌面 Chrome UA 与 `Referer: https://music.91q.com/`，缺 Referer 时接口同样会拒。
