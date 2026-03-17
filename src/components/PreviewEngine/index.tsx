/**
 * 双模式预览引擎
 * 支持: 标准 Markdown 预览 / 增强型预览（含指令解析）
 */

import React, { Suspense, useMemo, memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { PluggableList } from 'unified';

import { loadComponent, preloadDetectedComponents } from '../../plugins/component-registry';
import type { DirectiveConfig } from '../../core/types/directive';

// ============================================
// 类型定义
// ============================================

export type PreviewMode = 'standard' | 'enhanced';

export interface PreviewEngineProps {
  content: string;
  mode: PreviewMode;
  currentFilePath?: string | null;
  className?: string;
}

interface DirectiveComponentProps {
  directiveName: string;
  directiveArgs: DirectiveConfig;
}

// ============================================
// 指令组件渲染器
// ============================================

const DirectiveComponent: React.FC<DirectiveComponentProps> = memo(
  ({ directiveName, directiveArgs }) => {
    const [Component, setComponent] = React.useState<React.ComponentType<any> | null>(null);
    const [error, setError] = React.useState<string | null>(null);

    React.useEffect(() => {
      let mounted = true;

      loadComponent(directiveName)
        .then((comp) => {
          if (mounted) {
            setComponent(() => comp);
          }
        })
        .catch((err) => {
          if (mounted) {
            setError(`无法加载组件 "${directiveName}": ${err.message}`);
          }
        });

      return () => {
        mounted = false;
      };
    }, [directiveName]);

    if (error) {
      return (
        <div className="directive-error">
          <span className="error-icon">⚠️</span>
          <span>{error}</span>
        </div>
      );
    }

    if (!Component) {
      return (
        <div className="directive-loading">
          <span>正在加载 {directiveName} 组件...</span>
        </div>
      );
    }

    return <Component args={directiveArgs} />;
  }
);

DirectiveComponent.displayName = 'DirectiveComponent';

// ============================================
// 增强型 Markdown 组件
// ============================================

interface EnhancedMarkdownProps {
  content: string;
  currentFilePath?: string | null;
}

// 自定义图片组件（处理本地路径）
const MarkdownImage: React.FC<{
  src?: string;
  alt?: string;
  currentFilePath?: string | null;
}> = ({ src, alt, currentFilePath }) => {
  const resolvedSrc = useMemo(() => {
    if (!src) return src;

    // 网络图片或 data URL 直接返回
    if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('data:')) {
      return src;
    }

    // Tauri 环境检测
  const isTauri = typeof window !== 'undefined' && '__TAURI__' in window;

  // Tauri 环境下处理本地路径
    if (currentFilePath && isTauri) {
      const basePath = currentFilePath.substring(0, currentFilePath.lastIndexOf('/'));
      let resolved: string;

      if (src.startsWith('/')) {
        resolved = src;
      } else if (src.startsWith('./') || src.startsWith('../')) {
        resolved = new URL(src, `file://${basePath}/`).pathname;
      } else {
        resolved = `${basePath}/${src}`;
      }

      // 使用 Tauri 的 convertFileSrc
      return `https://asset.localhost${resolved}`;
    }

    return src;
  }, [src, currentFilePath]);

  return <img src={resolvedSrc} alt={alt} style={{ maxWidth: '100%' }} />;
};

/**
 * 检测文本是否为指令并提取参数
 */
function parseDirective(text: string): { name: string; args: Record<string, unknown> } | null {
  const match = text.trim().match(/^:([a-zA-Z][a-zA-Z0-9]*)\s*\{([^}]*)\}$/);
  if (!match) return null;

  const name = match[1];
  const argsString = match[2];
  const args: Record<string, unknown> = {};

  if (argsString.trim()) {
    const argPattern = /([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(\[[^\]]*\]|"[^"]*"|'[^']*'|[^,\s]+)/g;
    let argMatch;
    while ((argMatch = argPattern.exec(argsString)) !== null) {
      let value: unknown = argMatch[2];
      if (typeof value === 'string') {
        if (value.startsWith('[') && value.endsWith(']')) {
          try { value = JSON.parse(value); } catch { /* keep */ }
        } else if (value.startsWith('"') || value.startsWith("'")) {
          value = value.slice(1, -1);
        } else if (!isNaN(Number(value))) {
          value = Number(value);
        } else if (value === 'true') {
          value = true;
        } else if (value === 'false') {
          value = false;
        }
      }
      args[argMatch[1]] = value;
    }
  }

  return { name, args };
}

const EnhancedMarkdown: React.FC<EnhancedMarkdownProps> = ({ content, currentFilePath }) => {
  // 预加载检测到的组件
  React.useEffect(() => {
    preloadDetectedComponents(content);
  }, [content]);

  // 配置 remark 插件
  const remarkPlugins: PluggableList = useMemo(
    () => [remarkGfm],
    []
  );

  // 自定义组件映射
  const components = useMemo(
    () => ({
      // 图片组件
      img: ({ node, ...props }: any) => (
        <MarkdownImage {...props} currentFilePath={currentFilePath} />
      ),
      // 处理段落节点（检测指令）
      p: ({ children }: any) => {
        // 尝试从 children 中提取文本
        let textContent = '';
        if (typeof children === 'string') {
          textContent = children;
        } else if (Array.isArray(children)) {
          textContent = children
            .map((child: any) => {
              if (typeof child === 'string') return child;
              if (child?.props?.children) {
                if (typeof child.props.children === 'string') return child.props.children;
                if (Array.isArray(child.props.children)) {
                  return child.props.children.join('');
                }
              }
              return '';
            })
            .join('');
        }

        // 检测指令
        const directive = parseDirective(textContent);
        if (directive) {
          return (
            <div className="directive-block">
              <DirectiveComponent
                directiveName={directive.name}
                directiveArgs={directive.args}
              />
            </div>
          );
        }

        return <p>{children}</p>;
      },
    }),
    [currentFilePath]
  );

  return (
    <ReactMarkdown
      remarkPlugins={remarkPlugins}
      components={components}
    >
      {content}
    </ReactMarkdown>
  );
};

// ============================================
// 主预览引擎
// ============================================

const PreviewEngine: React.FC<PreviewEngineProps> = ({
  content,
  mode,
  currentFilePath,
  className = '',
}) => {
  // 标准预览模式
  if (mode === 'standard') {
    return (
      <div className={`preview-content standard-preview ${className}`}>
        <Suspense fallback={<div className="preview-loading">加载预览...</div>}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              img: ({ node, ...props }: any) => (
                <MarkdownImage {...props} currentFilePath={currentFilePath} />
              ),
            }}
          >
            {content}
          </ReactMarkdown>
        </Suspense>
      </div>
    );
  }

  // 增强预览模式
  return (
    <div className={`preview-content enhanced-preview ${className}`}>
      <Suspense fallback={<div className="preview-loading">加载增强预览...</div>}>
        <EnhancedMarkdown content={content} currentFilePath={currentFilePath} />
      </Suspense>
    </div>
  );
};

export default PreviewEngine;