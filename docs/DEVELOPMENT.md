# EditLite 增强型预览开发手册

本文档介绍 EditLite 增强型预览功能的使用方法和开发指南。

## 目录

- [功能概述](#功能概述)
- [指令语法规范](#指令语法规范)
- [已实现组件](#已实现组件)
- [开发新组件](#开发新组件)
- [外部插件系统](#外部插件系统)
- [未来计划](#未来计划)

---

## 功能概述

EditLite 内置了**增强型预览引擎**，支持在 Markdown 中使用特殊指令来渲染交互式可视化组件。

### 启用方式

1. 在 Markdown 文件中输入指令
2. 切换到**分屏模式**或**预览模式**
3. 点击预览区上方的 **"增强"** 按钮

---

## 指令语法规范

### 基本语法

```
:directiveName{param1=value1, param2=value2, ...}
```

### 参数格式

| 类型 | 示例 | 说明 |
|------|------|------|
| 数组 | `[1, 2, 3, 4, 5]` | JSON 格式的数字数组 |
| 字符串 | `"bubble"` | 双引号包裹 |
| 数字 | `300` | 直接写数字 |
| 布尔值 | `true` / `false` | 直接写布尔值 |

### 完整示例

```markdown
:sort{array=[64, 34, 25, 12, 22, 11, 90], algorithm="bubble", speed=400}
```

---

## 已实现组件

### 1. 排序可视化 (`:sort`)

展示排序算法的执行过程，支持动画控制。

#### 语法

```markdown
:sort{array=[...], algorithm="...", speed=...}
```

#### 参数

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `array` | `number[]` | `[5, 2, 8, 1, 9]` | 待排序的数字数组 |
| `algorithm` | `string` | `"bubble"` | 排序算法类型 |
| `speed` | `number` | `300` | 动画速度（毫秒） |
| `showSteps` | `boolean` | `true` | 是否显示步骤描述 |

#### 支持的排序算法

| 算法 | 值 | 时间复杂度 | 说明 |
|------|-----|-----------|------|
| 冒泡排序 | `bubble` | O(n²) | 相邻元素两两比较交换 |
| 快速排序 | `quick` | O(n log n) | 分治法，选择基准值分区 |
| 归并排序 | `merge` | O(n log n) | 分治法，递归合并有序子数组 |
| 插入排序 | `insertion` | O(n²) | 逐个插入到已排序序列 |
| 选择排序 | `selection` | O(n²) | 每轮选择最小元素 |

#### 使用示例

```markdown
# 排序算法演示

## 冒泡排序
:sort{array=[64, 34, 25, 12, 22, 11, 90], algorithm="bubble", speed=400}

## 快速排序
:sort{array=[9, 7, 5, 11, 12, 2, 14, 3, 10, 6], algorithm="quick", speed=300}

## 归并排序
:sort{array=[38, 27, 43, 3, 9, 82, 10], algorithm="merge", speed=500}

## 插入排序
:sort{array=[5, 2, 4, 6, 1, 3], algorithm="insertion", speed=400}

## 选择排序
:sort{array=[29, 10, 14, 37, 13], algorithm="selection", speed=400}
```

#### 动画控制

- **▶ 播放** - 开始动画
- **⏸ 暂停** - 暂停动画
- **⏭ 单步** - 执行下一步
- **↺ 重置** - 重置到初始状态

#### 颜色说明

| 颜色 | 状态 |
|------|------|
| 蓝色 | 默认状态 |
| 黄色 | 正在比较 |
| 红色 | 正在交换 |
| 绿色 | 已排序完成 |

---

## 开发新组件

### 文件结构

```
src/
├── core/types/directive.ts      # 类型定义
├── plugins/component-registry.ts # 组件注册表
├── components/PreviewEngine/     # 预览引擎
└── visualizers/                  # 可视化组件
    └── algorithms/
        └── SortVisualizer.tsx
```

### 步骤 1：定义类型

在 `src/core/types/directive.ts` 中添加新组件的配置类型：

```typescript
interface YourComponentConfig {
  param1: string;
  param2: number;
  // ...
}
```

### 步骤 2：创建组件

在 `src/visualizers/` 下创建新组件：

```tsx
// src/visualizers/yourCategory/YourVisualizer.tsx
import React from 'react';
import type { VisualizerProps } from '../../core/types/directive';

interface YourConfig {
  param1: string;
  param2: number;
}

const YourVisualizer: React.FC<VisualizerProps<YourConfig>> = ({ args, onStateChange }) => {
  const { param1 = 'default', param2 = 100 } = args || {};

  return (
    <div className="your-visualizer">
      {/* 您的可视化内容 */}
    </div>
  );
};

export default YourVisualizer;
```

### 步骤 3：注册组件

在 `src/plugins/component-registry.ts` 中注册：

```typescript
registerComponents([
  // ... 已有组件
  {
    name: 'yourDirective',  // 指令名称
    loader: () => import('../visualizers/yourCategory/YourVisualizer'),
    description: '您的可视化组件描述',
    category: 'algorithm',  // 或 'math', '3d', 'physics'
  },
]);
```

### 步骤 4：添加样式

在 `src/App.css` 中添加组件样式：

```css
.your-visualizer {
  padding: 16px;
  background: var(--bg-secondary);
  border-radius: 8px;
  /* ... 更多样式 */
}
```

### 组件 Props 接口

```typescript
interface VisualizerProps<T = DirectiveConfig> {
  args: T;                                    // 指令参数
  onStateChange?: (state: VisualizationState) => void;  // 状态变化回调
  onError?: (error: Error) => void;          // 错误回调
}

interface VisualizationState {
  status: 'idle' | 'playing' | 'paused' | 'completed';
  currentStep?: number;
  totalSteps?: number;
  message?: string;
}
```

---

## 外部插件系统

EditLite 支持用户开发自定义插件，放置在插件目录中，无需重新打包应用。

### 插件目录位置

应用会在以下位置自动扫描并加载插件：

| 操作系统 | 路径 |
|---------|------|
| Windows | `%APPDATA%\edit_lite\plugins\` |
| macOS | `~/Library/Application Support/edit_lite/plugins/` |
| Linux | `~/.config/edit_lite/plugins/` |

### 插件目录结构

```
plugins/
└── my-plugin/              # 插件目录名（自定义）
    ├── plugin.json         # 插件配置文件（必需）
    ├── index.html          # 插件主文件
    └── style.css           # 样式文件（可选）
```

### plugin.json 配置文件

```json
{
  "meta": {
    "id": "my-plugin",
    "name": "我的插件",
    "version": "1.0.0",
    "author": "您的名字",
    "description": "插件功能描述",
    "directives": [
      {
        "name": "counter",
        "description": "显示一个计数器",
        "params": [
          {
            "name": "initialValue",
            "type": "number",
            "required": false,
            "default": 0,
            "description": "初始值"
          },
          {
            "name": "step",
            "type": "number",
            "required": false,
            "default": 1,
            "description": "每次增减的步长"
          }
        ],
        "examples": [
          ":counter{initialValue=10, step=5}"
        ]
      }
    ]
  },
  "main": "index.html",
  "style": "style.css"
}
```

### 插件 HTML 模板

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <style>
    /* 您的样式 */
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      padding: 20px;
      overflow: hidden;  /* 隐藏滚动条，避免双滚动条问题 */
    }
  </style>
</head>
<body>
  <div id="app"></div>

  <script>
    // ============================================
    // PluginRuntime - EditLite 提供的运行时 API
    // ============================================

    // 获取当前指令名称
    console.log(PluginRuntime.directiveName);

    // 获取用户传入的参数
    console.log(PluginRuntime.args);

    // 获取合并了默认值的参数
    const args = PluginRuntime.getResolvedArgs();

    // 更新状态（通知父窗口）
    PluginRuntime.updateState({
      status: 'playing',
      currentStep: 1,
      totalSteps: 10,
      message: '正在执行...'
    });

    // 报告错误
    PluginRuntime.reportError('出错了！');

    // ============================================
    // 参数更新回调
    // 当用户修改 Markdown 中的参数时触发
    // ============================================
    window.onArgsUpdate = function(newArgs) {
      console.log('参数已更新:', newArgs);
      // 重新渲染您的组件
    };

    // ============================================
    // 您的插件逻辑
    // ============================================

    const app = document.getElementById('app');
    app.innerHTML = `
      <div class="my-component">
        <h2>参数值: ${args.initialValue}</h2>
      </div>
    `;
  </script>
</body>
</html>
```

### PluginRuntime API

| 方法/属性 | 说明 |
|----------|------|
| `directiveName` | 当前指令名称 |
| `args` | 用户传入的参数 |
| `config` | 插件配置信息 |
| `getParamDefs()` | 获取参数定义列表 |
| `getDefaults()` | 获取参数默认值 |
| `getResolvedArgs()` | 获取合并后的参数（默认值 + 用户参数） |
| `updateState(state)` | 更新可视化状态 |
| `reportError(message)` | 报告错误 |

### 插件样式建议

为确保插件在 iframe 中正确显示，建议遵循以下样式规范：

1. **隐藏滚动条**：在 `body` 或 `html` 上设置 `overflow: hidden`，避免出现双滚动条
2. **避免使用 min-height**：插件高度会自动适应内容，无需手动设置最小高度
3. **使用固定内容高度**：如果内容高度固定，确保容器高度与内容匹配

```css
/* 推荐的基础样式 */
html, body {
  overflow: hidden;  /* 隐藏滚动条 */
  margin: 0;
  padding: 0;
}

body {
  /* 您的样式 */
  padding: 20px;
}
```

### 示例插件：计数器

```markdown
:counter{initialValue=10, step=5}
```

创建 `plugins/example-counter/` 目录，包含以下文件：

**plugin.json**
```json
{
  "meta": {
    "id": "example-counter",
    "name": "计数器示例",
    "version": "1.0.0",
    "directives": [
      {
        "name": "counter",
        "params": [
          { "name": "initialValue", "type": "number", "default": 0 },
          { "name": "step", "type": "number", "default": 1 },
          { "name": "min", "type": "number", "default": -100 },
          { "name": "max", "type": "number", "default": 100 }
        ]
      }
    ]
  },
  "main": "index.html"
}
```

**index.html** - 完整示例见 [plugins/example-counter/](../plugins/example-counter/)

### 开发流程

1. **创建插件目录**：在插件目录下创建新的文件夹
2. **编写配置文件**：创建 `plugin.json` 定义指令和参数
3. **开发组件**：创建 `index.html` 实现可视化逻辑
4. **测试**：重启 EditLite，在 Markdown 中使用指令测试
5. **发布**：打包插件目录分享给其他用户

### 安全性

- 插件在 iframe 沙箱中运行，与主应用隔离
- 仅支持 `allow-scripts` 权限
- 无法访问主应用的 DOM 或 JavaScript 上下文
- 通过 `postMessage` 与主应用通信

---

## 未来计划

### Phase 2: 查找算法可视化

```markdown
:search{array=[1, 3, 5, 7, 9, 11, 13], target=7, algorithm="binary"}
```

支持的算法：
- 二分查找 (`binary`)
- 线性查找 (`linear`)
- 哈希查找 (`hash`)

### Phase 3: 图论算法可视化

```markdown
:graph{
  nodes=[{id:"A"}, {id:"B"}, {id:"C"}],
  edges=[{from:"A", to:"B"}, {from:"B", to:"C"}],
  algorithm="dijkstra"
}
```

支持的算法：
- Dijkstra 最短路径
- BFS/DFS 遍历
- 拓扑排序

### Phase 4: LaTeX 公式支持

```markdown
$E = mc^2$

$$\int_{-\infty}^{\infty} e^{-x^2} dx = \sqrt{\pi}$$
```

### Phase 5: 3D 可视化

```markdown
^earth{rotation=30, zoom=1.5, lat=39.9, lng=116.4}
```

功能：
- 3D 地球渲染
- 经纬度标记
- 轨迹绘制

### Phase 6: 物理模拟

```markdown
:physics{objects=[{type:"ball", x:0, y:0, vx:10, vy:0}]}
```

功能：
- 粒子系统
- 刚体碰撞
- 重力模拟

---

## 技术架构

```
┌─────────────────────────────────────────────────────────────┐
│                    Markdown 内容                             │
│            :sort{array=[5,2,8,1], algorithm="bubble"}       │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                   PreviewEngine                              │
│              (增强模式检测指令)                               │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                  Component Registry                          │
│              (按需加载对应组件)                               │
└─────────────────────────┬───────────────────────────────────┘
                          │
              ┌───────────┴───────────┐
              │                       │
              ▼                       ▼
┌─────────────────────┐   ┌─────────────────────┐
│   内置组件           │   │   外部插件          │
│  (SortVisualizer)   │   │  (iframe 沙箱)      │
└─────────────────────┘   └─────────────────────┘
```

## 性能优化

- **按需加载**：可视化组件仅在检测到指令时才加载
- **代码分割**：每个组件打包为独立的 chunk
- **懒加载**：React.lazy + Suspense 实现组件级懒加载
- **内存清理**：组件卸载时自动清理资源
- **沙箱隔离**：外部插件在 iframe 中运行，不影响主应用性能

---

## 贡献指南

欢迎贡献新的可视化组件！

1. Fork 项目
2. 创建功能分支 (`git checkout -b feature/new-visualizer`)
3. 按照[开发新组件](#开发新组件)步骤开发
4. 提交 Pull Request

---

## 许可证

MIT License