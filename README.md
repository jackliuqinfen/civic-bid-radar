# Civic Bid Radar · 投标雷达

自托管的公开采购公告雷达。按项目、标段和轮次查看公告及更正，依据公告原文和企业档案做资格初筛，并管理站内提醒。

当前为开源候选预览。仓库可用虚构数据在 Linux 或 WSL 本机运行。正式开源许可和面向公网的部署验收仍在准备中。

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

演示只读取虚构数据，不安装采集计划。AI 和对象存储默认未启用，不需要任何第三方密钥。盐城公开栏目目录随代码提供，可供维护者审核后配置。采集适配模块使用 Python、Requests、Beautiful Soup 和 lxml。对象存储、真实采集和生产部署的公开支持状态见审查清单。

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

冒烟使用专用临时数据库和随机回环端口，自动初始化、启动、检查和关闭。完整回归单独报告已有资格差异，详见 [开源准备审查](docs/OPEN_SOURCE_READINESS.md)。

## 许可证

候选版等待权利人确认项目许可。第三方依赖保留各自的许可，直接依赖和再分发范围见 [第三方依赖](docs/THIRD_PARTY.md)。
