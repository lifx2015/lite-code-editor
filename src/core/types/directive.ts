/**
 * 指令类型定义
 * 支持语法: :sort{...} / ^earth{...} / ```algorithm sort
 */

export interface SourcePosition {
  line: number;
  column: number;
  start: number;
  end: number;
}

export interface DirectiveConfig {
  // 通用参数
  id?: string;
  width?: number | string;
  height?: number | string;

  // 算法参数
  array?: number[];
  algorithm?: string; // 改为通用字符串类型
  speed?: number; // 动画速度 (ms)
  showSteps?: boolean;
  target?: number; // 查找目标

  // 3D 参数
  rotation?: number;
  zoom?: number;
  lat?: number;
  lng?: number;

  // 图论参数
  nodes?: Array<{ id: string; label?: string }>;
  edges?: Array<{ from: string; to: string; weight?: number }>;
  startNode?: string;

  // 图表参数
  title?: string;
  data?: unknown;
  labels?: string[];
  showGrid?: boolean;
  showDots?: boolean;
}

export interface Directive {
  type: DirectiveType;
  args: DirectiveConfig;
  raw?: string; // 原始文本
  position?: SourcePosition;
  children?: Directive[]; // 用于嵌套内容
}

export type DirectiveType =
  | 'sort'
  | 'search'
  | 'graph'
  | 'earth'
  | 'latex'
  | 'physics'
  | string; // 允许扩展

/**
 * 可视化组件 Props
 */
export interface VisualizerProps<T extends DirectiveConfig = DirectiveConfig> {
  args: T;
  onStateChange?: (state: VisualizationState) => void;
  onError?: (error: Error) => void;
}

export interface VisualizationState {
  status: 'idle' | 'playing' | 'paused' | 'completed';
  currentStep?: number;
  totalSteps?: number;
  message?: string;
}

/**
 * 组件注册表项
 */
export interface ComponentRegistryItem {
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  loader: () => Promise<{ default: React.ComponentType<any> }>;
  description?: string;
  category?: 'algorithm' | 'math' | '3d' | 'physics' | 'external' | 'diagram';
}