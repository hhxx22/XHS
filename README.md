# Excel文件处理系统

这是一个用于处理Excel文件并调用Coze API的Web应用系统。系统支持多种数据处理功能，包括获取微信信息和KOL数据分析等。

## 系统概述

本系统是一个基于Node.js的Web应用，用于上传和处理Excel文件，通过调用Coze API进行数据处理和分析。系统采用分块处理策略，支持多用户并发操作，并通过WebSocket提供实时处理进度反馈。

## 功能特点

- **文件处理**
  - 支持Excel文件（.xlsx和.xls格式）的上传和处理
  - 自动将Excel数据分割成1000条记录的块，实现高效处理
  - 并行处理数据，使用多个Coze工作流提高处理速度
  - 实时显示处理进度和结果

- **多功能模块**
  - 微信信息获取功能 - 通过ID和起始页获取微信相关信息
  - KOL数据分析 - 上传KOL数据进行分析和处理
  - 支持添加额外链接参数，扩展处理能力

- **系统特性**
  - 支持多用户同时使用，互不干扰
  - 自动限制并发处理任务数量，防止系统过载
  - WebSocket实时通信，提供处理状态反馈
  - 错误处理和恢复机制，保证系统稳定性
  - 自动Cookie管理和更新功能

## 系统架构

- **前端**：HTML5, CSS3, JavaScript (原生)
- **后端**：Node.js, Express
- **通信**：RESTful API, WebSocket
- **数据处理**：xlsx库用于Excel处理, Coze API用于数据分析
- **并发控制**：任务队列和工作流池

## 安装步骤

1. 确保已安装Node.js（建议版本 >= 14）

2. 克隆仓库或下载源代码：
```bash
git clone https://github.com/hhxx22/XHS.git
```

3. 安装依赖：
```bash
npm install
```

4. 配置Coze API：
   在 `server.js` 文件中，修改以下配置：
   - `COZE_WORKFLOWS` 数组：填入您的Coze工作流URL（建议至少10个）
   - `COOKIES` 数组：填入对应的Cookie值
   - 可选：根据需要修改`PORT`和其他系统参数

5. 启动服务器：
```bash
npm start
```

服务器将在 http://localhost:3000 启动

## 使用说明

### Excel文件处理（主页）

1. 打开浏览器访问 http://localhost:3000
2. 将Excel文件拖放到上传区域，或点击"选择文件"按钮
3. 可选：填写"额外链接"字段提供附加参数
4. 系统会自动开始处理文件，并在页面上实时显示进度
5. 处理完成后，可以查看每个数据块的处理结果

### 微信信息获取

1. 访问 http://localhost:3000/wechat.html
2. 填写必要字段：
   - ID: 需要获取信息的目标ID
   - 起始页: 数据抓取的起始页码
   - 链接（选填）: 可提供额外的链接参数
3. 点击"提交"按钮，系统会处理请求并显示结果

### KOL数据分析

1. 访问 http://localhost:3000/kol.html
2. 上传KOL数据Excel文件
3. 可选：提供KOL链接作为附加参数
4. 系统会处理上传的数据并显示分析结果

## API参考

系统提供以下主要API端点：

- `POST /upload` - 上传并处理Excel文件
- `POST /wechat` - 处理微信信息获取请求
- `POST /update-cookies` - 更新系统使用的Cookies
- `GET /api/config` - 获取当前系统配置
- `POST /api/config` - 更新系统配置参数

WebSocket端点:
- `/status` - 提供实时处理状态更新

## 注意事项

- Excel文件必须是.xlsx或.xls格式
- 每个分割后的数据块包含1000条记录
- 系统最多同时处理20个分割后的数据块
- 每个Cookie只会被一个工作流使用
- 确保网络连接稳定，以保证与Coze API的通信
- 定期更新Cookies以确保API调用正常

## 故障排除

如果遇到以下问题，请尝试相应的解决方案：

1. **文件上传失败**
   - 检查文件格式是否为.xlsx或.xls
   - 确保文件大小未超过系统限制（10MB）
   - 尝试刷新页面后重新上传

2. **处理卡在某个阶段**
   - 检查网络连接是否稳定
   - 查看浏览器控制台是否有错误信息
   - 点击页面上的"更新Cookies"按钮
   - 尝试重新上传文件

3. **API调用失败**
   - 检查Coze工作流URL是否有效
   - 确认Cookies是否过期，需要更新
   - 查看服务器日志获取详细错误信息

4. **页面显示问题**
   - 尝试使用不同的浏览器（推荐Chrome或Firefox）
   - 清除浏览器缓存后重新加载页面
   - 确保JavaScript已启用

## 未来计划

- 添加用户认证系统
- 支持更多文件格式
- 增加数据可视化功能
- 优化并发处理机制
- 添加历史记录查询功能

## 贡献指南

欢迎提交问题报告和功能建议。如果您想贡献代码，请遵循以下步骤：

1. Fork本仓库
2. 创建您的特性分支 (`git checkout -b feature/amazing-feature`)
3. 提交您的更改 (`git commit -m 'Add some amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 打开Pull Request

## 许可证

本项目采用 [MIT 许可证](LICENSE)。

## 联系方式

如有任何问题或建议，请联系[您的联系方式]。 
