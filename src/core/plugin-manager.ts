/**
 * EditLite 插件管理器
 *
 * 负责加载、管理和执行用户自定义插件
 */

import type {
  Plugin,
  PluginConfig,
  PluginRegistryItem,
  PluginEventListener,
  PluginEvent,
  DirectiveHandler,
} from './types/plugin';

/**
 * 插件管理器单例
 */
class PluginManager {
  private plugins: Map<string, PluginRegistryItem> = new Map();
  private listeners: PluginEventListener[] = [];
  private pluginDirectory: string = '';

  /**
   * 初始化插件系统
   */
  async initialize(pluginDir?: string): Promise<void> {
    // 获取插件目录路径
    this.pluginDirectory = pluginDir || await this.getDefaultPluginDirectory();

    // 扫描并加载插件
    await this.scanPlugins();
  }

  /**
 * 获取默认插件目录
   */
  private async getDefaultPluginDirectory(): Promise<string> {
    // 在 Tauri 中，插件目录位于应用目录下的 plugins 文件夹
    // Windows: %APPDATA%/edit_lite/plugins
    // macOS: ~/Library/Application Support/edit_lite/plugins
    // Linux: ~/.config/edit_lite/plugins

    if (typeof window !== 'undefined' && (window as any).__TAURI__) {
      const { appDataDir } = await import('@tauri-apps/api/path');
      const appDir = await appDataDir();
      return `${appDir}plugins`;
    }

    // 开发模式下使用本地目录
    return './plugins';
  }

  /**
   * 扫描插件目录
   */
  async scanPlugins(): Promise<void> {
    try {
      // 通过 Tauri 后端读取插件目录
      const entries = await this.readPluginDirectory();

      for (const entry of entries) {
        if (entry.isDirectory) {
          await this.loadPlugin(entry.name);
        }
      }
    } catch (error) {
      console.warn('Plugin scan failed:', error);
    }
  }

  /**
   * 读取插件目录
   */
  private async readPluginDirectory(): Promise<{ name: string; isDirectory: boolean }[]> {
    if (typeof window !== 'undefined' && (window as any).__TAURI__) {
      try {
        const { readDir } = await import('@tauri-apps/plugin-fs');
        const entries = await readDir(this.pluginDirectory);
        return entries.map(entry => ({
          name: entry.name,
          isDirectory: !entry.isFile,
        }));
      } catch {
        return [];
      }
    }
    return [];
  }

  /**
   * 加载单个插件
   */
  async loadPlugin(pluginName: string): Promise<boolean> {
    const pluginPath = `${this.pluginDirectory}/${pluginName}`;

    try {
      // 读取 plugin.json 配置
      const config = await this.readPluginConfig(pluginPath);

      if (!config) {
        this.emitEvent({
          type: 'plugin:error',
          pluginId: pluginName,
          error: 'plugin.json not found',
        });
        return false;
      }

      // 验证配置
      if (!this.validateConfig(config)) {
        this.emitEvent({
          type: 'plugin:error',
          pluginId: pluginName,
          error: 'Invalid plugin.json format',
        });
        return false;
      }

      // 创建插件实例
      const plugin = await this.createPluginInstance(pluginPath, config);

      if (plugin) {
        // 初始化插件
        if (plugin.init) {
          await plugin.init();
        }

        // 注册插件
        this.plugins.set(config.meta.id, {
          plugin,
          path: pluginPath,
          loadedAt: new Date(),
          enabled: true,
        });

        this.emitEvent({
          type: 'plugin:loaded',
          pluginId: config.meta.id,
        });

        return true;
      }

      return false;
    } catch (error) {
      this.emitEvent({
        type: 'plugin:error',
        pluginId: pluginName,
        error: String(error),
      });
      return false;
    }
  }

  /**
   * 读取插件配置
   */
  private async readPluginConfig(pluginPath: string): Promise<PluginConfig | null> {
    if (typeof window !== 'undefined' && (window as any).__TAURI__) {
      try {
        const { readTextFile } = await import('@tauri-apps/plugin-fs');
        const content = await readTextFile(`${pluginPath}/plugin.json`);
        return JSON.parse(content);
      } catch {
        return null;
      }
    }
    return null;
  }

