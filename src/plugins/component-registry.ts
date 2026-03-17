/**
 * 组件注册表
 * 管理所有可视化组件的按需加载
 */

import type { ComponentRegistryItem } from '../core/types/directive';

// 组件注册表类型
type ComponentMap = Map<string, ComponentRegistryItem>;

// 全局组件注册表
const registry: ComponentMap = new Map();

// 外部插件注册表（从插件目录加载）
const externalPlugins: Map<string, { path: string; config: any }> = new Map();

// 插件初始化状态
let initializationPromise: Promise<void> | null = null;
let isInitialized = false;

/**
 * 注册可视化组件
 */
export function registerComponent(item: ComponentRegistryItem): void {
  if (registry.has(item.name)) {
    console.warn(`Component "${item.name}" is already registered. Overwriting.`);
  }
  registry.set(item.name, item);
  console.log(`[Registry] Registered component: ${item.name}`);
}

/**
 * 批量注册组件
 */
export function registerComponents(items: ComponentRegistryItem[]): void {
  items.forEach(registerComponent);
}

/**
 * 注册外部插件
 */
export function registerExternalPlugin(name: string, path: string, config: any): void {
  externalPlugins.set(name, { path, config });

  // 同时注册一个占位组件项
  registry.set(name, {
    name,
    loader: () => import('../components/ExternalPluginLoader').then(m => m.createExternalPluginLoader(path, config)),
    description: config.meta?.description || '外部插件',
    category: 'external',
  });
  console.log(`[Registry] Registered external plugin: ${name}`);
}

/**
 * 检查是否为外部插件
 */
export function isExternalPlugin(name: string): boolean {
  return externalPlugins.has(name);
}

/**
 * 获取外部插件信息
 */
export function getExternalPluginInfo(name: string): { path: string; config: any } | undefined {
  return externalPlugins.get(name);
}

/**
 * 获取所有外部插件
 */
export function getExternalPlugins(): Map<string, { path: string; config: any }> {
  return new Map(externalPlugins);
}

/**
 * 获取组件加载器
 */
export function getComponentLoader(name: string) {
  const item = registry.get(name);
  if (!item) {
    return null;
  }
  return item.loader;
}

/**
 * 获取组件信息
 */
export function getComponentInfo(name: string): ComponentRegistryItem | undefined {
  return registry.get(name);
}

/**
 * 获取所有已注册的组件名称
 */
export function getRegisteredComponents(): string[] {
  return Array.from(registry.keys());
}

/**
 * 按类别获取组件
 */
export function getComponentsByCategory(
  category: ComponentRegistryItem['category']
): ComponentRegistryItem[] {
  return Array.from(registry.values()).filter(
    (item) => item.category === category
  );
}

/**
 * 动态加载组件
 */
export async function loadComponent(name: string) {
  // 确保插件已初始化
  if (!isInitialized) {
    console.log(`[Registry] Auto-initializing plugins for component: ${name}`);
    await initializeExternalPlugins();
  } else if (initializationPromise) {
    await initializationPromise;
  }

  const loader = getComponentLoader(name);
  if (!loader) {
    console.error(`[Registry] Component "${name}" not found. Available:`, Array.from(registry.keys()));
    throw new Error(`Component "${name}" not found in registry`);
  }

  try {
    const module = await loader();
    return module.default;
  } catch (error) {
    console.error(`Failed to load component "${name}":`, error);
    throw error;
  }
}

/**
 * 检测内容中是否包含特定指令
 */
export function detectDirectives(content: string): string[] {
  const directives: Set<string> = new Set();

  // 匹配 :directive{...} 语法
  const colonDirectiveRegex = /:([a-zA-Z][a-zA-Z0-9]*)\s*\{/g;
  let match;
  while ((match = colonDirectiveRegex.exec(content)) !== null) {
    directives.add(match[1]);
  }

  // 匹配 ^directive{...} 语法
  const caretDirectiveRegex = /\^([a-zA-Z][a-zA-Z0-9]*)\s*[\({]/g;
  while ((match = caretDirectiveRegex.exec(content)) !== null) {
    directives.add(match[1]);
  }

  // 匹配 ```algorithm directive 语法
  const codeBlockRegex = /```algorithm\s+([a-zA-Z][a-zA-Z0-9]*)/g;
  while ((match = codeBlockRegex.exec(content)) !== null) {
    directives.add(match[1]);
  }

  return Array.from(directives);
}

/**
 * 预加载检测到的组件
 */
export async function preloadDetectedComponents(content: string): Promise<void> {
  const directives = detectDirectives(content);
  await Promise.all(
    directives.map((name) => {
      if (registry.has(name)) {
        return loadComponent(name).catch(() => {
          // 静默失败，组件可能在渲染时才会真正需要
        });
      }
      return Promise.resolve();
    })
  );
}

/**
 * 初始化外部插件（从插件目录加载）
 */
export async function initializeExternalPlugins(): Promise<void> {
  // 立即输出日志（在任何检查之前）
  console.log('[Plugin] ===== initializeExternalPlugins called =====');

  // 如果已经初始化或正在初始化，返回现有的 Promise
  if (isInitialized) {
    console.log('[Plugin] Already initialized');
    return;
  }
  if (initializationPromise) {
    console.log('[Plugin] Waiting for existing initialization');
    return initializationPromise;
  }

  initializationPromise = (async () => {
    console.log('[Plugin] Starting initialization...');
    console.log('[Plugin] typeof window:', typeof window);

    if (typeof window === 'undefined') {
      console.log('[Plugin] window is undefined');
      isInitialized = true;
      return;
    }

    try {
      console.log('[Plugin] Importing Tauri modules...');
      const { invoke } = await import('@tauri-apps/api/core');
      console.log('[Plugin] Tauri modules imported successfully');

      console.log('[Plugin] Calling list_external_plugins...');
      const plugins: Array<{ path: string; config: any }> = await invoke('list_external_plugins');
      console.log('[Plugin] External plugins from Rust:', plugins.map((plugin) => plugin.path));

      for (const plugin of plugins) {
        const config = plugin.config;
        const pluginPath = plugin.path;
        console.log(`[Plugin] Found plugin at ${pluginPath}: ${config.meta?.id || 'unknown'}`);

        if (config.meta?.directives && Array.isArray(config.meta.directives)) {
          for (const directive of config.meta.directives) {
            registerExternalPlugin(directive.name, pluginPath, config);
          }
        } else {
          console.warn(`[Plugin] Invalid directives in plugin: ${pluginPath}`);
        }
      }
    } catch (err) {
      console.error('[Plugin] Failed to initialize:', err);
    }
    isInitialized = true;
    console.log('[Plugin] Initialization complete. Registered components:', Array.from(registry.keys()));
  })();

  return initializationPromise;
}

// ============================================
// 注册内置组件
// ============================================

registerComponents([
  {
    name: 'sort',
    loader: () => import('../visualizers/algorithms/SortVisualizer'),
    description: '排序算法可视化',
    category: 'algorithm',
  },
]);
