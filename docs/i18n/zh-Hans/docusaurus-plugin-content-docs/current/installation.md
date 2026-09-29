---
sidebar_position: 2
---

# 安装

Qoderian 仅支持桌面端（macOS、Linux、Windows），需要 Obsidian v1.7.2+ 以及已登录的 [Qoder CLI](https://qoder.com)。

## 1. 安装并登录 Qoder CLI

使用官方脚本安装（推荐）：

**macOS / Linux**

```bash
curl -fsSL https://qoder.com/install | bash
```

**Windows — PowerShell**（推荐使用 Windows Terminal）

```powershell
irm https://qoder.com/install.ps1 | iex
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

## 2. 安装插件

### 从 Obsidian 社区插件安装（推荐）

1. 打开 Obsidian → 设置 → 第三方插件 → 浏览
2. 搜索 "Qoderian" 并点击安装
3. 启用插件

### 从 GitHub Release 安装

1. 从[最新 release](https://github.com/QoderAI/qoderian/releases/latest) 下载 `main.js`、`manifest.json`、`styles.css`
2. 在仓库的插件目录下创建 `qoderian` 文件夹：
   ```
   /path/to/vault/.obsidian/plugins/qoderian/
   ```
3. 把下载的文件复制进该文件夹
4. 在 Obsidian 中启用插件：设置 → 第三方插件 → 关闭受限模式 → 启用 "Qoderian"

### 从源码安装

1. 把仓库克隆到仓库的插件目录：
   ```bash
   cd /path/to/vault/.obsidian/plugins
   git clone https://github.com/QoderAI/qoderian.git qoderian
   cd qoderian
   ```
2. 安装依赖并构建：
   ```bash
   npm ci
   npm run build
   ```
   这会在 `manifest.json` 旁边生成 `main.js` 和 `styles.css`，Obsidian 正是从那里加载它们。
3. 在 Obsidian 中启用插件

## 3. 开始使用

从左侧功能区图标或命令面板（`Open Qoderian`）打开聊天侧栏。输入消息后按 **Enter**，qodercli 会以流式方式把回复送回面板，并像终端里的 CLI 一样操作仓库文件。
