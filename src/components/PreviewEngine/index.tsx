/**
 * Markdown 预览引擎
 * 统一渲染：GFM Markdown + 指令解析 + 交互式可视化组件
 */

import React, { Suspense, useMemo, useCallback, memo, forwardRef, useImperativeHandle, useRef, useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { openUrl } from '@tauri-apps/plugin-opener';
import { convertFileSrc } from '@tauri-apps/api/core';

import { loadComponent, preloadDetectedComponents, getComponentInfo, subscribePluginChanges, getPluginChangeVersion } from '../../plugins/component-registry';
import { resolveLocalImagePath } from '../../utils/markdownImage';
import type { DirectiveConfig } from '../../core/types/directive';
import MermaidDiagram from '../MermaidDiagram';

// ============================================
// 类型定义
// ============================================

export interface PreviewEngineProps {
  content: string;
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

// 自定义链接组件（使用默认浏览器打开）
const MarkdownLink: React.FC<{
  href?: string;
  children?: React.ReactNode;
  title?: string;
}> = ({ href, children, title }) => {
  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    if (href) {
      // 检测是否在 Tauri 环境
      const isTauri = typeof window !== 'undefined' && '__TAURI__' in window;
      if (isTauri) {
        openUrl(href).catch((err) => {
          console.error('Failed to open URL:', err);
        });
      } else {
        window.open(href, '_blank', 'noopener,noreferrer');
      }
    }
  };

  return (
    <a href={href} title={title} onClick={handleClick}>
      {children}
    </a>
  );
};

// ============================================
// 代码块组件（语言标签 + 复制按钮）
// ============================================

const MarkdownCodeBlock: React.FC<{
  lang: string;
  codeText: string;
  children?: React.ReactNode;
}> = ({ lang, codeText, children }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(codeText);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = codeText;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error('复制代码失败:', err);
    }
  }, [codeText]);

  return (
    <div className="code-block" data-language={lang || 'text'}>
      <div className="code-block-header">
        <span className="code-block-lang">{lang || 'text'}</span>
        <button
          type="button"
          className="code-copy-btn"
          onClick={handleCopy}
          aria-label="复制代码"
          title="复制代码"
        >
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <pre>{children}</pre>
    </div>
  );
};

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
    const [pluginVersion, setPluginVersion] = React.useState(() => getPluginChangeVersion());

    // 插件目录变化时重新加载（支持热重载 / 新插件免重启）
    React.useEffect(
      () => subscribePluginChanges(() => setPluginVersion(getPluginChangeVersion())),
      []
    );

    React.useEffect(() => {
      let mounted = true;

      setError(null);
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
    }, [directiveName, pluginVersion]);

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

    // 合并注册表声明的默认参数（例如 queue 的 mode），用户显式参数优先
    const defaultArgs = getComponentInfo(directiveName)?.defaultArgs;
    const mergedArgs = defaultArgs
      ? { ...defaultArgs, ...directiveArgs }
      : directiveArgs;

    return <Component directiveName={directiveName} args={mergedArgs} />;
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
    const isTauri =
      typeof window !== 'undefined' &&
      (!!(window as any).__TAURI_INTERNALS__ || '__TAURI__' in window);

    // Tauri 环境下处理本地路径（兼容 Windows 反斜杠）
    if (currentFilePath && isTauri) {
      const absolutePath = resolveLocalImagePath(currentFilePath, src);
      return convertFileSrc(absolutePath);
    }

    return src;
  }, [src, currentFilePath]);

  return <img src={resolvedSrc} alt={alt} style={{ maxWidth: '100%' }} />;
};

/**
 * 自定义 iframe 组件（支持 Markdown 中嵌入 <iframe>）
 * 默认附加 sandbox 与懒加载，未指定尺寸时使用 16:9 自适应容器
 */
