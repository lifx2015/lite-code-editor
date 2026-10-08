/**
 * 外部插件加载器
 *
 * 用于加载插件目录中的用户自定义组件
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import type { VisualizationState } from '../../core/types/directive';
import { subscribePluginChanges, getPluginChangeVersion } from '../../plugins/component-registry';

interface ExternalPluginProps {
  pluginPath: string;
  config: any;
  directiveName: string;
  args: Record<string, any>;
  onStateChange?: (state: VisualizationState) => void;
  onError?: (error: Error) => void;
}

/**
 * 外部插件组件
 */
const ExternalPlugin: React.FC<ExternalPluginProps> = ({
  pluginPath,
  config,
  directiveName,
  args,
  onStateChange,
  onError,
}) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [htmlContent, setHtmlContent] = useState<string>('');
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    typeof document !== 'undefined' &&
    document.documentElement.getAttribute('data-theme') === 'dark'
      ? 'dark'
      : 'light'
  );
  const [reloadVersion, setReloadVersion] = useState(() => getPluginChangeVersion());

  // 插件目录变化时重新读取插件文件（热重载）
  useEffect(
    () => subscribePluginChanges(() => setReloadVersion(getPluginChangeVersion())),
    []
  );

  // 跟随宿主应用主题变化
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      setTheme(root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');
    });
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  // 通知 iframe 主题变化
  useEffect(() => {
    if (iframeRef.current?.contentWindow && htmlContent) {
      iframeRef.current.contentWindow.postMessage(
        { type: 'plugin:theme', theme },
        '*'
      );
    }
  }, [theme, htmlContent]);

  // 加载插件 HTML 文件
  useEffect(() => {
    async function loadPluginHtml() {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const mainFile = config.main || 'index.html';
        const content = await invoke<string>('read_external_plugin_file', {
          pluginPath,
          fileName: mainFile,
        });
        setError(null);
        setHtmlContent(content);
      } catch (err) {
        const isTauriRuntime = typeof window !== 'undefined'
          && (!!(window as any).__TAURI_INTERNALS__ || !!(window as any).__TAURI__);

        if (!isTauriRuntime) {
          setHtmlContent(generateDevPlaceholder(config, directiveName, args));
        } else {
          setError(`无法加载插件文件: ${err}`);
          onError?.(new Error(`Failed to load plugin: ${err}`));
        }
      }
      setLoading(false);
    }

    loadPluginHtml();
  }, [pluginPath, config, directiveName, args, onError, reloadVersion]);

  // 处理来自 iframe 的消息
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) {
        return;
      }

      const { type, data } = event.data || {};

      switch (type) {
        case 'plugin:ready':
          setLoading(false);
          break;

        case 'plugin:error':
          setError(data?.message || 'Unknown error');
          onError?.(new Error(data?.message || 'Unknown error'));
          break;

        case 'plugin:stateChange':
          onStateChange?.(data);
          break;

        case 'plugin:resize':
          // 处理 iframe 内容高度变化
          if (data?.height && iframeRef.current) {
            iframeRef.current.style.height = `${data.height}px`;
          }
          break;
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onStateChange, onError]);

  // 向 iframe 发送参数
  useEffect(() => {
    if (!loading && iframeRef.current?.contentWindow && htmlContent) {
      iframeRef.current.contentWindow.postMessage({
        type: 'plugin:updateArgs',
        directiveName,
        args,
      }, '*');
    }
  }, [loading, directiveName, args, htmlContent]);

  // 注入运行时脚本到 HTML
  const injectedHtml = useCallback(() => {
    if (!htmlContent) return '';

    // 隐藏滚动条的样式
    const hideScrollbarStyles = `
<style>
  html, body { overflow: hidden; }
  ::-webkit-scrollbar { display: none; }
  html { -ms-overflow-style: none; scrollbar-width: none; }
</style>`;

    // 注入 PluginRuntime
    const runtimeScript = `
<script>
  // lite-code-editor Plugin Runtime
  document.documentElement.setAttribute('data-theme', ${JSON.stringify(theme)});

  window.PluginRuntime = {
    directiveName: ${JSON.stringify(directiveName).replace(/</g, '\\u003c')},
    args: ${JSON.stringify(args).replace(/</g, '\\u003c')},
    config: ${JSON.stringify(config).replace(/</g, '\\u003c')},
    theme: ${JSON.stringify(theme)},

    updateState(state) {
      window.parent.postMessage({
        type: 'plugin:stateChange',
        data: state
      }, '*');
    },

    reportError(message) {
      window.parent.postMessage({
        type: 'plugin:error',
        data: { message }
      }, '*');
    },

    getParamDefs() {
      const directive = this.config.meta?.directives?.find(d => d.name === this.directiveName);
      return Array.isArray(directive?.params) ? directive.params : [];
    },

    getDefaults() {
      const params = this.getParamDefs();
      const defaults = {};
      for (const param of params) {
        if (param.default !== undefined) {
          defaults[param.name] = param.default;
        }
      }
      return defaults;
    },

    getResolvedArgs() {
      return { ...this.getDefaults(), ...this.args };
    }
  };

  // 参数更新回调
  window.onArgsUpdate = null;

  window.addEventListener('message', (event) => {
    if (event.source !== window.parent) return;
    const { type, args: newArgs, directiveName, theme: newTheme } = event.data || {};
    if (type === 'plugin:updateArgs') {
      PluginRuntime.args = newArgs;
      PluginRuntime.directiveName = directiveName;
      if (typeof window.onArgsUpdate === 'function') {
        window.onArgsUpdate(newArgs);
      }
    } else if (type === 'plugin:theme') {
      PluginRuntime.theme = newTheme;
      document.documentElement.setAttribute('data-theme', newTheme);
      if (typeof window.onThemeChange === 'function') {
        window.onThemeChange(newTheme);
      }
    }
  });

  // 通知父窗口插件已准备好
  window.parent.postMessage({ type: 'plugin:ready' }, '*');

  // 自动高度调整
  function reportHeight() {
    const height = document.documentElement.scrollHeight || document.body.scrollHeight;
    window.parent.postMessage({
      type: 'plugin:resize',
      data: { height }
    }, '*');
  }

  function startHeightWatch() {
    reportHeight();
    if (typeof ResizeObserver !== 'undefined') {
      const resizeObserver = new ResizeObserver(() => reportHeight());
      resizeObserver.observe(document.body);
      resizeObserver.observe(document.documentElement);
    }
    let lastHeight = 0;
    setInterval(() => {
      const height = document.documentElement.scrollHeight || document.body.scrollHeight;
      if (height !== lastHeight) {
        lastHeight = height;
        reportHeight();
      }
    }, 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startHeightWatch, { once: true });
  } else {
    startHeightWatch();
  }
</script>`;

    // 在 </head> 前注入运行时和样式
    if (htmlContent.includes('</head>')) {
      return htmlContent.replace('</head>', `${hideScrollbarStyles}${runtimeScript}</head>`);
    }

    // 如果没有 </head>，在开头注入
    return hideScrollbarStyles + runtimeScript + htmlContent;
  }, [htmlContent, directiveName, args, config, theme]);

  if (loading) {
    return (
      <div className="external-plugin-loading">
        正在加载插件...
      </div>
    );
  }

  if (error) {
    return (
      <div className="external-plugin-error">
        <p>插件加载失败</p>
        <p className="error-detail">{error}</p>
      </div>
    );
  }

  return (
    <div className="external-plugin-container">
      <iframe
        ref={iframeRef}
        srcDoc={injectedHtml()}
        sandbox="allow-scripts"
        style={{
          border: 'none',
          width: '100%',
          height: '280px',
          overflow: 'hidden',
        }}
        title={`Plugin: ${config.meta?.name || directiveName}`}
      />
    </div>
  );
};

