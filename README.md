# Civic Bid Radar · 投标雷达

自托管的采购公告与投标协作工作台。按项目、标段和轮次管理公告及更正，依据原文和企业档案做资格初筛，处理跟进、开标、公司资料、站内提醒和保证金台账。

仓库提供前端和后端整站源码。Linux 和 WSL 可用虚构数据运行演示，实际部署可从空工作区创建管理员和公司。

## 在本机试用

需要 Node.js 24 LTS、npm 和 Linux 文件系统。WSL 请把项目和数据放到发行版的 Linux 文件系统内。以下命令从仓库根目录运行。

~~~sh
npm --prefix runtime/selfhost ci --ignore-scripts
node scripts/init-demo.mjs
BIDDING_RADAR_SELFHOST_DIR="$PWD/demo-data" npm --prefix runtime/selfhost start
~~~

打开 [http://localhost:4201](http://localhost:4201)。登录文件位于 `demo-data/demo-login.json`，其中的演示密码在初始化时随机生成。程序仅监听 loopback。初始化需要空数据目录，再次演示可指定新的目录，并将启动用的数据目录同步调整。

1. 在机会池查看示例公告，并用「按公司档案筛选」选中示例市政公司。
2. 进入公告详情查看资格矩阵和原文，在示例标段选择跟进后去提醒中心查看更正。
3. 把同标段标为不参与后，在提醒中心的「已归档与作废」查看历史。

演示只读取虚构数据，不安装采集计划。AI 和对象存储默认未启用，不需要任何第三方密钥。盐城公开栏目目录随代码提供。实际采集、AI、对象存储和可信反向代理的配置见 [运维部署说明](docs/DEPLOYMENT.md)。

## 项目结构

| 目录 | 内容 |
| --- | --- |
| `runtime/selfhost` | Node.js 服务、SQLite、身份与权限、公告及资格证据处理 |
| `runtime/frontend/dist-selfhost` | 浏览器端 HTML、CSS、JavaScript |
| `ops` | 公告投影导入工具和隔离浏览器检查脚本 |
| `scripts` | 演示初始化与本地冒烟 |
| `docs` | 开源前审查与发布清单 |

## 测试

~~~sh
node scripts/smoke-demo.mjs
npm --prefix runtime/selfhost test
~~~

冒烟使用专用临时数据库和随机回环端口，实际执行启动、跟进、归档和备份恢复。持续集成执行同一套验收命令，详见 [验证记录](docs/VERIFICATION.md)。

## 许可证

本项目在 [Apache-2.0](LICENSE) 许可下发布。第三方依赖和数据来源说明见 [第三方组件与数据](docs/THIRD_PARTY.md)。
