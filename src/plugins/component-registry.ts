/**
 * 组件注册表
 * 管理所有可视化组件的按需加载
 */

import type { ComponentRegistryItem } from '../core/types/directive';

// 组件注册表类型
type ComponentMap = Map<string, ComponentRegistryItem>;

// 全局组件注册表
const registry: ComponentMap = new Map();

// 插件初始化状态
let initializationPromise: Promise<void> | null = null;
let isInitialized = false;

// 当前由外部插件注册的指令名（用于热重载时清理）
const externalNames = new Set<string>();

// 插件变更通知（热重载）
let pluginChangeVersion = 0;
const pluginChangeListeners = new Set<() => void>();
let watcherInitialized = false;
let rescanTimer: number | null = null;
let rescanInProgress = false;
let rescanPromise: Promise<void> | null = null;

/**
 * 订阅插件变更（新增/删除/修改）。返回取消订阅函数。
 */
export function subscribePluginChanges(listener: () => void): () => void {
  pluginChangeListeners.add(listener);
  return () => {
    pluginChangeListeners.delete(listener);
  };
}

/**
 * 获取当前插件版本号，可用于 useEffect 依赖。
 */
export function getPluginChangeVersion(): number {
  return pluginChangeVersion;
}

function notifyPluginChanges(): void {
  pluginChangeVersion += 1;
  pluginChangeListeners.forEach((listener) => {
    try {
      listener();
    } catch (err) {
      console.error('[Plugin] change listener failed:', err);
    }
  });
}

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
function registerExternalPlugin(name: string, path: string, config: any): void {
  if (registry.has(name) && !externalNames.has(name)) {
    console.warn(`[Registry] Directive "${name}" from plugin at ${path} conflicts with an existing component; keeping the earlier registration.`);
    return;
  }
  if (externalNames.has(name)) {
    console.warn(`[Registry] Duplicate external directive "${name}"; overwriting with plugin from ${path}.`);
  }
  // 注册一个占位组件项
  registry.set(name, {
    name,
    loader: () => import('../components/ExternalPluginLoader').then(m => m.createExternalPluginLoader(path, config)),
    description: config.meta?.description || '外部插件',
    category: 'external',
  });
  externalNames.add(name);
  console.log(`[Registry] Registered external plugin: ${name}`);
}

/**
 * 获取组件加载器
 */
function getComponentLoader(name: string) {
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
function detectDirectives(content: string): string[] {
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
 * 从磁盘扫描并注册外部插件
 */
async function loadExternalPluginsFromDisk(): Promise<void> {
  if (typeof window === 'undefined') {
    return;
  }

  const { invoke } = await import('@tauri-apps/api/core');
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
}

/**
 * 初始化外部插件（从插件目录加载）
 */
export async function initializeExternalPlugins(): Promise<void> {
  if (isInitialized) {
    return;
  }
  if (initializationPromise) {
    return initializationPromise;
  }

  initializationPromise = (async () => {
    console.log('[Plugin] Initializing external plugins...');
    try {
      await loadExternalPluginsFromDisk();
    } catch (err) {
      console.error('[Plugin] Failed to load external plugins:', err);
    }
    isInitialized = true;
    console.log('[Plugin] Initialization complete. Registered components:', Array.from(registry.keys()));
  })();

  return initializationPromise;
}

/**
 * 重新扫描插件目录（热重载）：清理旧的插件注册后重新加载，并通知订阅者。
 * 扫描失败时保留旧注册，避免一次磁盘抖动清空所有插件。
 */
export async function rescanExternalPlugins(): Promise<void> {
  if (rescanInProgress) {
    return rescanPromise ?? Promise.resolve();
  }
  rescanInProgress = true;
  rescanPromise = (async () => {
    try {
      const snapshot = new Map<string, ComponentRegistryItem>();
      for (const name of externalNames) {
        const item = registry.get(name);
        if (item) snapshot.set(name, item);
      }
      for (const name of externalNames) {
        registry.delete(name);
      }
      externalNames.clear();
      try {
        await loadExternalPluginsFromDisk();
      } catch (err) {
        console.error('[Plugin] Rescan failed, restoring previous registrations:', err);
        for (const [name, item] of snapshot) {
          if (!registry.has(name)) registry.set(name, item);
          externalNames.add(name);
        }
      }
      isInitialized = true;
      console.log('[Plugin] Rescan complete. Registered components:', Array.from(registry.keys()));
      notifyPluginChanges();
    } finally {
      rescanInProgress = false;
      rescanPromise = null;
    }
  })();
  return rescanPromise;
}

/**
 * 监听插件目录变化，自动重新扫描并通知订阅者（插件热重载）。
 */
export async function setupPluginWatcher(): Promise<void> {
  if (watcherInitialized || typeof window === 'undefined') {
    return;
  }
  watcherInitialized = true;

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const { listen } = await import('@tauri-apps/api/event');

    await listen('external-plugin-changed', () => {
      // 文件保存通常会触发多次事件，这里去抖动
      if (rescanTimer !== null) {
        window.clearTimeout(rescanTimer);
      }
      rescanTimer = window.setTimeout(() => {
        rescanTimer = null;
        void rescanExternalPlugins();
      }, 300);
    });

    await invoke('watch_plugin_dirs');
    console.log('[Plugin] Plugin directory watcher enabled');
  } catch (err) {
    watcherInitialized = false;
    console.error('[Plugin] Failed to setup plugin watcher:', err);
  }
}

// ============================================
// 内置组件
// ============================================
// 所有可视化组件现已改为「外部插件」，从插件目录（plugins/）动态加载。
// 如需内置组件，可在此调用 registerComponents([...]) 注册。