/**
 * 生成开发模式占位内容
 */
function generateDevPlaceholder(config: any, directiveName: string, args: Record<string, any>): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      padding: 20px;
      background: #f5f5f5;
    }
    .plugin-card {
      background: white;
      border-radius: 8px;
      padding: 20px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    .plugin-name {
      font-size: 18px;
      font-weight: bold;
      margin-bottom: 8px;
    }
    .plugin-desc {
      color: #666;
      margin-bottom: 16px;
    }
    .plugin-args {
      background: #f8f9fa;
      padding: 12px;
      border-radius: 4px;
      font-family: monospace;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <div class="plugin-card">
    <div class="plugin-name">${config.meta?.name || directiveName}</div>
    <div class="plugin-desc">${config.meta?.description || '外部插件'}</div>
    <div class="plugin-args">
      参数: ${JSON.stringify(args, null, 2)}
    </div>
  </div>
</body>
</html>
  `;
}

/**
 * 创建外部插件加载器工厂函数
 */
export function createExternalPluginLoader(pluginPath: string, config: any) {
  const Component = (props: Omit<ExternalPluginProps, 'pluginPath' | 'config'>) => (
    <ExternalPlugin
      {...props}
      pluginPath={pluginPath}
      config={config}
    />
  );

  Component.displayName = `ExternalPlugin_${config.meta?.id || 'unknown'}`;

  return { default: Component };
}

export default ExternalPlugin;
