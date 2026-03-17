/**
 * 插件沙箱组件
 *
 * 使用 iframe 沙箱安全地渲染用户自定义组件
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import type { PluginConfig, VisualizationState } from '../../core/types/plugin';

interface PluginSandboxProps {
  pluginPath: string;
  config: PluginConfig;
  directiveName: string;
  args: Record<string, any>;
  onStateChange?: (state: VisualizationState) => void;
  onError?: (error: Error) => void;
}

/**
 * 插件沙箱组件
 * 在 iframe 中隔离执行用户插件代码
 */
const PluginSandbox: React.FC<PluginSandboxProps> = ({
  config,
  directiveName,
  args,
  onStateChange,
  onError,
}) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 处理来自 iframe 的消息
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // 安全检查：确保消息来自我们的 iframe
      if (event.source !== iframeRef.current?.contentWindow) {
        return;
      }

      const { type, data } = event.data || {};

      switch (type) {
        case 'plugin:ready':
          setLoading(false);
          break;

        case 'plugin:error':
          setError(data.message);
          onError?.(new Error(data.message));
          break;

        case 'plugin:stateChange':
          onStateChange?.(data);
          break;
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onStateChange, onError]);

  // 向 iframe 发送指令参数
  useEffect(() => {
    if (!loading && iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage({
        type: 'plugin:updateArgs',
        directiveName,
        args,
      }, '*');
    }
  }, [loading, directiveName, args]);

  // 生成 iframe 内容
  const iframeContent = useCallback(() => {
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: transparent;
      color: #333;
    }
    .error {
      color: #dc3545;
      padding: 16px;
      text-align: center;
    }
    .loading {
      padding: 16px;
      text-align: center;
      color: #666;
    }
  </style>
</head>
<body>
  <div id="root"></div>
  <script>
    // 插件运行时
    const PluginRuntime = {
      directiveName: '${directiveName}',
      args: ${JSON.stringify(args)},
      config: ${JSON.stringify(config)},

      // 发送状态更新
      updateState(state) {
        window.parent.postMessage({
          type: 'plugin:stateChange',
          data: state
        }, '*');
      },

      // 发送错误
      reportError(message) {
        window.parent.postMessage({
          type: 'plugin:error',
          data: { message }
        }, '*');
      },

      // 获取参数定义
      getParamDefs() {
        const directive = this.config.meta.directives.find(d => d.name === this.directiveName);
        return directive ? directive.params : [];
      },

      // 获取参数默认值
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

      // 合并参数与默认值
      getResolvedArgs() {
        return { ...this.getDefaults(), ...this.args };
      }
    };

    // 初始化完成
    window.parent.postMessage({ type: 'plugin:ready' }, '*');

    // 接收参数更新
    window.addEventListener('message', (event) => {
      const { type, args: newArgs } = event.data || {};
      if (type === 'plugin:updateArgs') {
        PluginRuntime.args = newArgs;
        if (typeof window.onArgsUpdate === 'function') {
          window.onArgsUpdate(newArgs);
        }
      }
    });
  </script>
  <script>
    // 用户插件代码将在这里注入
    // 详见 plugin-template.md
  </script>
</body>
</html>
    `;
  }, [config, directiveName, args]);

  if (error) {
    return (
      <div className="plugin-error">
        <p>插件加载失败: {error}</p>
      </div>
    );
  }

  return (
    <div className="plugin-sandbox">
      {loading && (
        <div className="plugin-loading">
          正在加载插件...
        </div>
      )}
      <iframe
        ref={iframeRef}
        srcDoc={iframeContent()}
        sandbox="allow-scripts"
        style={{
          border: 'none',
          width: '100%',
          minHeight: '200px',
          display: loading ? 'none' : 'block',
        }}
        title={`Plugin: ${config.meta.name}`}
      />
    </div>
  );
};

export default PluginSandbox;