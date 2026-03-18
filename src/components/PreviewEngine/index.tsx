/**
 * 双模式预览引擎
 * 支持: 标准 Markdown 预览 / 增强型预览（含指令解析）
 */

import React, { Suspense, useMemo, memo, forwardRef, useImperativeHandle, useRef } from 'react';
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

export interface PreviewEngineRef {
  getContainer: () => HTMLDivElement | null;
}

interface DirectiveComponentProps {
  directiveName: string;
  directiveArgs: DirectiveConfig;
}

// ============================================
// 标题 ID 生成
// ============================================

let headingIdCounter = 0;

function generateHeadingId(text: string): string {
  const sanitized = text
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5\s-]/g, '')
    .replace(/\s+/g, '-');

  return sanitized || `heading-${headingIdCounter++}`;
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
 * 支持：嵌套对象/数组（单行格式）
 */
function parseDirective(text: string): { name: string; args: Record<string, unknown> } | null {
  const trimmed = text.trim();

  // 检查是否以 :name{ 开头
  const headerMatch = trimmed.match(/^:([a-zA-Z][a-zA-Z0-9]*)\s*\{/);
  if (!headerMatch) return null;

  const name = headerMatch[1];

  // 使用括号匹配找到完整的指令体
  let braceCount = 0;
  let startIndex = headerMatch[0].length - 1;
  let endIndex = -1;

  for (let i = startIndex; i < trimmed.length; i++) {
    const char = trimmed[i];
    if (char === '{') braceCount++;
    else if (char === '}') {
      braceCount--;
      if (braceCount === 0) {
        endIndex = i;
        break;
      }
    }
  }

  if (endIndex === -1) return null;
  if (trimmed.slice(endIndex + 1).trim()) return null;

  const argsString = trimmed.slice(startIndex + 1, endIndex);
  const args = parseDirectiveArgs(argsString);

  return { name, args };
}

/**
 * 解析指令参数字符串（支持嵌套结构）
 */
function parseDirectiveArgs(argsString: string): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  if (!argsString.trim()) return args;

  let pos = 0;
  const len = argsString.length;

  while (pos < len) {
    while (pos < len && /[\s,]/.test(argsString[pos])) pos++;
    if (pos >= len) break;

    const nameMatch = argsString.slice(pos).match(/^([a-zA-Z_][a-zA-Z0-9_]*)/);
    if (!nameMatch) break;
    const argName = nameMatch[1];
    pos += argName.length;

    while (pos < len && /\s/.test(argsString[pos])) pos++;
    if (pos >= len || argsString[pos] !== '=') break;
    pos++;

    while (pos < len && /\s/.test(argsString[pos])) pos++;

    const { value, newPos } = parseValue(argsString, pos);
    args[argName] = value;
    pos = newPos;
  }

  return args;
}

/**
 * 解析一个值（支持嵌套数组/对象）
 */
function parseValue(str: string, pos: number): { value: unknown; newPos: number } {
  if (pos >= str.length) return { value: undefined, newPos: pos };

  const char = str[pos];

  if (char === '"' || char === "'") {
    const quote = char;
    let i = pos + 1;
    while (i < str.length) {
      if (str[i] === '\\' && i + 1 < str.length) { i += 2; continue; }
      if (str[i] === quote) break;
      i++;
    }
    const rawValue = str.slice(pos + 1, i);
    const value = rawValue.replace(/\\(.)/g, '$1');
    return { value, newPos: i + 1 };
  }

  if (char === '[') return parseArray(str, pos);
  if (char === '{') return parseObject(str, pos);

  let i = pos;
  while (i < str.length && !/[\s,}\]]/.test(str[i])) i++;
  const token = str.slice(pos, i);

  if (token === 'true') return { value: true, newPos: i };
  if (token === 'false') return { value: false, newPos: i };
  if (token === 'null') return { value: null, newPos: i };
  if (!isNaN(Number(token)) && token !== '') return { value: Number(token), newPos: i };

  return { value: token, newPos: i };
}

function parseArray(str: string, pos: number): { value: unknown[]; newPos: number } {
  const arr: unknown[] = [];
  pos++;

  while (pos < str.length) {
    while (pos < str.length && /[\s,]/.test(str[pos])) pos++;
    if (pos >= str.length) break;
    if (str[pos] === ']') { pos++; break; }
    const { value, newPos } = parseValue(str, pos);
    arr.push(value);
    pos = newPos;
  }

  return { value: arr, newPos: pos };
}