const MarkdownIframe: React.FC<{
  src?: string;
  width?: string | number;
  height?: string | number;
  title?: string;
  allow?: string;
  allowFullScreen?: boolean;
  frameBorder?: string | number;
  sandbox?: string;
  style?: React.CSSProperties;
  className?: string;
  node?: unknown;
}> = ({ src, width, height, title, allow, allowFullScreen, sandbox, style, className, node, ...rest }) => {
  const [mode, setMode] = useState<'default' | 'standard' | 'fullscreen'>('default');
  const prevModeRef = useRef<'default' | 'standard'>('default');
  const wrapperRef = useRef<HTMLDivElement>(null);

  const isDesktopApp =
    typeof window !== 'undefined' &&
    (!!(window as any).__TAURI_INTERNALS__ || !!(window as any).__TAURI__);

  const getFullscreenElement = () => {
    const doc = document as any;
    return doc.fullscreenElement || doc.webkitFullscreenElement || doc.msFullscreenElement || null;
  };

  // 真正全屏：桌面端切换原生窗口全屏，Web 端使用 Fullscreen API
  const setNativeFullscreen = async (on: boolean) => {
    if (isDesktopApp) {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        await getCurrentWindow().setFullscreen(on);
      } catch (err) {
        console.error('切换窗口全屏失败:', err);
      }
      return;
    }

    const doc = document as any;
    if (on) {
      const el = wrapperRef.current as any;
      const request = el?.requestFullscreen || el?.webkitRequestFullscreen || el?.msRequestFullscreen;
      if (request) {
        try {
          await request.call(el);
        } catch (err) {
          console.error('进入全屏失败:', err);
        }
      }
    } else if (getFullscreenElement()) {
      const exit = doc.exitFullscreen || doc.webkitExitFullscreen || doc.msExitFullscreen;
      if (exit) {
        try {
          await exit.call(doc);
        } catch (err) {
          console.error('退出全屏失败:', err);
        }
      }
    }
  };

  const enterFullscreen = () => {
    prevModeRef.current = mode === 'fullscreen' ? prevModeRef.current : mode;
    // CSS 兜底：固定定位覆盖整个窗口，即使 window 全屏失败也能铺满
    setMode('fullscreen');
    void setNativeFullscreen(true);
  };

  const exitFullscreen = () => {
    setMode(prevModeRef.current);
    void setNativeFullscreen(false);
  };

  const selectMode = (next: 'default' | 'standard') => {
    prevModeRef.current = next;
    if (mode === 'fullscreen') void setNativeFullscreen(false);
    setMode(next);
  };

  // Web 端由浏览器切换全屏时同步状态（Esc 退出等）
  useEffect(() => {
    const onFullscreenChange = () => {
      setMode(getFullscreenElement() ? 'fullscreen' : prevModeRef.current);
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', onFullscreenChange);
    };
  }, []);

  // Esc 退出全屏
  useEffect(() => {
    if (mode !== 'fullscreen') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') exitFullscreen();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  if (!src) return null;

  const hasExplicitSize = Boolean(width || height);
  const classes = ['iframe-embed'];
  if (mode === 'default' && !hasExplicitSize) classes.push('iframe-embed--responsive');
  if (mode === 'standard') classes.push('iframe-embed--standard');
  if (mode === 'fullscreen') classes.push('iframe-embed--expanded');

  return (
    <div
      ref={wrapperRef}
      className={classes.join(' ')}
      style={hasExplicitSize ? undefined : { width: '100%' }}
    >
      <div className="iframe-embed-toolbar">
        <button
          type="button"
          className={mode === 'default' ? 'active' : ''}
          onClick={() => selectMode('default')}
          title="默认（自适应比例）"
        >
          默认
        </button>
        <button
          type="button"
          className={mode === 'standard' ? 'active' : ''}
          onClick={() => selectMode('standard')}
          title="标准高度 600px"
        >
          标准
        </button>
        <button
          type="button"
          className={mode === 'fullscreen' ? 'active' : ''}
          onClick={() => {
            if (mode === 'fullscreen') {
              exitFullscreen();
            } else {
              enterFullscreen();
            }
          }}
          title="全屏显示 (Esc 退出)"
        >
          全屏
        </button>
      </div>
      <iframe
        src={src}
        title={title || '嵌入内容'}
        width={width}
        height={height}
        allow={allow || 'autoplay; encrypted-media; picture-in-picture; fullscreen *'}
        allowFullScreen={allowFullScreen ?? true}
        sandbox={sandbox ?? 'allow-scripts allow-same-origin allow-popups allow-forms allow-presentation'}
        loading="lazy"
        className={className}
        style={style}
        {...rest}
      />
    </div>
  );
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

// ============================================
// 脑图内容解析
// ============================================

interface MindMapNode {
  id: string;
  label: string;
  children?: MindMapNode[];
}

let mindmapIdCounter = 0;

function generateMindmapId(): string {
  return `mindmap-${++mindmapIdCounter}`;
}

/**
 * 解析缩进格式的脑图内容
 * 支持空格或制表符缩进
 */
function parseMindmapContent(content: string): MindMapNode {
  const lines = content.split('\n').filter(line => line.trim());

  if (lines.length === 0) {
    return { id: generateMindmapId(), label: '空脑图' };
  }

  // 解析每一行的缩进级别和文本
  const parsed = lines.map(line => {
    // 计算缩进：制表符算1级，每2个空格算1级
    const indentMatch = line.match(/^(\s*)/);
    const indent = indentMatch ? indentMatch[1] : '';

    let level = 0;
    for (const char of indent) {
      if (char === '\t') {
        level++;
      } else if (char === ' ') {
        // 每2个空格算一级
        level += 0.5;
      }
    }
    level = Math.floor(level);

    const label = line.trim();
    return { level, label, id: generateMindmapId() };
  });

  // 构建树形结构
  return buildMindmapTree(parsed);
}

/**
 * 将解析后的行列表构建为树形结构
 */
function buildMindmapTree(lines: { level: number; label: string; id: string }[]): MindMapNode {
  if (lines.length === 0) {
    return { id: generateMindmapId(), label: '空节点' };
  }

  // 第一行是根节点
  const root: MindMapNode = {
    id: lines[0].id,
    label: lines[0].label,
    children: [],
  };

  // 使用栈来跟踪当前路径
  const stack: { node: MindMapNode; level: number }[] = [
    { node: root, level: 0 }
  ];

  for (let i = 1; i < lines.length; i++) {
    const { level, label, id } = lines[i];
    const newNode: MindMapNode = { id, label, children: [] };

    // 找到合适的父节点
    while (stack.length > 1 && stack[stack.length - 1].level >= level) {
      stack.pop();
    }

    // 添加到父节点的 children
    const parent = stack[stack.length - 1];
    if (parent.node.children) {
      parent.node.children.push(newNode);
    } else {
      parent.node.children = [newNode];
    }

    // 压入栈
    stack.push({ node: newNode, level });
  }

  return root;
}

const EnhancedMarkdown = memo(function EnhancedMarkdown({ content, currentFilePath }: EnhancedMarkdownProps) {
  // 预加载检测到的组件
  React.useEffect(() => {
    preloadDetectedComponents(content);
  }, [content]);

  // 配置 remark 插件
  const remarkPlugins = useMemo(
    () => [remarkGfm],
    []
  );

  // 配置 rehype 插件（解析原始 HTML，支持 <iframe> 嵌入）
  const rehypePlugins = useMemo(() => [rehypeRaw], []);

  // 自定义组件映射
  const components = useMemo(
    () => ({
      // iframe 嵌入组件
      iframe: MarkdownIframe,
      // 图片组件
      img: ({ node, ...props }: any) => (
        <MarkdownImage {...props} currentFilePath={currentFilePath} />
      ),
      // 链接组件 - 使用默认浏览器打开
      a: MarkdownLink,
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
      // 处理代码块
      // 代码块容器：react-markdown v10 仅在块级代码外包裹 <pre>，
      // 行内代码不会经过这里，因此可安全地按语言区分渲染
      pre: ({ children }: any) => {
        const codeEl = Array.isArray(children) ? children[0] : children;
        const className: string = codeEl?.props?.className || '';
        const match = /language-(\w+)/.exec(className);
        const lang = match ? match[1] : '';
        const codeText = String(codeEl?.props?.children ?? '').replace(/\n$/, '');

        // 处理 mindmap 代码块
        if (lang === 'mindmap') {
          const data = parseMindmapContent(codeText);
          return (
            <div className="directive-block">
              <DirectiveComponent
                directiveName="mindmap"
                directiveArgs={{ data }}
              />
            </div>
          );
        }

        // 处理 mermaid 流程图代码块
        if (lang === 'mermaid') {
          return (
            <div className="mermaid-block">
              <MermaidDiagram chart={codeText} />
            </div>
          );
        }

        // 其他代码块按标准方式渲染
        return (
          <MarkdownCodeBlock lang={lang} codeText={codeText}>
            {children}
          </MarkdownCodeBlock>
        );
      },
      // 代码（含行内代码与代码块内的 <code>）
      code: ({ node, className, children, ...props }: any) => (
        <code className={className} {...props}>{children}</code>
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
      rehypePlugins={rehypePlugins}
      components={components}
    >
      {content}
    </ReactMarkdown>
  );
});

// ============================================
// 主预览引擎
// ============================================

const PreviewEngine = forwardRef<PreviewEngineRef, PreviewEngineProps>(
  ({ content, currentFilePath, className = '' }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [debouncedContent, setDebouncedContent] = useState(content);
    const isLargeContent = content.length > 100000;
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
      if (isLargeContent) {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          setDebouncedContent(content);
        }, 500);
        return () => {
          if (timerRef.current) clearTimeout(timerRef.current);
        };
      } else {
        setDebouncedContent(content);
      }
    }, [content, isLargeContent]);

    useImperativeHandle(ref, () => ({
      getContainer: () => containerRef.current,
    }));

    return (
      <div ref={containerRef} className={`preview-content ${className}`}>
        <Suspense fallback={<div className="preview-loading">加载预览...</div>}>
          <EnhancedMarkdown content={debouncedContent} currentFilePath={currentFilePath} />
        </Suspense>
      </div>
    );
  }
);

PreviewEngine.displayName = 'PreviewEngine';

export default PreviewEngine;