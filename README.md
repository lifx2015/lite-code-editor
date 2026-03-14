# EditLite

一款基于 Tauri 构建的轻量级文本编辑器，专注于简洁与高效。
![EditLite 截图](./screenshot.png)
## 功能特性

### 编辑功能
- **多标签编辑** - 同时编辑多个文件，支持新建、关闭标签
- **语法支持** - Markdown、JavaScript、JSON、纯文本
- **矩形选择** - 支持块选择编辑模式
- **JSON 格式化** - 一键格式化 JSON 文件

### 文件操作
- **多文件打开** - 支持同时打开多个文件
- **自动编码检测** - 支持 UTF-8、GBK、Shift_JIS、EUC-KR、Windows-1252
- **编码转换保存** - 可选择目标编码保存文件
- **文件关联** - 支持通过系统关联打开文件

### Markdown 预览
- **编辑模式** - 纯编辑视图
- **分屏模式** - 左侧编辑，右侧实时预览
- **预览模式** - 纯预览视图
- **GitHub 风格 Markdown** - 支持 GFM 扩展语法（表格、任务列表等）

### 界面定制
- **字体选择** - 多种等宽字体、中文字体可选
- **字号调整** - 支持 12-24pt 字号，滚轮缩放 (Ctrl+滚轮)
- **状态栏** - 显示文件路径、编码、行列位置、缩放比例

### 快捷键
| 快捷键 | 功能 |
|--------|------|
| Ctrl+N | 新建文件 |
| Ctrl+S | 保存文件 |
| Ctrl+滚轮 | 缩放字体 |

## 技术栈

- **前端**: React 19 + TypeScript + Vite 7
- **后端**: Tauri 2 + Rust
- **编辑器**: CodeMirror 6
- **Markdown**: react-markdown + remark-gfm

## 开发

### 环境要求

- Node.js 18+
- Rust 1.70+
- pnpm / npm / yarn

### 安装依赖

```bash
npm install
```

### 开发模式

```bash
npm run tauri dev
```

### 构建发布

```bash
npm run tauri build
```

生成的安装包位于 `src-tauri/target/release/bundle/` 目录。

## 项目结构

```
edit_lite/
├── src/                    # 前端源码
│   ├── App.tsx             # 主应用组件
│   ├── App.css             # 样式文件
│   └── main.tsx            # 入口文件
├── src-tauri/              # Tauri 后端
│   ├── src/
│   │   ├── main.rs         # 入口
│   │   └── lib.rs          # 核心逻辑
│   ├── Cargo.toml          # Rust 依赖
│   └── tauri.conf.json     # Tauri 配置
├── package.json
└── README.md
```

## 支持的文件类型

| 扩展名 | 说明 |
|--------|------|
| .txt | 纯文本 |
| .md | Markdown |
| .js | JavaScript |
| .ts | TypeScript |
| .json | JSON |
| .html | HTML |
| .css | CSS |
| .rs | Rust |
| .py | Python |

## 开发计划

- [x] 支持 Markdown 语法
- [x] 支持 JavaScript 语法
- [x] 支持 JSON 语法
- [x] 支持矩形选择
- [x] 自定义字体设置
- [x] 查找替换功能
- [ ] 支持更多语法高亮
- [ ] 深色主题
- [ ] 自动保存


## 许可证

MIT License