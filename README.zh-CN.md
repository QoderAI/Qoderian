# Qoderian

[English](README.md) | 中文

一个把 [Qoder CLI](https://qoder.com)（`qodercli`）嵌入 Obsidian 仓库的插件。你的仓库就是智能体的工作目录——文件读写、检索、bash 和多步工作流开箱即用。

![Qoderian 在智能体化的 Obsidian 工作区中](assets/preview.png)

## 功能

- **智能体聊天** — qodercli 以流式方式把回复送回侧栏，并读取、写入、编辑、搜索仓库中的文件。
- **`@` 引用** — 把仓库笔记、当前选区或外部目录加入上下文，显示为可移除标签。
- **Inline Edit** — 就地改写选中的笔记文字，接受前先给出 diff 预览。
- **Slash Commands & Skills** — `/` 打开内置与项目级命令；skills、agents、hooks 与终端共用同一套 Qoder CLI 项目文件。
- **Permission Modes** — 在聊天工具栏选择询问审批、自动审批或完全访问。
- **`#` 指令模式** — 空输入框中编写自定义指令，先润色再应用。
- **`!` Bash 模式** — 在仓库目录运行 shell 命令；需在设置 → 实验性功能中启用。
- **模型与强度** — 模型选择器按模型调节推理强度，并显示 Qoder Agent SDK 上报的上下文用量。
- **MCP Servers** — 通过 Model Context Protocol（stdio、SSE、HTTP）连接外部工具，应用内配置。
- **标签与历史** — 多个聊天标签各自保有历史，支持续接、分叉、回退。
- **Subagents** — 嵌套的智能体运行分组内联渲染。
- **回合摘要** — 完成的回合把执行过程折叠成可展开的「执行步骤」行；编辑过的文件折叠成卡片，点击打开只读的逐文件 diff 弹窗。

## 安装与使用

Qoderian 仅支持桌面端（macOS、Linux、Windows），需要 Obsidian v1.7.2+ 以及已登录的 [Qoder CLI](https://qoder.com)。

### 1. 安装并登录 Qoder CLI

使用官方脚本安装（推荐）：

**macOS / Linux**

```bash
curl -fsSL https://qoder.com/install | bash
```

**Windows — PowerShell**（推荐使用 Windows Terminal）

```powershell
irm https://qoder.com/install.ps1 | iex
```

**Windows — CMD**

```cmd
curl -fsSL https://qoder.com/install.cmd -o install.cmd && install.cmd
```

或通过 npm 安装（需要 Node.js ≥ 20）：

```bash
npm install -g @qoder-ai/qodercli
```

安装程序会把 `qodercli` 加入 PATH；暂不支持 Windows arm64。然后在终端登录：

```bash
qodercli login
```

登录完全由本地 CLI 管理；Qoderian 不会索要 API key。

### 2. 安装插件

**从 Obsidian 社区插件安装（推荐）**

1. 打开 Obsidian → 设置 → 第三方插件 → 浏览
2. 搜索 "Qoderian" 并点击安装
3. 启用插件

**从 GitHub Release 安装**

1. 从 [latest release](../../releases/latest) 下载 `main.js`、`manifest.json`、`styles.css`
2. 在仓库的插件目录下创建 `qoderian` 文件夹：
   ```
   /path/to/vault/.obsidian/plugins/qoderian/
   ```
3. 把下载的文件复制进该文件夹
4. 在 Obsidian 中启用插件：设置 → 第三方插件 → 关闭受限模式 → 启用 "Qoderian"

**从源码安装**

1. 把仓库克隆到仓库的插件目录：
   ```bash
   cd /path/to/vault/.obsidian/plugins
   git clone <repository-url> qoderian
   cd qoderian
   ```
2. 安装依赖并构建：
   ```bash
   npm ci
   npm run build
   ```
   这会在 `manifest.json` 旁边生成 `main.js` 和 `styles.css`，Obsidian 正是从那里加载它们。
3. 在 Obsidian 中启用插件

### 3. 开始使用

从左侧功能区图标或命令面板（`Open Qoderian`）打开聊天侧栏。输入消息后按 **Enter**，qodercli 会以流式方式把回复送回面板，并像终端里的 CLI 一样操作仓库文件。

### 开发

```bash
# 监视模式；改动后自动重新构建
npm run dev

# 生产构建
npm run build

# 检查
npm run typecheck
npm run lint
npm run test
npm run test:coverage
npm run audit:prod
```

把 `.env.local.example` 复制为 `.env.local` 并设置 `OBSIDIAN_VAULT`，开发构建会自动拷贝进本地仓库。

涉及 SDK 或 qodercli 生命周期的改动，请对已登录的本地 CLI 跑只做初始化的冒烟检查。它遵循官方的模型选择示例：

```bash
npm run smoke:qoder
# qodercli 不在 PATH 时可选：
QODER_CLI_PATH=/absolute/path/to/qodercli npm run smoke:qoder
```

冒烟检查会启动一个空闲 Query，读取运行时模型元数据，然后不发送任何用户回合地关闭 Query。

## 设置

打开 **设置 → Qoderian**：

| 分组 | 内容 |
|-------|----------|
| **设置** | Qoder CLI 版本与 `qodercli` 可执行文件路径（默认自动探测） |
| **显示** | Qoderian 打开位置、最大聊天标签数、流式传输时自动滚动、流式传输时延迟渲染数学公式、默认展开文件编辑（语言选择器在该组上方） |
| **对话** | 自动生成对话标题与标题生成模型 |
| **内容** | 用户名、自定义系统提示词、排除的标签、媒体文件夹 |
| **输入** | 需要 Command/Ctrl+Enter 发送与 Vim 风格导航映射 |
| **安全** | 加载用户 Qoder 设置与安全模式权限 |
| **命令与技能 / 子代理 / MCP 服务器 / Qoder CLI 插件** | 查看并编辑存放在 `.qoder/` 下的 Qoder CLI 项目配置 |
| **实验性功能** | Bash 模式（`!`）开关 |

## 隐私与数据使用

- **发送到 Qoder**：你的输入、附件笔记与图片、工具结果会通过 `qodercli` 发送到 Qoder 服务。这些数据的处理方式受 Qoder 的服务条款与隐私政策约束。
- **本地存储**：Qoderian 的设置与会话元数据存放在 `vault/.qoderian/`；Qoder CLI 的项目文件、命令、skills、agents 与 MCP 配置存放在 `vault/.qoder/`；原生转录由 qodercli 自行管理。Obsidian 会把打开的标签布局保存在 `.obsidian/plugins/qoderian/data.json`。
- **凭据**：Qoderian 从不捆绑、生成或索要 Qoder API key——登录由本地 `qodercli` 管理，也绝不会被复制进仓库。密钥可能出现在存于 `.qoder/mcp.json` 的第三方 MCP 配置中；切勿把该文件提交或同步到不可信的地方。
- **环境变量**：qodercli 子进程继承 Obsidian 的进程环境。Qoderian 不会在仓库中持久化环境变量覆盖。
- **文件与 shell 访问**：取决于权限模式与确认，qodercli 可能读取、创建、修改、删除文件并运行 shell 命令。启用 `YOLO` 前请了解风险，并为重要仓库保留备份或版本控制。
- **仓库之外的触达**：外部上下文与 MCP 服务器可能按各自服务的规则访问仓库之外的文件或第三方网络服务。
- **后台活动**：Qoderian 自身不跑任何遥测。网络活动仅限于 qodercli 和你配置的 MCP 端点。

提交 issue 前请打码设置、日志与截图。

## 故障排查

### qodercli not found

如果看到 `spawn qodercli ENOENT`，说明插件没能自动探测到你的安装。这在使用 Node 版本管理器（nvm、fnm、volta）时很常见，因为 Obsidian 这类 GUI 应用不会继承 shell 的 PATH。

先保持 CLI path 为空，让自动探测跑一遍。若仍失败，找到路径并在 **设置 → CLI path** 中填入：

| 平台 | 命令 | 示例路径 |
|----------|---------|--------------|
| macOS / Linux | `which qodercli` | `/Users/you/.local/bin/qodercli` |
| Windows | `where.exe qodercli` | `C:\Users\you\AppData\Local\qodercli\qodercli.exe` |
| npm 安装 | `npm root -g` | `{root}\@qoder-ai\qodercli\cli.js` |

Windows 上优先使用原生可执行文件，而不是 `.cmd` 或 `.ps1` 包装器。

### CLI 与 Node.js 不在同一目录

如果 CLI 是通过 npm 安装的，检查 `qodercli` 与 `node` 是否解析到同一位置：

```bash
dirname $(which qodercli)
dirname $(which node)
```

若两者不同，Obsidian 可能找得到 CLI 却找不到它需要的 Node.js 运行时。优先使用原生 qodercli 二进制，或把 Node.js 安装到桌面应用可见的标准位置，然后重启 Obsidian。

### 进程退出码 42

通常意味着参数不兼容。Qoderian 会把 SDK 提供的参数过滤并转换成 qodercli 兼容的形式；如果仍然出现，请附上错误日志开 issue。

### 启用插件后没有任何反应

1. 确认 Obsidian 为 1.7.2 或更高版本
2. 确认受限模式已关闭（设置 → 第三方插件）
3. 重启 Obsidian
4. 打开开发者控制台（`Ctrl+Shift+I` / `Cmd+Option+I`）检查报错

## 架构

```
src/
├── main.ts                   # 插件入口
├── app/                      # 插件生命周期、设置、Obsidian 层存储
├── core/                     # 稳定的应用领域、运行时契约、宿主工具
│   ├── runtime/                 # ChatRuntime 边界与回合契约
│   └── ...                      # 会话类型、设置、文件系统、上下文、markdown 解析
├── qoder/                    # qodercli 与 Qoder Agent SDK 集成
│   ├── qoder-services.ts         # Qoder 服务组合根
│   ├── qoder-host-context.ts     # 窄宿主契约；不依赖 main.ts
│   ├── runtime/                 # 会话、消息通道、CLI 探测、审批、进程适配
│   ├── stream/                  # SDK 消息类型与流转换
│   ├── history/                 # 原生转录读取、续接、分叉
│   ├── tools/ mcp/               # Qoder 工具词汇表与 SDK MCP 选项适配
│   ├── services/                # 冷启动服务：内联编辑、润色、标题
│   ├── models/ config/          # 模型目录与 Qoder 设置
│   └── storage/                 # 命令、skills、agents、插件、MCP 配置
├── features/
│   ├── chat/                    # 侧栏聊天：标签、控制器、渲染器
│   ├── inline-edit/             # 内联编辑弹窗与预览
│   └── settings/                # 设置外壳与 CLI 设置 UI（agents、插件、命令）
├── shared/                   # 可复用 UI 组件与弹窗
├── i18n/                     # 国际化（10 种语言）
└── style/                    # 模块化 CSS
```

Qoderian 通过锁定的 `@qoder-ai/qoder-agent-sdk@1.0.16` 驱动 qodercli；`custom-spawn.ts` 只处理 Obsidian/Electron 的进程兼容。Qoder 是唯一的集成对象，因此没有 provider 注册表、能力矩阵或路由层。依赖规则与 SDK 生命周期约定见 [ARCHITECTURE.md](ARCHITECTURE.md)，遵循 [官方 TypeScript 示例](https://github.com/QoderAI/qoder-agent-sdk-samples/tree/main/typescript)。

## 发布

```bash
# 升版本号（同步 package.json、两个 manifest 与 versions.json）
npm version patch   # 1.0.0 → 1.0.1

# 验证构建产物
npm run build
npm run release:check

# 推送 tag 触发发布工作流
git push --follow-tags
```

`.npmrc` 把 npm 的 tag 前缀设为空，因此 `1.0.1` 的 tag 与 `manifest.json` 完全一致。工作流从源码构建，并把 `main.js`、`manifest.json`、`styles.css` 附到 GitHub Release。

## 致谢

- [Obsidian](https://obsidian.md) — 强大的知识库
- [qodercli](https://qoder.com) — AI 编程助手
- [Claudian](https://github.com/YishenTu/claudian) — Qoderian 起步于这个 MIT 许可的项目；感谢其作者与贡献者打下的基础

## 贡献

欢迎 issue 和聚焦的 pull request。开 pull request 前请先阅读 [贡献指南](CONTRIBUTING.md)，并按 [SECURITY.md](SECURITY.md) 私下报告安全问题。

## 许可证

Qoderian 源码以 [MIT License](LICENSE) 许可。Qoder Agent SDK 与 Qoder 服务的使用受 [Qoder Product Service Terms](https://qoder.com/product-service) 约束。第三方与上游署名见 [NOTICE](NOTICE)。