  /**
   * 验证插件配置
   */
  private validateConfig(config: any): config is PluginConfig {
    return (
      config &&
      typeof config === 'object' &&
      config.meta &&
      typeof config.meta.id === 'string' &&
      typeof config.meta.name === 'string' &&
      typeof config.meta.version === 'string' &&
      Array.isArray(config.meta.directives) &&
      typeof config.main === 'string'
    );
  }

  /**
   * 创建插件实例
   */
  private async createPluginInstance(
    pluginPath: string,
    config: PluginConfig
  ): Promise<Plugin | null> {
    try {
      // 读取插件主文件
      const mainContent = await this.readPluginFile(`${pluginPath}/${config.main}`);

      if (!mainContent) {
        return null;
      }

      // 解析插件代码
      const pluginModule = this.parsePluginCode(mainContent);

      if (pluginModule && typeof pluginModule.createPlugin === 'function') {
        return pluginModule.createPlugin(config);
      }

      return null;
    } catch (error) {
      console.error('Failed to create plugin instance:', error);
      return null;
    }
  }

  /**
   * 读取插件文件
   */
  private async readPluginFile(filePath: string): Promise<string | null> {
    if (typeof window !== 'undefined' && (window as any).__TAURI__) {
      try {
        const { readTextFile } = await import('@tauri-apps/plugin-fs');
        return await readTextFile(filePath);
      } catch {
        return null;
      }
    }
    return null;
  }

  /**
   * 解析插件代码（使用 Function 构造器在沙箱中执行）
   */
  private parsePluginCode(code: string): any {
    try {
      // 注意：此方法主要用于外部插件的初始解析
      // 实际执行在 iframe 沙箱中进行
      // 创建一个简单的沙箱环境
      const sandbox = {
        console,
        module: { exports: {} },
        exports: {},
      };

      // 使用 Function 构造器执行代码
      const fn = new Function(
        'console',
        'module',
        'exports',
        code
      );

      fn(sandbox.console, sandbox.module, sandbox.exports);

      return sandbox.module.exports || sandbox.exports;
    } catch (error) {
      console.error('Failed to parse plugin code:', error);
      return null;
    }
  }

  /**
   * 卸载插件
   */
  async unloadPlugin(pluginId: string): Promise<void> {
    const item = this.plugins.get(pluginId);

    if (item) {
      if (item.plugin.destroy) {
        await item.plugin.destroy();
      }

      this.plugins.delete(pluginId);

      this.emitEvent({
        type: 'plugin:unloaded',
        pluginId,
      });
    }
  }

  /**
   * 启用插件
   */
  enablePlugin(pluginId: string): void {
    const item = this.plugins.get(pluginId);
    if (item) {
      item.enabled = true;
      this.emitEvent({
        type: 'plugin:enabled',
        pluginId,
      });
    }
  }

  /**
   * 禁用插件
   */
  disablePlugin(pluginId: string): void {
    const item = this.plugins.get(pluginId);
    if (item) {
      item.enabled = false;
      this.emitEvent({
        type: 'plugin:disabled',
        pluginId,
      });
    }
  }

  /**
   * 获取所有已注册的指令处理器
   */
  getDirectiveHandlers(): Map<string, DirectiveHandler> {
    const handlers = new Map<string, DirectiveHandler>();

    for (const [, item] of this.plugins) {
      if (!item.enabled) continue;

      const pluginHandlers = item.plugin.getHandlers();
      for (const handler of pluginHandlers) {
        handlers.set(handler.name, handler);
      }
    }

    return handlers;
  }

  /**
   * 获取所有插件信息
   */
  getPlugins(): PluginRegistryItem[] {
    return Array.from(this.plugins.values());
  }

  /**
   * 获取插件目录路径
   */
  getPluginDirectory(): string {
    return this.pluginDirectory;
  }

  /**
   * 添加事件监听器
   */
  addEventListener(listener: PluginEventListener): void {
    this.listeners.push(listener);
  }

  /**
   * 移除事件监听器
   */
  removeEventListener(listener: PluginEventListener): void {
    const index = this.listeners.indexOf(listener);
    if (index > -1) {
      this.listeners.splice(index, 1);
    }
  }

  /**
   * 发送事件
   */
  private emitEvent(event: PluginEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

// 导出单例
export const pluginManager = new PluginManager();

// 导出类型
export type { Plugin, PluginConfig, DirectiveHandler };