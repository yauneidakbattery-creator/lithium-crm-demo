# 锂电池CRM

GitHub Pages 上的静态 CRM 前端。

- `index.html`：公开演示，使用示例资料。
- `live.html`：Google 表格同步入口。只有持有目标表格访问权限的 Google 账号授权后，才会读取或修改真实资料。
- `live.js`：读取“客户开发”页 A:AW 共 49 列，按客户编号选择和编辑；只写回改动的单元格，保存前检查原行和被修改字段是否发生冲突。可新增客户行。

## 配置 Google 登录

1. 在 Google Cloud 项目中启用 **Google Sheets API**。
2. 配置 OAuth 同意屏幕，按需要加入测试用户。
3. 创建 **Web application** 类型的 OAuth 客户端；将 `https://yauneidakbattery-creator.github.io` 添加到 **Authorized JavaScript origins**。
4. 已配置 Google OAuth 网页客户端 ID。打开 `live.html`，用有权访问原表格的 Google 账号授权。若要更换客户端 ID，可在页面的“连接配置”中修改。

客户端 ID 是公开标识，可以保存在浏览器本地；OAuth 访问令牌只保存在当前页面内存。不要将客户端密钥、服务账号密钥或个人访问令牌提交到仓库。

## 当前边界

Google 表格的共享设置决定谁能读写数据。界面上展示的老板、业务员和分区仍是演示内容，不能阻止拥有表格权限的人直接查看或编辑其他客户。正式的角色和客户归属隔离需要服务端校验与独立用户管理。

如果表格列标题或顺序发生变化，同步会停止，以免写错列。访问令牌过期后需要重新授权；页面刷新后也需重新连接。
