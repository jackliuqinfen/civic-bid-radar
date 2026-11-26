# 运维部署

使用 Linux、Node.js 24 LTS 与 npm。默认应用监听本机回环，通过可信 HTTPS 反向代理暴露给同一组织的授权成员。原始公告、公司资料和财务记录按实例管理。

## 初始化空实例

~~~sh
npm --prefix runtime/selfhost ci --ignore-scripts
node scripts/init-demo.mjs "$PWD/demo-data"
BIDDING_RADAR_SELFHOST_DIR="$PWD/demo-data" npm --prefix runtime/selfhost start
~~~

首次接触系统可先用上述演示方式。部署自己的实例时，使用 `node scripts/init-demo.mjs "$PWD/local-data" --empty` 创建空工作区和管理员。密码从本机权限为 0600 的 `demo-login.json` 读取。首次登录之后在账户菜单修改密码。数据目录权限为 0700，数据库权限为 0600。

## 对外入口

- 配置反向代理把 HTTPS 请求转发到 `127.0.0.1:4201`，设置 `BIDDING_RADAR_SELFHOST_ORIGIN` 为实际 HTTPS origin，并且为实例使用独立域名。应用层会校验写入请求的 Origin。认证限速以应用连接端的地址计数，使用代理时在代理侧额外执行逐客户端限速。
- 建议按组织网络、VPN 或身份网关限制访问。使用专用系统账号和独立数据目录，部署副本不共享密钥、对象目录或数据库。
- 从「账号与授权管理」为成员发放公司权限。财务负责人需能查看参投公司，只有任务经办人可以确认付款记录。保证金模块记录流程和回执，资金的实际划转在外部财务流程执行。

## 按需启用外部集成

| 环境变量 | 用途 |
| --- | --- |
| `CIVIC_RADAR_ENABLE_COLLECTION=1` | 允许管理员在网页启用采集与探测。选择明确开放的栏目，并控制频率。 |
| `CIVIC_RADAR_PUBLIC_HOSTS` | 逗号分隔的审批域名，用于后端公告网页预览和公开附件下载。必须精确匹配 HTTPS 域名，跟随重定向需要在浏览器打开原站。 |
| `CIVIC_RADAR_ENABLE_AI=1` | 启用可选公告解读。设置 `TOKENHUB_BASE_URL`、`TOKENHUB_DEFAULT_MODEL`、`TOKENHUB_API_KEY` 或在管理员设置中配置兼容服务。模型结果是阅读辅助。 |
| `CIVIC_RADAR_ENABLE_DOCUMENT_AI=1` | 独立开启外部模型处理证件提取。启用前确认装载的数据及处理环境均获授权。 |
| `CIVIC_RADAR_COS_BUCKET`、`CIVIC_RADAR_COS_REGION` | 启用自己的对象存储桶。还需显式配置 `TOUBIAO_COS_SECRET_ID`、`TOUBIAO_COS_SECRET_KEY`，可用 `CIVIC_RADAR_COS_PREFIX` 为实例划独立前缀。 |

~~~~sh
python3 -m venv .venv
.venv/bin/pip install -r requirements-collector.txt
BIDDING_DB_PATH="$PWD/local-data/workspace.db" BIDDING_SOURCE_PYTHON="$PWD/.venv/bin/python" \
  node runtime/selfhost/custom-source-runner.mjs --install-yancheng
~~~~

安装公开目录后，由管理员选择启用的来源。用同样环境逐个试运行 `--source=<栏目 key>`。独立老采集宿主和其私有调度配置另行接入，本仓库带有通用采集及投影导入器。处理扫描 PDF 可在本机配置 Poppler、Tesseract 中文包和合适的 OCR 引擎。应用程序启动和常规演示无需这些依赖。

## 备份、恢复和升级

~~~sh
mkdir -m 700 backups
node runtime/selfhost/backup.mjs "$PWD/local-data" "$PWD/backups/workspace-001.db"
~~~

备份使用 SQLite 一致性快照，并执行 `integrity_check`。将备份复制到新的 0700 目录并命名为 `workspace.db`，保持 0600 权限，然后用原部署配置和替换后的目录启动隔离实例执行冒烟。对象存储启用时，另按对象版本策略备份持久化附件。升级前固定 Git 版本、备份数据库并维护受控的回滚点。
