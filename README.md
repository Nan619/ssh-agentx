# SSH AgentX

一款基于 **Tauri 2** 构建的桌面 SSH 终端客户端，集成 AI 运维助手。采用 Rust 后端 + React/TypeScript 前端，提供多标签终端管理、智能命令生成、文件传输等功能。

## 功能特性

- **多标签 SSH 终端** — 基于 xterm.js 的全功能终端模拟器，支持多标签页并行会话
- **AI 运维助手** — 右侧面板集成 LLM 聊天，根据主机信息和终端上下文自动生成 Shell 命令
- **主机管理** — 支持分组、拖拽排序、连接配置（密码/密钥认证）
- **SSH 密钥管理** — 内置密钥管理器，支持导入 PEM 密钥和口令短语
- **SCP 文件传输** — 上传/下载文件，带进度显示
- **技能系统（Skills）** — 为 AI 助手配置自定义技能模板，增强运维能力
- **主题系统** — 支持深色/浅色/跟随系统三种主题
- **多 AI 提供商** — 支持 OpenAI、Anthropic、Ollama、DeepSeek 及自定义 OpenAI 兼容接口
- **交互式认证** — 支持主机密钥验证（TOFU）、密钥口令、kbd-interactive 认证
- **持久化存储** — SQLite 本地数据库保存主机、密钥、模型配置和技能

## 界面布局

采用类 VS Code 的三栏布局：

```
┌──────────┬──────────────────────┬──────────────┐
│ 活动栏    │                      │  AI 助手面板  │
│ (图标)    │   终端编辑区域        │  (LLM 聊天)  │
│          │   (多标签 xterm)      │              │
│──────────│                      │              │
│ 侧边栏    │                      │              │
│ (主机列表) │                      │              │
└──────────┴──────────────────────┴──────────────┘
```

- **活动栏**（最左侧）— 切换侧边栏视图的图标按钮
- **侧边栏** — SSH 主机列表，支持拖拽调整宽度
- **编辑区域**（中央）— 每个 SSH 会话对应一个 xterm.js 终端标签页
- **AI 助手面板**（右侧）— LLM 聊天界面，可折叠，支持拖拽调整宽度

## 技术栈

| 层级 | 技术 |
|------|------|
| 框架 | Tauri 2 |
| 后端 | Rust（russh、tokio、rusqlite） |
| 前端 | React 18 + TypeScript |
| 构建 | Vite 6 |
| 终端 | xterm.js 6（WebGL 渲染） |
| 状态管理 | Zustand |
| 数据库 | SQLite（rusqlite bundled） |
| SSH | russh 0.61（纯 Rust 实现） |
| AI | SSE 流式传输（reqwest） |

## 环境要求

- **Node.js** ≥ 18
- **Rust** stable 工具链
- **Windows**：Visual Studio Build Tools（MSVC）+ Windows SDK

## 开发

### 1. 克隆项目

```bash
git clone <repository-url>
cd ssh-agentx
```

### 2. 安装前端依赖

```bash
npm install
```

### 3. 配置构建环境（仅 Windows）

```bash
source build-env.sh
```

此脚本会设置 Rust 工具链、MSVC 编译器和 Windows SDK 的环境变量。根据实际安装路径修改脚本中的 `MSVC_VER` 和 `SDK_VER`。

### 4. 启动开发服务器

```bash
npm run tauri dev
```

启动后会自动打开应用窗口，前端开发服务器运行在 `localhost:1420`。

### 5. 构建生产版本

```bash
npm run tauri build
```

生成的安装包位于 `src-tauri/target/release/bundle/`。

## 项目结构

```
ssh-agentx/
├── src/                          # 前端源码
│   ├── App.tsx                   # 根布局组件
│   ├── components/
│   │   ├── agent/                # AI 助手面板
│   │   ├── host/                 # 主机管理（编辑器、连接对话框、拖拽）
│   │   ├── layout/               # 布局组件（活动栏、侧边栏、标题栏、状态栏）
│   │   ├── settings/             # 设置对话框（主题、密钥、技能管理）
│   │   ├── ssh/                  # SSH 认证对话框
│   │   ├── terminal/             # 终端视图、右键菜单、传输进度
│   │   └── ui/                   # 通用 UI 组件（对话框、Toast）
│   ├── hooks/                    # React Hooks（主题）
│   ├── lib/                      # 工具库（终端预设）
│   └── stores/                   # Zustand 状态管理
├── src-tauri/                    # Rust 后端
│   ├── src/
│   │   ├── lib.rs                # Tauri 应用初始化与命令注册
│   │   ├── main.rs               # 入口
│   │   ├── state.rs              # AppState — 会话 + 认证等待器
│   │   ├── error.rs              # AppError + i18n 错误系统
│   │   ├── emitter.rs            # Tauri 事件发射器
│   │   ├── agent/                # AI 助手（上下文构建、Provider 抽象）
│   │   ├── commands/             # IPC 命令处理器
│   │   │   ├── ssh.rs            # SSH 连接/断开/输入/agent_exec
│   │   │   ├── host.rs           # 主机/分组/密钥 CRUD
│   │   │   ├── config.rs         # 模型配置管理
│   │   │   ├── agent.rs          # AI 聊天 + 流式响应
│   │   │   ├── scp.rs            # SCP 文件传输
│   │   │   └── skill.rs          # 技能 CRUD
│   │   ├── db/                   # SQLite 数据库（Schema + CRUD）
│   │   └── ssh/                  # SSH 实现（连接、认证、会话、SCP）
│   ├── Cargo.toml
│   └── tauri.conf.json
├── build-env.sh                  # Windows 构建环境配置
├── package.json
└── vite.config.ts
```

## AI 助手工作原理

1. **上下文收集** — 连接 SSH 后自动采集系统信息（`uname`、`hostname`、`uptime`、`df`、`free`）
2. **终端缓冲区** — 维护 8 KiB 滚动缓冲区，捕获最近的终端输出
3. **系统提示构建** — 将主机信息、系统状态和终端上下文注入 AI 系统提示
4. **流式响应** — AI 回复通过 SSE 流式传输到前端，实时渲染 Markdown
5. **命令注入** — AI 生成的命令通过 `agent_exec` 使用哨兵标记注入 PTY，自动捕获执行结果

### 支持的 AI 提供商

| 提供商 | 说明 |
|--------|------|
| OpenAI | GPT 系列模型 |
| Anthropic | Claude 系列模型 |
| Ollama | 本地部署，通过 OpenAI 兼容接口路由 |
| DeepSeek | OpenAI 兼容接口 + 自定义 Base URL |
| 自定义 | 任意 OpenAI 兼容 API |

## 数据存储

应用数据存储在 `{appDataDir}/ssh-agent.db`（SQLite）：

- **hosts** — SSH 连接配置（主机名、端口、认证方式、关联技能等）
- **ssh_keys** — SSH 私钥（PEM 格式 + 可选口令）
- **ssh_groups** — 主机分组
- **model_configs** — AI 模型配置（提供商、模型名、API Key、Base URL）
- **skills** — AI 技能模板（名称、描述、标签、内容）

> **注意**：凭据以明文存储在 SQLite 中，当前未使用操作系统密钥链。

## 许可证

本项目仅供学习和内部使用。
