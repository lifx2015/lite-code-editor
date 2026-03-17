/**
 * EditLite 插件系统类型定义
 *
 * 用户可以通过实现这些接口来创建自定义可视化组件
 */

/**
 * 插件元信息
 */
export interface PluginMeta {
  /** 插件唯一标识符 */
  id: string;
  /** 插件名称 */
  name: string;
  /** 插件版本 */
  version: string;
  /** 插件作者 */
  author?: string;
  /** 插件描述 */
  description?: string;
  /** 支持的指令列表 */
  directives: DirectiveDefinition[];
}

/**
 * 指令定义
 */
export interface DirectiveDefinition {
  /** 指令名称（如 'sort', 'search'） */
  name: string;
  /** 参数定义 */
  params: ParamDefinition[];
  /** 指令描述 */
  description?: string;
  /** 使用示例 */
  examples?: string[];
}

/**
 * 参数定义
 */
export interface ParamDefinition {
  /** 参数名 */
  name: string;
  /** 参数类型 */
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  /** 是否必填 */
  required?: boolean;
  /** 默认值 */
  default?: any;
  /** 参数描述 */
  description?: string;
}

/**
 * 可视化状态
 */
export interface VisualizationState {
  status: 'idle' | 'playing' | 'paused' | 'completed';
  currentStep?: number;
  totalSteps?: number;
  message?: string;
  data?: any;
}

/**
 * 可视化组件 Props
 */
export interface VisualizerProps<T = Record<string, any>> {
  /** 指令参数 */
  args: T;
  /** 状态变化回调 */
  onStateChange?: (state: VisualizationState) => void;
  /** 错误回调 */
  onError?: (error: Error) => void;
}

/**
 * 可视化组件类型
 */
export type VisualizerComponent<T = Record<string, any>> =
  React.ComponentType<VisualizerProps<T>>;

/**
 * 指令处理器
 */
export interface DirectiveHandler<T = Record<string, any>> {
  /** 指令名称 */
  name: string;
  /** React 组件 */
  component: VisualizerComponent<T>;
  /** 参数默认值 */
  defaultArgs?: Partial<T>;
  /** 参数验证函数 */
  validate?: (args: T) => boolean | string;
}

/**
 * 插件接口
 */
export interface Plugin {
  /** 插件元信息 */
  meta: PluginMeta;
  /** 初始化函数（可选） */
  init?: () => Promise<void> | void;
  /** 销毁函数（可选） */
  destroy?: () => Promise<void> | void;
  /** 获取指令处理器 */
  getHandlers: () => DirectiveHandler[];
}

/**
 * 插件配置文件格式 (plugin.json)
 */
export interface PluginConfig {
  /** 插件元信息 */
  meta: PluginMeta;
  /** 入口文件路径（相对于插件目录） */
  main: string;
  /** 样式文件路径（可选） */
  style?: string;
  /** 依赖的其他插件 */
  dependencies?: string[];
}

/**
 * 插件加载结果
 */
export interface PluginLoadResult {
  success: boolean;
  plugin?: Plugin;
  error?: string;
}

/**
 * 插件注册表项
 */
export interface PluginRegistryItem {
  /** 插件实例 */
  plugin: Plugin;
  /** 插件路径 */
  path: string;
  /** 加载时间 */
  loadedAt: Date;
  /** 是否启用 */
  enabled: boolean;
}

/**
 * 插件系统事件
 */
export type PluginEvent =
  | { type: 'plugin:loaded'; pluginId: string }
  | { type: 'plugin:unloaded'; pluginId: string }
  | { type: 'plugin:error'; pluginId: string; error: string }
  | { type: 'plugin:enabled'; pluginId: string }
  | { type: 'plugin:disabled'; pluginId: string };

/**
 * 插件系统事件监听器
 */
export type PluginEventListener = (event: PluginEvent) => void;