function parseObject(str: string, pos: number): { value: Record<string, unknown>; newPos: number } {
  const obj: Record<string, unknown> = {};
  pos++;

  while (pos < str.length) {
    while (pos < str.length && /[\s,]/.test(str[pos])) pos++;
    if (pos >= str.length) break;
    if (str[pos] === '}') { pos++; break; }

    let key: string;
    if (str[pos] === '"' || str[pos] === "'") {
      const { value, newPos } = parseValue(str, pos);
      key = String(value);
      pos = newPos;
    } else {
      const keyMatch = str.slice(pos).match(/^([a-zA-Z_][a-zA-Z0-9_]*)/);
      if (!keyMatch) break;
      key = keyMatch[1];
      pos += key.length;
    }

    while (pos < str.length && /\s/.test(str[pos])) pos++;
    if (pos >= str.length || (str[pos] !== '=' && str[pos] !== ':')) break;
    pos++;
    while (pos < str.length && /\s/.test(str[pos])) pos++;

    const { value, newPos } = parseValue(str, pos);
    obj[key] = value;
    pos = newPos;
  }

  return { value: obj, newPos: pos };
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
      // 标题组件（添加 ID）
      h1: ({ children }: any) => {
        const text = typeof children === 'string' ? children : '';
        const id = generateHeadingId(text);
        return <h1 id={id}>{children}</h1>;
      },
      h2: ({ children }: any) => {
        const text = typeof children === 'string' ? children : '';
        const id = generateHeadingId(text);
        return <h2 id={id}>{children}</h2>;
      },
      h3: ({ children }: any) => {
        const text = typeof children === 'string' ? children : '';
        const id = generateHeadingId(text);
        return <h3 id={id}>{children}</h3>;
      },
      h4: ({ children }: any) => {
        const text = typeof children === 'string' ? children : '';
        const id = generateHeadingId(text);
        return <h4 id={id}>{children}</h4>;
      },
      h5: ({ children }: any) => {
        const text = typeof children === 'string' ? children : '';
        const id = generateHeadingId(text);
        return <h5 id={id}>{children}</h5>;
      },
      h6: ({ children }: any) => {
        const text = typeof children === 'string' ? children : '';
        const id = generateHeadingId(text);
        return <h6 id={id}>{children}</h6>;
      },
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

const PreviewEngine = forwardRef<PreviewEngineRef, PreviewEngineProps>(
  ({ content, mode, currentFilePath, className = '' }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);

    // 暴露 ref 方法
    useImperativeHandle(ref, () => ({
      getContainer: () => containerRef.current,
    }));

    // 为标题添加 ID 的组件
    const headingComponents = useMemo(
      () => ({
        h1: ({ children }: any) => {
          const text = typeof children === 'string' ? children : '';
          const id = generateHeadingId(text);
          return <h1 id={id}>{children}</h1>;
        },
        h2: ({ children }: any) => {
          const text = typeof children === 'string' ? children : '';
          const id = generateHeadingId(text);
          return <h2 id={id}>{children}</h2>;
        },
        h3: ({ children }: any) => {
          const text = typeof children === 'string' ? children : '';
          const id = generateHeadingId(text);
          return <h3 id={id}>{children}</h3>;
        },
        h4: ({ children }: any) => {
          const text = typeof children === 'string' ? children : '';
          const id = generateHeadingId(text);
          return <h4 id={id}>{children}</h4>;
        },
        h5: ({ children }: any) => {
          const text = typeof children === 'string' ? children : '';
          const id = generateHeadingId(text);
          return <h5 id={id}>{children}</h5>;
        },
        h6: ({ children }: any) => {
          const text = typeof children === 'string' ? children : '';
          const id = generateHeadingId(text);
          return <h6 id={id}>{children}</h6>;
        },
      }),
      []
    );

    // 标准预览模式
    if (mode === 'standard') {
      return (
        <div ref={containerRef} className={`preview-content standard-preview ${className}`}>
          <Suspense fallback={<div className="preview-loading">加载预览...</div>}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                img: ({ node, ...props }: any) => (
                  <MarkdownImage {...props} currentFilePath={currentFilePath} />
                ),
                ...headingComponents,
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
      <div ref={containerRef} className={`preview-content enhanced-preview ${className}`}>
        <Suspense fallback={<div className="preview-loading">加载增强预览...</div>}>
          <EnhancedMarkdown content={content} currentFilePath={currentFilePath} />
        </Suspense>
      </div>
    );
  }
);

PreviewEngine.displayName = 'PreviewEngine';

export default PreviewEngine;