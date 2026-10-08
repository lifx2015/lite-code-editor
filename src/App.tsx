import { CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import CodeMirror from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { javascript } from "@codemirror/lang-javascript";
import { bracketMatching } from "@codemirror/language";
import { json, jsonParseLinter } from "@codemirror/lang-json";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { python } from "@codemirror/lang-python";
import { sql } from "@codemirror/lang-sql";
import { java } from "@codemirror/lang-java";
import { yaml } from "@codemirror/lang-yaml";
import { toml } from "./lang/toml";
import { bat } from "./lang/bat";
import { powershell } from "./lang/powershell";
import { search, searchKeymap, SearchQuery, setSearchQuery, closeSearchPanel, findNext, findPrevious, selectMatches } from "@codemirror/search";
import { rectangularSelection, EditorView, keymap, hoverTooltip, KeyBinding } from "@codemirror/view";
import { linter, lintGutter, type Diagnostic } from "@codemirror/lint";
import { oneDark } from "@codemirror/theme-one-dark";
import { StateField, StateEffect, EditorState } from "@codemirror/state";
import { Decoration, type DecorationSet, WidgetType } from "@codemirror/view";
import PreviewEngine, { type PreviewEngineRef } from "./components/PreviewEngine";
import { handleCloseRequest, type CloseChoice, type ClosePrompt } from "./core/closeGuard";
import Toc from "./components/Toc";
import FeatureGuide from "./components/FeatureGuide";
import { initializeExternalPlugins, setupPluginWatcher } from "./plugins/component-registry";
import {
  type ImageLocation,
  MAX_IMAGE_BYTES,
  getImageExtension,
  isImagePath,
  dirnameOf,
  joinPath,
  imageTargetDir,
  toMarkdownRef,
  findAvailableImageName,
} from "./utils/markdownImage";
import "./App.css";

type EditorTab = {
  id: string;
  title: string;
  path: string | null;
  content: string;
  encoding: string;
  language: string;
  externallyModified: boolean;
  savedContent: string;
  fileSize: number;
  lineCount: number;
  isLargeFile: boolean;
  isReadOnly: boolean;
  chunkStartLine: number;
  chunkEndLine: number;
  totalLines: number;
  hasMoreChunks: boolean;
  isLoadingChunk: boolean;
  isBinary: boolean;
  revision: string | null;
  bom: boolean;
};

type ThemeMode = "system" | "light" | "dark";

type MarkdownTheme = "default" | "aicloud";

type CacheFileInfo = {
  id: string;
  title: string;
  content: string;
  language: string;
};

// 检测字符串是否是图片URL
const isImageUrl = (str: string): boolean => {
  if (!str || typeof str !== 'string') return false;
  // 支持 http/https/data:image 协议
  const imagePattern = /^(https?:\/\/.*\.(jpg|jpeg|png|gif|webp|svg|bmp|ico)(\?.*)?)$/i;
  const dataImagePattern = /^data:image\/(jpg|jpeg|png|gif|webp|svg\+xml|bmp);base64,/i;
  return imagePattern.test(str) || dataImagePattern.test(str);
};

// 从剪贴板数据中提取图片文件
const getClipboardImageFile = (data: DataTransfer | null): File | null => {
  if (!data) return null;
  const items = data.items;
  if (items) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) return file;
      }
    }
  }
  const files = data.files;
  if (files) {
    for (let i = 0; i < files.length; i++) {
      if (files[i].type.startsWith("image/")) return files[i];
    }
  }
  return null;
};

// 比较两个文件路径是否指向同一文件（统一分隔符，Windows 下忽略大小写）
const isSamePath = (a: string | null | undefined, b: string | null | undefined): boolean => {
  if (!a || !b) return false;
  const normalize = (p: string) => {
    const unified = p.replace(/\\/g, "/");
    return /windows/i.test(navigator.userAgent) ? unified.toLowerCase() : unified;
  };
  return normalize(a) === normalize(b);
};

// JSON 错误标记 Widget - 在错误行行号旁显示错误行号和消息
class ErrorMarkerWidget extends WidgetType {
  constructor(private lineNum: number, private message: string) {
    super();
  }

  toDOM() {
    const wrapper = document.createElement('span');
    wrapper.className = 'json-error-marker';

    const icon = document.createElement('span');
    icon.className = 'json-error-icon';
    icon.textContent = '⚠';

    const text = document.createElement('span');
    text.className = 'json-error-text';
    text.textContent = this.message;

    wrapper.appendChild(icon);
    wrapper.appendChild(text);
    wrapper.title = `第 ${this.lineNum} 行: ${this.message}`;
    return wrapper;
  }

  ignoreEvent() {
    return false;
  }
}

// JSON 错误定位标记：锚定在诊断的起始 offset，而不是行尾或 gutter。
class ErrorLocationMarkerWidget extends WidgetType {
  toDOM() {
    const marker = document.createElement('span');
    marker.className = 'json-error-location-marker';
    marker.setAttribute('aria-hidden', 'true');
    return marker;
  }

  ignoreEvent() {
    return true;
  }
}

// 创建错误标记装饰
const createErrorDecorations = (diagnostics: readonly Diagnostic[], state: EditorState): DecorationSet => {
  const decorations: any[] = [];
  diagnostics.forEach((d) => {
    if (d.severity === 'error') {
      const line = state.doc.lineAt(d.from);
      decorations.push(
        Decoration.line({ class: 'json-error-line' }).range(line.from)
      );
      decorations.push(
        Decoration.widget({
          widget: new ErrorMarkerWidget(line.number, d.message),
          side: 1,
        }).range(line.to)
      );
      decorations.push(
        Decoration.widget({
          widget: new ErrorLocationMarkerWidget(),
          // side: -1 keeps the triangle immediately before the character at d.from.
          side: -1,
        }).range(d.from)
      );
    }
  });
  decorations.sort((a: any, b: any) => a.from - b.from);
  return Decoration.set(decorations, true);
};

const errorMarkerField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decorations, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setDiagnosticsEffect)) {
        return createErrorDecorations(effect.value, tr.state);
      }
    }
    return decorations.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

// 设置诊断信息的 effect
const setDiagnosticsEffect = StateEffect.define<readonly Diagnostic[]>();

// 自定义 JSON linter，同时触发错误标记
const jsonLinterWithMarkers = () => {
  const baseLinter = jsonParseLinter();
  return (view: EditorView): Diagnostic[] => {
    const diagnostics = baseLinter(view);
    // 触发错误标记更新
    view.dispatch({
      effects: setDiagnosticsEffect.of(diagnostics),
    });
    return diagnostics;
  };
};

// 应用内确认弹框：按钮与请求描述。
// 用应用内弹框替代系统 ask()，因为系统对话框只有两个按钮，
// 无法区分“选择某个选项”与“关闭对话框(×)”，后者会被当成取消项。
interface ConfirmButton<T> {
  label: string;
  value: T;
  variant?: "default" | "primary" | "danger";
}

interface ConfirmRequest<T> {
  title: string;
  message: string;
  buttons: ConfirmButton<T>[];
  /** 按 ESC / 点击遮罩 / 点击关闭按钮时的返回值 */
  cancelValue: T;
}

function App() {
  const [tabs, setTabs] = useState<EditorTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>("");
  const [viewMode, setViewMode] = useState<"edit" | "preview" | "split">("edit");
  const [displayMode, setDisplayMode] = useState<"text" | "hex">("text");
  const [hexData, setHexData] = useState<{ offset: string; hex_values: string[]; ascii: string }[]>([]);
  const [hexSearchPattern, setHexSearchPattern] = useState("");
  const [hexSearchTotal, setHexSearchTotal] = useState(0);
  const [fontFamily, setFontFamily] = useState<string>("Consolas");
  const [fontSize, setFontSize] = useState<number>(15);
  const [wordWrap, setWordWrap] = useState<boolean>(true);
  const [cursorLine, setCursorLine] = useState<number>(1);
  const [cursorCol, setCursorCol] = useState<number>(1);
  const [statusMessage, setStatusMessage] = useState<string>("就绪");
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem("themeMode");
    return (saved as ThemeMode) || "system";
  });
  const [markdownTheme, setMarkdownTheme] = useState<MarkdownTheme>(() => {
    const saved = localStorage.getItem("markdownTheme");
    return saved === "aicloud" ? "aicloud" : "default";
  });
  const [markdownImageLocation, setMarkdownImageLocation] = useState<ImageLocation>(() => {
    const saved = localStorage.getItem("markdownImageLocation");
    return saved === "assets" ? "assets" : "sameDir";
  });
  const previewEngineRef = useRef<PreviewEngineRef>(null);
  const [systemTheme, setSystemTheme] = useState<"light" | "dark">(() => {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  const editorPaneRef = useRef<HTMLDivElement | null>(null);
  const floatingScrollRef = useRef<HTMLDivElement | null>(null);
  const floatingScrollContentRef = useRef<HTMLDivElement | null>(null);
  const tabsRef = useRef<EditorTab[]>(tabs);
  tabsRef.current = tabs;
  // 大文件编辑的防抖更新：按标签页 id 记录待提交内容，避免切换标签后写错目标
  const pendingContentRef = useRef<Map<string, { content: string; timer: ReturnType<typeof setTimeout> }>>(new Map());
  // 编辑器实例引用，保存时以编辑器中的真实内容为准（避免大文件防抖导致状态滞后）
  const editorViewRef = useRef<EditorView | null>(null);
  const flushPendingContent = useCallback((tabId: string) => {
    const pending = pendingContentRef.current.get(tabId);
    if (!pending) return null;
    clearTimeout(pending.timer);
    pendingContentRef.current.delete(tabId);
    return pending.content;
  }, []);

  // 编辑器未挂载（预览/十六进制模式）时清空引用，避免读取已销毁的视图
  useEffect(() => {
    if (viewMode === "preview" || displayMode === "hex") {
      editorViewRef.current = null;
    }
  }, [viewMode, displayMode]);

  // 计算当前实际主题
  const currentTheme = themeMode === "system" ? systemTheme : themeMode;

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
  const content = activeTab?.content ?? "";
  const filePath = activeTab?.path ?? null;
  const encoding = activeTab?.encoding ?? "UTF-8";
  const language = activeTab?.language ?? "text";

  const detectLanguageByPath = (path: string) => {
    const lowerPath = path.toLowerCase();
    if (lowerPath.endsWith(".md")) return "markdown";
    if (lowerPath.endsWith(".js") || lowerPath.endsWith(".ts") || lowerPath.endsWith(".jsx") || lowerPath.endsWith(".tsx")) return "javascript";
    if (lowerPath.endsWith(".json")) return "json";
    if (lowerPath.endsWith(".css")) return "css";
    if (lowerPath.endsWith(".html") || lowerPath.endsWith(".htm")) return "html";
    if (lowerPath.endsWith(".py")) return "python";
    if (lowerPath.endsWith(".sql")) return "sql";
    if (lowerPath.endsWith(".java")) return "java";
    if (lowerPath.endsWith(".yaml") || lowerPath.endsWith(".yml")) return "yaml";
    if (lowerPath.endsWith(".toml")) return "toml";
    if (lowerPath.endsWith(".bat") || lowerPath.endsWith(".cmd")) return "bat";
    if (lowerPath.endsWith(".ps1") || lowerPath.endsWith(".psm1") || lowerPath.endsWith(".psd1")) return "powershell";
    return "text";
  };

  const toTabTitle = (path: string) => path.split(/[\\/]/).pop() || path;

  const updateTab = useCallback((tabId: string, patch: Partial<EditorTab>) => {
    tabsRef.current = tabsRef.current.map((tab) => (tab.id === tabId ? { ...tab, ...patch } : tab));
    setTabs((prev) => prev.map((tab) => (tab.id === tabId ? { ...tab, ...patch } : tab)));
  }, []);
  const savingTabsRef = useRef(new Set<string>());

  const updateActiveTab = useCallback((patch: Partial<EditorTab>) => {
    updateTab(activeTabId, patch);
  }, [activeTabId, updateTab]);

  // 通用确认弹框：返回所选按钮的 value；ESC / 遮罩 / 关闭按钮返回 cancelValue
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest<unknown> | null>(null);
  const confirmResolverRef = useRef<((value: unknown) => void) | null>(null);

  const confirm = useCallback(<T,>(request: ConfirmRequest<T>): Promise<T> => {
    // 已有弹框时直接返回取消值，避免弹框叠加或覆盖尚未结算的 Promise
    if (confirmResolverRef.current) return Promise.resolve(request.cancelValue);
    return new Promise<T>((resolve) => {
      confirmResolverRef.current = resolve as (value: unknown) => void;
      setConfirmRequest(request as unknown as ConfirmRequest<unknown>);
    });
  }, []);

  const resolveConfirm = useCallback((value: unknown) => {
    const resolve = confirmResolverRef.current;
    confirmResolverRef.current = null;
    setConfirmRequest(null);
    resolve?.(value);
  }, []);

  useEffect(() => {
    if (!confirmRequest) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        resolveConfirm(confirmRequest.cancelValue);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [confirmRequest, resolveConfirm]);

  const HUGE_FILE_THRESHOLD = 10 * 1024 * 1024;
  const CHUNK_LINE_COUNT = 5000;

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  };

  const openFileByPath = useCallback(async (path: string, encodingHint?: string) => {
    const existing = tabsRef.current.find((tab) => isSamePath(tab.path, path));
    if (existing) {
      setActiveTabId(existing.id);
      setStatusMessage("文件已打开，保留当前编辑内容");
      return;
    }
    const result: { content: string, encoding: string, file_size: number, line_count: number, is_large_file: boolean, is_binary: boolean, revision: string, bom: boolean, had_decode_errors: boolean } = await invoke("load_file", { path, encoding: encodingHint || null });
    const nextLanguage = detectLanguageByPath(path);
    const isHuge = result.file_size > HUGE_FILE_THRESHOLD;
    const isLarge = result.is_large_file;
    const isBinary = result.is_binary;

    if (isHuge) {
      const choice = await confirm<"chunk" | "full" | "cancel">({
        title: "超大文件警告",
        message: `文件大小为 ${formatFileSize(result.file_size)}（${result.line_count} 行），加载可能导致卡顿或崩溃。\n\n是否以只读分块模式加载？（仅加载前 ${CHUNK_LINE_COUNT} 行）`,
        cancelValue: "cancel",
        buttons: [
          { label: "取消", value: "cancel" },
          { label: "完整加载", value: "full" },
          { label: "分块加载", value: "chunk", variant: "primary" },
        ],
      });
      if (choice === "cancel") {
        setStatusMessage("已取消打开大文件");
        return;
      }
      if (choice === "chunk") {
        const chunkResult: { content: string, start_line: number, end_line: number, total_lines: number, has_more: boolean, revision: string, bom: boolean } = await invoke("load_file_chunk", { path, startLine: 0, lineCount: CHUNK_LINE_COUNT, encoding: encodingHint || null });
        let targetTabId = "";
        setTabs((prev) => {
          const existed = prev.find((tab) => isSamePath(tab.path, path));
          if (existed) {
            targetTabId = existed.id;
            return prev.map((tab) =>
              tab.id === existed.id
                ? { ...tab, content: chunkResult.content, encoding: result.encoding, language: nextLanguage, title: toTabTitle(path), externallyModified: false, savedContent: chunkResult.content, fileSize: result.file_size, lineCount: result.line_count, isLargeFile: true, isReadOnly: true, chunkStartLine: chunkResult.start_line, chunkEndLine: chunkResult.end_line, totalLines: chunkResult.total_lines, hasMoreChunks: chunkResult.has_more, isLoadingChunk: false, isBinary, revision: chunkResult.revision, bom: chunkResult.bom }
                : tab
            );
          }
          const nextId = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          targetTabId = nextId;
          return [...prev, {
            id: nextId, title: toTabTitle(path), path, content: chunkResult.content, encoding: result.encoding, language: nextLanguage, externallyModified: false, savedContent: chunkResult.content,
            fileSize: result.file_size, lineCount: result.line_count, isLargeFile: true, isReadOnly: true, chunkStartLine: chunkResult.start_line, chunkEndLine: chunkResult.end_line, totalLines: chunkResult.total_lines, hasMoreChunks: chunkResult.has_more, isLoadingChunk: false, isBinary, revision: chunkResult.revision, bom: chunkResult.bom,
          }];
        });
        if (targetTabId) setActiveTabId(targetTabId);
        setCursorLine(1); setCursorCol(1);
        setStatusMessage(`已分块加载 ${path}（${formatFileSize(result.file_size)}，显示 ${chunkResult.start_line + 1}-${chunkResult.end_line} / ${chunkResult.total_lines} 行）`);
        try { await invoke("watch_file", { path }); } catch (error) { console.error("Failed to watch file:", error); }
        return;
      }
    } else if (isLarge) {
      const choice = await confirm<"load" | "cancel">({
        title: "大文件提示",
        message: `文件大小为 ${formatFileSize(result.file_size)}（${result.line_count} 行），加载可能较慢。是否继续？`,
        cancelValue: "cancel",
        buttons: [
          { label: "取消", value: "cancel" },
          { label: "加载", value: "load", variant: "primary" },
        ],
      });
      if (choice === "cancel") {
        setStatusMessage("已取消打开大文件");
        return;
      }
    }

    let targetTabId = "";
    setTabs((prev) => {
      const existed = prev.find((tab) => isSamePath(tab.path, path));
      if (existed) {
        targetTabId = existed.id;
        return prev.map((tab) =>
          tab.id === existed.id
            ? { ...tab, content: result.content, encoding: result.encoding, language: nextLanguage, title: toTabTitle(path), externallyModified: false, savedContent: result.content, fileSize: result.file_size, lineCount: result.line_count, isLargeFile: isLarge, isReadOnly: false, chunkStartLine: 0, chunkEndLine: result.line_count, totalLines: result.line_count, hasMoreChunks: false, isLoadingChunk: false, isBinary, revision: result.revision, bom: result.bom }
            : tab
        );
      }
      const nextId = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      targetTabId = nextId;
      return [...prev, {
        id: nextId, title: toTabTitle(path), path, content: result.content, encoding: result.encoding, language: nextLanguage, externallyModified: false, savedContent: result.content,
        fileSize: result.file_size, lineCount: result.line_count, isLargeFile: isLarge, isReadOnly: false, chunkStartLine: 0, chunkEndLine: result.line_count, totalLines: result.line_count, hasMoreChunks: false, isLoadingChunk: false, isBinary, revision: result.revision, bom: result.bom,
      }];
    });
    if (targetTabId) {
      setActiveTabId(targetTabId);
    }
    setCursorLine(1);
    setCursorCol(1);
    setStatusMessage(`已打开 ${path}（${formatFileSize(result.file_size)}）`);
    try {
      await invoke("watch_file", { path });
    } catch (error) {
      console.error("Failed to watch file:", error);
    }
  }, [confirm]);

  const handleOpenFile = async () => {
    try {
      const selected = await open({
        multiple: true,
      });

      if (!selected) return;
      if (typeof selected === 'string') {
        await openFileByPath(selected);
      } else {
        for (const path of selected) {
          await openFileByPath(path);
        }
      }
    } catch (error) {
      console.error("Failed to open file:", error);
      setStatusMessage("打开失败: " + error);
    }
  };

  const handleSaveFile = async (tab?: EditorTab): Promise<string | null> => {
    const target = tab ?? activeTab;
    if (!target || savingTabsRef.current.has(target.id)) return null;
    savingTabsRef.current.add(target.id);
    try {
      if (target.isReadOnly) {
        setStatusMessage("只读模式下无法保存，请先加载全部内容");
        return null;
      }
      const isActiveTab = target.id === activeTabId;
      const pendingContent = flushPendingContent(target.id);

      // 大文件编辑有 300ms 防抖，content 状态可能滞后；
      // 保存时以编辑器中的真实内容为准，避免"保存成功但文件没变"
      const view = editorViewRef.current;
      let contentToSave = target.content;
      if (isActiveTab && view && viewMode !== "preview" && displayMode === "text") {
        try {
          contentToSave = view.state.doc.toString();
        } catch {
          contentToSave = target.content;
        }
      } else if (pendingContent !== null) {
        // 编辑器未挂载但仍有未提交的防抖内容（如刚切到预览模式就保存）
        contentToSave = pendingContent;
      }

      // 立即把最新内容同步到状态，避免后续防抖定时器覆盖 savedContent
      if (contentToSave !== target.content) {
        updateTab(target.id, { content: contentToSave });
      }

      let path = target.path;
      if (!path) {
        path = await save({
          filters: [{
            name: 'Text',
            extensions: ['txt', 'md']
          }]
        });
      }

      if (path) {
        let expectedRevision = target.revision;
        if (!target.path) {
          expectedRevision = await invoke<string | null>("get_file_revision", { path });
          if (expectedRevision) {
            setStatusMessage("目标位置已存在文件，未覆盖");
            return null;
          }
        }
        const savedRevision = await invoke<string>("save_file", { path, content: contentToSave, encoding: target.encoding, expectedRevision, bom: target.bom });
        // 如果是新文件，开始监听
        if (!target.path) {
          try {
            await invoke("watch_file", { path });
          } catch (error) {
            console.error("Failed to watch file:", error);
          }
        }
        // 保存成功后删除缓存文件
        try {
          await invoke("delete_cache_file", { id: target.id });
        } catch (error) {
          console.error("Failed to delete cache:", error);
        }
        updateTab(target.id, { path, title: toTabTitle(path), externallyModified: false, savedContent: contentToSave, revision: savedRevision, bom: target.bom });
        setStatusMessage("保存成功");
        return path;
      }
      return null;
    } catch (error) {
      const message = String(error);
      if (message.includes("CONFLICT")) {
        setStatusMessage("文件已被外部程序修改，保存已取消。请先刷新或另存为");
      } else {
        setStatusMessage("保存失败: " + error);
      }
      console.error("Failed to save file:", error);
      return null;
    } finally {
      savingTabsRef.current.delete(target.id);
    }
  };

  const reportJsonError = (error: unknown) => {
    const msg = (error as Error).message;
    const posMatch = msg.match(/position\s+(\d+)/i);
    if (posMatch) {
      const pos = parseInt(posMatch[1], 10);
      const lines = content.substring(0, pos).split('\n');
      const line = lines.length;
      const col = lines[lines.length - 1].length + 1;
      setStatusMessage(`JSON 错误: 第 ${line} 行, 第 ${col} 列: ${msg}`);
      return;
    }
    const lineMatch = msg.match(/line\s+(\d+)\s+column\s+(\d+)/i);
    if (lineMatch) {
      setStatusMessage(`JSON 错误: 第 ${lineMatch[1]} 行, 第 ${lineMatch[2]} 列: ${msg}`);
      return;
    }
    setStatusMessage(`JSON 错误: ${msg}`);
  };

  const transformJson = (indent: number | undefined, actionLabel: "美化" | "压缩") => {
    if (!content.trim()) return;
    if (activeTab?.isReadOnly) {
      setStatusMessage(`只读模式下无法${actionLabel}`);
      return;
    }
    try {
      const parsed = JSON.parse(content);
      updateActiveTab({ content: JSON.stringify(parsed, null, indent) });
      setStatusMessage(`JSON ${actionLabel}成功`);
    } catch (error) {
      reportJsonError(error);
    }
  };

  const handleFormatJson = () => transformJson(2, "美化");

  const handleMinifyJson = () => transformJson(undefined, "压缩");

  // JSON图片URL悬停预览扩展
  const jsonImageHoverExtension = useMemo(() => {
    if (language !== 'json') return null;

    return hoverTooltip((view, pos) => {
      const { from, text } = view.state.doc.lineAt(pos);
      const lineText = text;
      const cursorPos = pos - from;

      // 查找光标所在的字符串（支持对象属性值和数组元素）
      let stringStart = -1;
      let stringEnd = -1;

      // 遍历整行查找光标所在的引号字符串
      for (let i = 0; i < lineText.length; i++) {
        const char = lineText[i];
        if (char === '"' && (i === 0 || lineText[i - 1] !== '\\')) {
          if (stringStart === -1) {
            stringStart = i;
          } else {
            stringEnd = i;
            // 检查光标是否在这个字符串范围内
            if (cursorPos >= stringStart && cursorPos <= stringEnd) {
              break;
            }
            // 不在范围内，继续查找下一个字符串
            stringStart = -1;
            stringEnd = -1;
          }
        }
      }

      if (stringStart === -1 || stringEnd === -1) return null;
      if (cursorPos < stringStart || cursorPos > stringEnd) return null;

      // 检查这个字符串是否是值（不是键）
      // 键后面会有冒号，值后面会有逗号或右括号
      const afterString = lineText.slice(stringEnd + 1).trim();

      // 如果字符串后面紧跟冒号，说明这是键，不是值，跳过
      if (afterString.startsWith(':')) return null;

      // 提取字符串内容
      const rawString = lineText.slice(stringStart + 1, stringEnd);
      // 处理转义字符
      const url = rawString.replace(/\\"/g, '"').replace(/\\\\/g, '\\');

      if (!isImageUrl(url)) return null;

      return {
        pos: from + stringStart,
        end: from + stringEnd + 1,
        above: true,
        create() {
          const dom = document.createElement('div');
          dom.className = 'json-image-tooltip';
          const img = document.createElement('img');
          img.src = url;
          img.style.cssText = 'max-width: 300px; max-height: 200px; border-radius: 6px; box-shadow: 0 2px 12px rgba(0,0,0,0.15);';
          img.onerror = () => {
            dom.innerHTML = '<span style="color: #ef4444; padding: 8px;">图片加载失败</span>';
          };
          dom.appendChild(img);
          return { dom };
        }
      };
    }, { hoverTime: 300 });
  }, [language]);

  const searchPanelExt = useMemo(() => {
    return search({
      literal: true,
      createPanel: (view) => {
        let curQuery = new SearchQuery({ search: "", literal: true });
        let isDragging = false;
        let isResizing = false;
        let dragOffsetX = 0;
        let dragOffsetY = 0;
        let resizeStartX = 0;
        let resizeStartY = 0;
        let resizeStartW = 0;
        let resizeStartH = 0;

        const dom = document.createElement("div");
        dom.className = "floating-search-panel";
        dom.style.position = "fixed";
        dom.style.top = "4px";
        dom.style.right = "16px";
        dom.style.zIndex = "50";
        dom.style.width = "380px";

        const titleBar = document.createElement("div");
        titleBar.className = "fsp-titlebar";

        const titleLeft = document.createElement("div");
        titleLeft.className = "fsp-title-left";

        const titleText = document.createElement("span");
        titleText.className = "fsp-title";
        titleText.textContent = "搜索";

        const countEl = document.createElement("span");
        countEl.className = "fsp-count";
        countEl.textContent = "";

        titleLeft.appendChild(titleText);
        titleLeft.appendChild(countEl);

        const closeBtn = document.createElement("button");
        closeBtn.className = "fsp-close";
        closeBtn.textContent = "×";
        closeBtn.addEventListener("click", () => closeSearchPanel(view));

        titleBar.appendChild(titleLeft);
        titleBar.appendChild(closeBtn);

        titleBar.addEventListener("mousedown", (e) => {
          if ((e.target as HTMLElement).closest("button")) return;
          isDragging = true;
          const rect = dom.getBoundingClientRect();
          dragOffsetX = e.clientX - rect.left;
          dragOffsetY = e.clientY - rect.top;
          e.preventDefault();
        });

        document.addEventListener("mousemove", (e) => {
          if (isDragging) {
            let x = e.clientX - dragOffsetX;
            let y = e.clientY - dragOffsetY;
            x = Math.max(0, Math.min(x, window.innerWidth - dom.offsetWidth));
            y = Math.max(0, Math.min(y, window.innerHeight - dom.offsetHeight));
            dom.style.left = x + "px";
            dom.style.top = y + "px";
            dom.style.right = "auto";
          } else if (isResizing) {
            const dx = e.clientX - resizeStartX;
            const dy = e.clientY - resizeStartY;
            const cursor = document.body.style.cursor;
            if (cursor === "ew-resize") {
              const newW = Math.max(280, Math.min(800, resizeStartW + dx));
              dom.style.width = newW + "px";
            } else if (cursor === "ns-resize") {
              const newH = Math.max(100, Math.min(600, resizeStartH + dy));
              dom.style.height = newH + "px";
            } else {
              const newW = Math.max(280, Math.min(800, resizeStartW + dx));
              const newH = Math.max(100, Math.min(600, resizeStartH + dy));
              dom.style.width = newW + "px";
              dom.style.height = newH + "px";
            }
          }
        });

        document.addEventListener("mouseup", () => {
          isDragging = false;
          isResizing = false;
          document.body.style.cursor = "";
          document.body.style.userSelect = "";
        });

        const searchField = document.createElement("input");
        searchField.value = "";
        searchField.placeholder = "搜索内容";
        searchField.className = "fsp-input";
        // CodeMirror 的 openSearchPanel/selectSearchInput 通过 [main-field] 定位主输入框，
        // 缺少该属性时，面板已打开的情况下再次按下 Mod-f 无法重新聚焦搜索框。
        searchField.setAttribute("main-field", "");
        searchField.setAttribute("name", "search");

        const replaceField = document.createElement("input");
        replaceField.value = "";
        replaceField.placeholder = "替换为";
        replaceField.className = "fsp-input";

        const caseField = document.createElement("input");
        caseField.type = "checkbox";
        caseField.id = "fsp-case";

        const reField = document.createElement("input");
        reField.type = "checkbox";
        reField.id = "fsp-re";

        const wordField = document.createElement("input");
        wordField.type = "checkbox";
        wordField.id = "fsp-word";

        const countMatches = () => {
          if (!curQuery.search) {
            countEl.textContent = "";
            return;
          }
          const cursor = curQuery.getCursor(view.state, 0);
          let count = 0;
          while (!cursor.next().done) {
            count++;
            if (count > 9999) { countEl.textContent = "9999+"; return; }
          }
          countEl.textContent = count > 0 ? `${count}` : "0";
        };

        const commit = () => {
          const newQuery = new SearchQuery({
            search: searchField.value,
            caseSensitive: caseField.checked,
            regexp: reField.checked,
            literal: !reField.checked,
            wholeWord: wordField.checked,
            replace: replaceField.value,
          });
          if (!newQuery.eq(curQuery)) {
            curQuery = newQuery;
            view.dispatch({ effects: setSearchQuery.of(newQuery) });
          }
          countMatches();
        };

        searchField.addEventListener("input", commit);
        replaceField.addEventListener("input", commit);
        caseField.addEventListener("change", commit);
        reField.addEventListener("change", commit);
        wordField.addEventListener("change", commit);

        const mkBtn = (text: string, cls: string, fn: () => void) => {
          const b = document.createElement("button");
          b.className = `fsp-btn ${cls}`;
          b.type = "button";
          b.textContent = text;
          b.addEventListener("click", fn);
          return b;
        };

        const body = document.createElement("div");
        body.className = "fsp-body";

        const row1 = document.createElement("div");
        row1.className = "fsp-row fsp-row-search";
        row1.appendChild(searchField);
        const navBtns = document.createElement("div");
        navBtns.className = "fsp-nav-btns";
        navBtns.appendChild(mkBtn("▲", "fsp-btn-icon", () => findPrevious(view)));
        navBtns.appendChild(mkBtn("▼", "fsp-btn-icon", () => findNext(view)));
        row1.appendChild(navBtns);

        const row2 = document.createElement("div");
        row2.className = "fsp-row fsp-row-replace";
        row2.appendChild(replaceField);
        const replaceBtns = document.createElement("div");
        replaceBtns.className = "fsp-replace-btns";
        replaceBtns.appendChild(mkBtn("替换", "fsp-btn-sm", () => {
          try {
            const tr = view.state.update(view.state.changeByRange((r: any) => ({ range: r, changes: { from: r.from, to: r.to, insert: curQuery.replace } })));
            view.dispatch(tr);
          } catch {}
        }));
        replaceBtns.appendChild(mkBtn("全部", "fsp-btn-sm", () => {
          const cursor = curQuery.getCursor(view.state, 0);
          const changes: any[] = [];
          let m;
          while (!(m = cursor.next()).done) {
            changes.push({ from: m.value.from, to: m.value.to, insert: curQuery.replace });
          }
          if (changes.length) view.dispatch({ changes });
        }));
        row2.appendChild(replaceBtns);

        const row3 = document.createElement("div");
        row3.className = "fsp-row fsp-row-options";

        const mkOpt = (inp: HTMLInputElement, text: string) => {
          const label = document.createElement("label");
          label.className = "fsp-opt";
          label.appendChild(inp);
          label.appendChild(document.createTextNode(text));
          return label;
        };

        const optsLeft = document.createElement("div");
        optsLeft.className = "fsp-opts-left";
        optsLeft.appendChild(mkOpt(caseField, "Aa"));
        optsLeft.appendChild(mkOpt(reField, ".*"));
        optsLeft.appendChild(mkOpt(wordField, "W"));

        row3.appendChild(optsLeft);
        row3.appendChild(mkBtn("全部选中", "fsp-btn-sm", () => selectMatches(view)));

        body.appendChild(row1);
        body.appendChild(row2);
        body.appendChild(row3);

        const resizeHandle = document.createElement("div");
        resizeHandle.className = "fsp-resize";
        resizeHandle.addEventListener("mousedown", (e) => {
          isResizing = true;
          resizeStartX = e.clientX;
          resizeStartY = e.clientY;
          resizeStartW = dom.offsetWidth;
          resizeStartH = dom.offsetHeight;
          document.body.style.cursor = "nwse-resize";
          document.body.style.userSelect = "none";
          e.preventDefault();
          e.stopPropagation();
        });

        const resizeRight = document.createElement("div");
        resizeRight.className = "fsp-resize-edge fsp-resize-r";
        resizeRight.addEventListener("mousedown", (e) => {
          isResizing = true;
          resizeStartX = e.clientX;
          resizeStartY = e.clientY;
          resizeStartW = dom.offsetWidth;
          resizeStartH = dom.offsetHeight;
          document.body.style.cursor = "ew-resize";
          document.body.style.userSelect = "none";
          e.preventDefault();
          e.stopPropagation();
        });

        const resizeBottom = document.createElement("div");
        resizeBottom.className = "fsp-resize-edge fsp-resize-b";
        resizeBottom.addEventListener("mousedown", (e) => {
          isResizing = true;
          resizeStartX = e.clientX;
          resizeStartY = e.clientY;
          resizeStartW = dom.offsetWidth;
          resizeStartH = dom.offsetHeight;
          document.body.style.cursor = "ns-resize";
          document.body.style.userSelect = "none";
          e.preventDefault();
          e.stopPropagation();
        });

        dom.appendChild(titleBar);
        dom.appendChild(body);
        dom.appendChild(resizeHandle);
        dom.appendChild(resizeRight);
        dom.appendChild(resizeBottom);

        setTimeout(() => searchField.focus(), 50);

        return {
          dom,
          destroy() {},
          requestUpdate() { countMatches(); },
        };
      },
    });
  }, []);

  // ===== Markdown 图片粘贴 / 拖入 =====
  const markdownImageContextRef = useRef<{
    tab: EditorTab | undefined;
    location: ImageLocation;
    ensureSaved: () => Promise<string | null>;
  } | null>(null);
  markdownImageContextRef.current = {
    tab: activeTab,
    location: markdownImageLocation,
    ensureSaved: () => handleSaveFile(),
  };

  const buildImageSnippet = (ref: string, altSource: string) => {
    const alt = (altSource || "image")
      .replace(/\.[a-z0-9]+$/i, "")
      .replace(/[[\]\r\n]/g, " ")
      .trim() || "image";
    return `![${alt}](${ref})`;
  };

  const insertSnippet = (view: EditorView, snippet: string) => {
    const sel = view.state.selection.main;
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: snippet },
      selection: { anchor: sel.from + snippet.length },
      scrollIntoView: true,
    });
    view.focus();
  };

  const insertImageReference = (view: EditorView, ref: string, altSource: string) => {
    const sel = view.state.selection.main;
    const selected = view.state.sliceDoc(sel.from, sel.to).trim();
    insertSnippet(view, buildImageSnippet(ref, selected || altSource));
  };

  const resolveMarkdownPath = useCallback(async (): Promise<string | null> => {
    const ctx = markdownImageContextRef.current;
    if (!ctx?.tab) return null;
    if (ctx.tab.path) return ctx.tab.path;
    const saved = await ctx.ensureSaved();
    if (!saved) {
      setStatusMessage("请先保存 Markdown 文件，再插入图片");
      return null;
    }
    return saved;
  }, []);

  const savePastedImage = useCallback(async (file: File): Promise<string | null> => {
    if (file.size > MAX_IMAGE_BYTES) {
      setStatusMessage(`图片过大（${(file.size / 1024 / 1024).toFixed(1)} MB），已取消`);
      return null;
    }
    const mdPath = await resolveMarkdownPath();
    if (!mdPath) return null;
    const ctx = markdownImageContextRef.current;
    const targetDir = imageTargetDir(dirnameOf(mdPath), ctx?.location ?? "sameDir");
    const name = await findAvailableImageName(targetDir, getImageExtension(file.type));
    const bytes = new Uint8Array(await file.arrayBuffer());
    await invoke("save_binary_file", { path: joinPath(targetDir, name), data: Array.from(bytes) });
    return name;
  }, [resolveMarkdownPath]);

  const copyDroppedImage = useCallback(async (srcPath: string): Promise<string | null> => {
    const mdPath = await resolveMarkdownPath();
    if (!mdPath) return null;
    const ctx = markdownImageContextRef.current;
    const targetDir = imageTargetDir(dirnameOf(mdPath), ctx?.location ?? "sameDir");
    const extMatch = srcPath.match(/\.([a-z0-9]+)$/i);
    const ext = (extMatch ? extMatch[1] : "png").toLowerCase();
    const name = await findAvailableImageName(targetDir, ext);
    await invoke("copy_file", { src: srcPath, dest: joinPath(targetDir, name) });
    return name;
  }, [resolveMarkdownPath]);

  const handlePastedImage = useCallback(async (view: EditorView, file: File) => {
    try {
      const name = await savePastedImage(file);
      if (!name) return;
      const ref = toMarkdownRef(name, markdownImageContextRef.current?.location ?? "sameDir");
      try {
        insertImageReference(view, ref, file.name || name);
      } catch {
        // 视图已销毁，忽略插入
        return;
      }
      setStatusMessage(`已插入图片 ${ref}`);
    } catch (error) {
      console.error("粘贴图片失败:", error);
      setStatusMessage("图片保存失败: " + error);
    }
  }, [savePastedImage]);

  const handleDroppedImages = useCallback(async (paths: string[]): Promise<boolean> => {
    const ctx = markdownImageContextRef.current;
    const tab = ctx?.tab;
    if (!tab || tab.language !== "markdown" || tab.isReadOnly || tab.isLargeFile) return false;
    if (!paths.length || !paths.every(isImagePath)) return false;

    const refs: string[] = [];
    for (const srcPath of paths) {
      try {
        const name = await copyDroppedImage(srcPath);
        if (!name) break;
        refs.push(toMarkdownRef(name, ctx?.location ?? "sameDir"));
      } catch (error) {
        console.error("拖入图片失败:", error);
        setStatusMessage("图片复制失败: " + error);
        break;
      }
    }
    if (!refs.length) return true;

    const snippet = refs.map((ref) => buildImageSnippet(ref, ref.split("/").pop() || ref)).join("\n");
    const view = editorViewRef.current;
    if (view) {
      insertSnippet(view, snippet);
    } else {
      const base = (tab.content || "").replace(/\s+$/, "");
      const joiner = base ? "\n\n" : "";
      setTabs((prev) => prev.map((t) => (t.id === tab.id ? { ...t, content: `${base}${joiner}${snippet}\n` } : t)));
    }
    setStatusMessage(`已插入 ${refs.length} 张图片`);
    return true;
  }, [copyDroppedImage]);

  const markdownImageDropRef = useRef(handleDroppedImages);
  markdownImageDropRef.current = handleDroppedImages;

  const markdownImagePasteExtension = useMemo(
    () =>
      EditorView.domEventHandlers({
        paste: (event, view) => {
          const ctx = markdownImageContextRef.current;
          if (!ctx?.tab || ctx.tab.language !== "markdown" || ctx.tab.isReadOnly || ctx.tab.isLargeFile) {
            return false;
          }
          const file = getClipboardImageFile(event.clipboardData);
          if (!file) return false;
          event.preventDefault();
          void handlePastedImage(view, file);
          return true;
        },
      }),
    [handlePastedImage]
  );

  const extensions = useMemo(() => {
    const tabKeymap: KeyBinding[] = [
      {
        key: "Tab",
        run: (view) => {
          const { state } = view;
          const sel = state.selection.main;
          if (sel.from === sel.to) {
            view.dispatch(state.replaceSelection("\t"));
          } else {
            const changes = state.changes({ from: sel.from, to: sel.to, insert: "\t" });
            view.dispatch({
              changes,
              selection: { anchor: sel.from + 1 }
            });
          }
          return true;
        }
      },
      {
        key: "Shift-Tab",
        run: (view) => {
          const { state } = view;
          const sel = state.selection.main;
          const line = state.doc.lineAt(sel.from);
          if (line.text.startsWith("\t")) {
            view.dispatch({
              changes: { from: line.from, to: line.from + 1 }
            });
          }
          return true;
        }
      }
    ];
    const baseExtensions: any[] = [bracketMatching(), rectangularSelection(), searchPanelExt, keymap.of([...tabKeymap, ...searchKeymap])];
    if (wordWrap) {
      baseExtensions.push(EditorView.lineWrapping);
    }
    if (activeTab?.isReadOnly) {
      baseExtensions.push(EditorView.editable.of(false));
    }
    const isHugeFile = activeTab?.isLargeFile && (activeTab?.fileSize || 0) > HUGE_FILE_THRESHOLD;
    if (isHugeFile) {
      return baseExtensions;
    }
    switch (language) {
      case 'markdown': return [...baseExtensions, markdown(), markdownImagePasteExtension];
      case 'javascript': return [...baseExtensions, javascript({ jsx: true, typescript: true })];
      case 'json': {
        const jsonExtensions = [
          ...baseExtensions,
          json(),
          errorMarkerField,
          linter(jsonLinterWithMarkers()),
          lintGutter(),
        ];
        if (jsonImageHoverExtension) {
          jsonExtensions.push(jsonImageHoverExtension);
        }
        return jsonExtensions;
      }
      case 'css': return [...baseExtensions, css()];
      case 'html': return [...baseExtensions, html()];
      case 'python': return [...baseExtensions, python()];
      case 'sql': return [...baseExtensions, sql()];
      case 'java': return [...baseExtensions, java()];
      case 'yaml': return [...baseExtensions, yaml()];
      case 'toml': return [...baseExtensions, toml()];
      case 'bat': return [...baseExtensions, bat()];
      case 'powershell': return [...baseExtensions, powershell()];
      default: return baseExtensions;
    }
  }, [language, wordWrap, jsonImageHoverExtension, markdownImagePasteExtension, activeTab?.isReadOnly, activeTab?.isLargeFile, activeTab?.fileSize]);

  const handleEditorChange = useCallback((val: string) => {
    if (activeTab?.isReadOnly) return;
    const tabId = activeTab.id;
    if (activeTab?.isLargeFile) {
      // 防抖只针对大文件；按 tabId 记录，切换标签后仍写入正确的目标
      const pending = pendingContentRef.current.get(tabId);
      if (pending) {
        clearTimeout(pending.timer);
      }
      const timer = setTimeout(() => {
        const entry = pendingContentRef.current.get(tabId);
        if (entry) {
          pendingContentRef.current.delete(tabId);
          updateTab(tabId, { content: entry.content });
        }
      }, 300);
      pendingContentRef.current.set(tabId, { content: val, timer });
    } else {
      updateTab(tabId, { content: val });
    }
  }, [activeTab, updateTab]);

  const handleRefreshFile = async () => {
    if (!activeTab?.path) return;
    if (activeTab.content !== activeTab.savedContent) {
      const choice = await confirm<"refresh" | "cancel">({
        title: "刷新文件",
        message: "刷新将丢弃当前未保存的修改，并加载磁盘上的最新内容。是否继续？",
        cancelValue: "cancel",
        buttons: [
          { label: "取消", value: "cancel" },
          { label: "刷新", value: "refresh", variant: "danger" },
        ],
      });
      if (choice === "cancel") return;
    }
    try {
      if (activeTab.isReadOnly) {
        const chunkResult: { content: string, start_line: number, end_line: number, total_lines: number, has_more: boolean } = await invoke("load_file_chunk", { path: activeTab.path, startLine: activeTab.chunkStartLine, lineCount: activeTab.chunkEndLine - activeTab.chunkStartLine || CHUNK_LINE_COUNT });
        const meta: { file_size: number, line_count: number, is_large_file: boolean, is_huge_file: boolean } = await invoke("get_file_metadata", { path: activeTab.path });
        updateActiveTab({
          content: chunkResult.content,
          externallyModified: false,
          savedContent: chunkResult.content,
          fileSize: meta.file_size,
          lineCount: meta.line_count || chunkResult.total_lines,
          chunkEndLine: chunkResult.end_line,
          totalLines: chunkResult.total_lines,
          hasMoreChunks: chunkResult.has_more,
        });
      } else {
        const result: { content: string, encoding: string, file_size: number, line_count: number, is_large_file: boolean } = await invoke("load_file", { path: activeTab.path });
        updateActiveTab({
          content: result.content,
          encoding: result.encoding,
          externallyModified: false,
          savedContent: result.content,
          fileSize: result.file_size,
          lineCount: result.line_count,
        });
      }
      setStatusMessage("文件已刷新");
    } catch (error) {
      setStatusMessage("刷新失败: " + error);
    }
  };

  const loadMoreChunks = useCallback(async () => {
    if (!activeTab?.path || activeTab.isLoadingChunk || !activeTab.hasMoreChunks) return;
    updateActiveTab({ isLoadingChunk: true });
    try {
      const chunkResult: { content: string, start_line: number, end_line: number, total_lines: number, has_more: boolean } = await invoke("load_file_chunk", { path: activeTab.path, startLine: activeTab.chunkEndLine, lineCount: CHUNK_LINE_COUNT });
      updateActiveTab({
        content: activeTab.content + "\n" + chunkResult.content,
        chunkEndLine: chunkResult.end_line,
        totalLines: chunkResult.total_lines,
        hasMoreChunks: chunkResult.has_more,
        isLoadingChunk: false,
      });
      setStatusMessage(`已加载到第 ${chunkResult.end_line} 行 / 共 ${chunkResult.total_lines} 行`);
    } catch (error) {
      updateActiveTab({ isLoadingChunk: false });
      setStatusMessage("加载更多内容失败: " + error);
    }
  }, [activeTab]);

  const loadAllChunks = useCallback(async () => {
    if (!activeTab?.path) return;
    const choice = await confirm<"load" | "cancel">({
      title: "加载全部内容",
      message: `将加载全部 ${activeTab.totalLines} 行内容，可能导致卡顿。是否继续？`,
      cancelValue: "cancel",
      buttons: [
        { label: "取消", value: "cancel" },
        { label: "加载全部", value: "load", variant: "primary" },
      ],
    });
    if (choice === "cancel") return;

    try {
      const result: { content: string, encoding: string, file_size: number, line_count: number, is_large_file: boolean } = await invoke("load_file", { path: activeTab.path });
      updateActiveTab({
        content: result.content,
        isReadOnly: false,
        savedContent: result.content,
        fileSize: result.file_size,
        lineCount: result.line_count,
        chunkStartLine: 0,
        chunkEndLine: result.line_count,
        totalLines: result.line_count,
        hasMoreChunks: false,
      });
      setStatusMessage("已加载全部内容");
    } catch (error) {
      setStatusMessage("加载全部内容失败: " + error);
    }
  }, [activeTab, confirm]);

  const jumpToLine = useCallback(async (targetLine: number) => {
    if (!activeTab) return;
    if (!activeTab.isReadOnly) {
      const view = editorViewRef.current;
      if (!view) return;
      const line = view.state.doc.line(Math.min(view.state.doc.lines, Math.max(1, targetLine + 1)));
      view.dispatch({ selection: { anchor: line.from }, scrollIntoView: true });
      view.focus();
      return;
    }
    if (!activeTab.path) return;
    const halfChunk = Math.floor(CHUNK_LINE_COUNT / 2);
    const startLine = Math.max(0, targetLine - halfChunk);
    updateActiveTab({ isLoadingChunk: true });
    try {
      const chunkResult: { content: string, start_line: number, end_line: number, total_lines: number, has_more: boolean } = await invoke("load_file_chunk", { path: activeTab.path, startLine, lineCount: CHUNK_LINE_COUNT });
      updateActiveTab({
        content: chunkResult.content,
        chunkStartLine: chunkResult.start_line,
        chunkEndLine: chunkResult.end_line,
        totalLines: chunkResult.total_lines,
        hasMoreChunks: chunkResult.has_more,
        isLoadingChunk: false,
        isReadOnly: true,
        savedContent: chunkResult.content,
      });
      setStatusMessage(`已跳转到第 ${targetLine} 行附近（${chunkResult.start_line + 1}-${chunkResult.end_line} / ${chunkResult.total_lines}）`);
    } catch (error) {
      updateActiveTab({ isLoadingChunk: false });
      setStatusMessage("跳转失败: " + error);
    }
  }, [activeTab]);

  const reloadWithEncoding = useCallback(async (enc: string) => {
    if (!activeTab?.path) return;
    const pending = flushPendingContent(activeTab.id);
    if (pending !== null) updateTab(activeTab.id, { content: pending });
    const snapshot = pending ?? tabsRef.current.find(tab => tab.id === activeTab.id)?.content;
    if (snapshot !== activeTab.savedContent) {
      setStatusMessage("请先保存修改，再重新选择读取编码");
      return;
    }
    try {
      const result: { content: string, encoding: string, file_size: number, line_count: number, is_large_file: boolean, is_binary: boolean } = await invoke("load_file", { path: activeTab.path, encoding: enc });
      if (pendingContentRef.current.has(activeTab.id) || tabsRef.current.find(tab => tab.id === activeTab.id)?.content !== snapshot) {
        setStatusMessage("读取期间产生了新修改，已取消重新加载");
        return;
      }
      updateTab(activeTab.id, {
        content: result.content,
        encoding: result.encoding,
        fileSize: result.file_size,
        lineCount: result.line_count,
        isBinary: result.is_binary,
        // 重新按编码加载后内容与磁盘一致，同步 savedContent 避免误标为未保存
        savedContent: result.content,
      });
      setStatusMessage(`已以 ${result.encoding} 编码重新加载`);
    } catch (error) {
      setStatusMessage("重新加载失败: " + error);
    }
  }, [activeTab, updateActiveTab]);

  const loadHexData = useCallback(async (_offset: number = 0) => {
    if (!activeTab?.path) return;
    try {
      const result: { hex_rows: { offset: string; hex_values: string[]; ascii: string }[]; total_bytes: number; offset: number; loaded_bytes: number; has_more: boolean } = await invoke("load_binary_hex", { path: activeTab.path, offset: _offset, rowCount: 4096 });
      setHexData(result.hex_rows);
    } catch (error) {
      setStatusMessage("加载十六进制数据失败: " + error);
    }
  }, [activeTab?.path]);

  const handleHexSearch = useCallback(async () => {
    if (!activeTab?.path || !hexSearchPattern) return;
    try {
      const result: { offsets: string[]; total_matches: number } = await invoke("search_binary_pattern", { path: activeTab.path, patternHex: hexSearchPattern, maxResults: 1000 });
      setHexSearchTotal(result.total_matches);
      setStatusMessage(`找到 ${result.total_matches} 个匹配`);
    } catch (error) {
      setStatusMessage("搜索失败: " + error);
    }
  }, [activeTab?.path, hexSearchPattern]);

  useEffect(() => {
    if (displayMode === "hex") {
      loadHexData(0);
    }
  }, [displayMode, loadHexData]);

  const [jumpToLineValue, setJumpToLineValue] = useState<string>("");
  const [showJumpDialog, setShowJumpDialog] = useState(false);

  const handleJumpToLine = useCallback(() => {
    if (!activeTab) return;
    if (activeTab.isReadOnly || activeTab.isLargeFile) {
      setShowJumpDialog(true);
      setJumpToLineValue("");
    }
  }, [activeTab]);

  const executeJumpToLine = useCallback(() => {
    const line = parseInt(jumpToLineValue, 10);
    if (isNaN(line) || line < 1) return;
    void jumpToLine(line - 1);
    setShowJumpDialog(false);
  }, [jumpToLineValue, jumpToLine]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "g") {
        event.preventDefault();
        handleJumpToLine();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleJumpToLine]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void handleSaveFile();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [tabs, activeTabId]);

  useEffect(() => {
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey) {
        event.preventDefault();
        const delta = event.deltaY > 0 ? -1 : 1;
        setFontSize((prev) => Math.min(32, Math.max(8, prev + delta)));
      }
    };
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => window.removeEventListener("wheel", onWheel);
  }, []);

  // 退出确认：三选一（保存并退出 / 不保存退出 / 取消，取消含关闭弹框）
  const askCloseChoice = useCallback((prompt: ClosePrompt): Promise<CloseChoice> => {
    return confirm<CloseChoice>({
      title: prompt.title,
      message: prompt.message,
      cancelValue: "cancel",
      buttons: [
        { label: "取消", value: "cancel" },
        { label: "不保存退出", value: "discard", variant: "danger" },
        { label: "保存并退出", value: "save", variant: "primary" },
      ],
    });
  }, [confirm]);

  // 窗口关闭保护：存在未保存修改时先确认
  useEffect(() => {
    const unlisten = getCurrentWindow().onCloseRequested(async (event) => {
      try {
        await handleCloseRequest(event, {
          dirtyTabs: tabsRef.current.filter((tab) => tab.content !== tab.savedContent),
          ask: askCloseChoice,
          saveTab: (tab) => handleSaveFile(tab),
          destroy: async () => {
            const win = getCurrentWindow();
            try {
              await win.destroy();
            } catch (error) {
              console.error("Failed to destroy window, falling back to close:", error);
              await win.close();
            }
          },
          onStatus: setStatusMessage,
        });
      } catch (error) {
        event.preventDefault();
        const message = error instanceof Error ? error.message : String(error);
        setStatusMessage(`退出失败：${message}`);
        console.error("Close request failed:", error);
      }
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [askCloseChoice]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey) {
        if (event.key === "=" || event.key === "+") {
          event.preventDefault();
          setFontSize((prev) => Math.min(32, prev + 1));
        } else if (event.key === "-") {
          event.preventDefault();
          setFontSize((prev) => Math.max(8, prev - 1));
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // 监听系统主题变化
  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => {
      setSystemTheme(e.matches ? "dark" : "light");
    };
    mediaQuery.addEventListener("change", handler);
    return () => mediaQuery.removeEventListener("change", handler);
  }, []);

  // 应用主题到 document
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", currentTheme);
    localStorage.setItem("themeMode", themeMode);
  }, [currentTheme, themeMode]);

  // 持久化 Markdown 预览主题
  useEffect(() => {
    localStorage.setItem("markdownTheme", markdownTheme);
  }, [markdownTheme]);

  // 持久化 Markdown 图片存放位置
  useEffect(() => {
    localStorage.setItem("markdownImageLocation", markdownImageLocation);
  }, [markdownImageLocation]);

  // 初始化外部插件系统
  useEffect(() => {
    initializeExternalPlugins()
      .then(() => {
        console.log("[App] External plugins initialized");
        // 监听插件目录，实现插件热重载
        setupPluginWatcher().catch((err) => {
          console.warn("[App] Failed to setup plugin watcher:", err);
        });
      })
      .catch((err) => {
        console.warn("[App] Failed to initialize external plugins:", err);
      });
  }, []);

  // 加载缓存文件（应用启动时）
  useEffect(() => {
    const loadCacheFiles = async () => {
      try {
        const cacheFiles: CacheFileInfo[] = await invoke("get_all_cache_files");
        if (cacheFiles.length > 0) {
          setTabs((prev) => {
            // 过滤掉初始空标签
            const existingTabs = prev.filter(tab => tab.content.length > 0 || tab.path);
            const cacheTabs: EditorTab[] = cacheFiles.map((cache) => {
              const lineCount = cache.content.split('\n').length;
              return {
                id: cache.id,
                title: cache.title,
                path: null,
                content: cache.content,
                encoding: "UTF-8",
                language: cache.language,
                externallyModified: false,
                savedContent: "",
                fileSize: new Blob([cache.content]).size,
                lineCount,
                isLargeFile: false,
                isReadOnly: false,
                chunkStartLine: 0,
                chunkEndLine: lineCount,
                totalLines: lineCount,
                hasMoreChunks: false,
                isLoadingChunk: false,
                isBinary: false,
                revision: null,
                bom: false,
              };
            });
            // 如果没有现有标签，使用缓存标签
            if (existingTabs.length === 0 && cacheTabs.length > 0) {
              setActiveTabId(cacheTabs[0].id);
              return cacheTabs;
            }
            // 否则追加缓存标签
            return [...existingTabs, ...cacheTabs];
          });
          setStatusMessage(`已恢复 ${cacheFiles.length} 个未保存的文件`);
        }
      } catch (error) {
        console.error("Failed to load cache files:", error);
      }
    };
    void loadCacheFiles();
  }, []);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;

    const setupOpenFileBridge = async () => {
      try {
        const startupFile = await invoke<string | null>("take_launch_file_path");
        if (startupFile) {
          await openFileByPath(startupFile);
        }
      } catch (error) {
        setStatusMessage("启动文件加载失败: " + error);
      }

      unlisten = await listen<string>("open-file", async (event) => {
        if (!event.payload) return;
        try {
          await openFileByPath(event.payload);
        } catch (error) {
          setStatusMessage("打开失败: " + error);
        }
      });

      const unlistenDragDrop = await listen<{ paths: string[] }>("tauri://drag-drop", async (event) => {
        setIsDragOver(false);
        const paths = event.payload?.paths ?? [];
        if (!paths.length) return;
        // Markdown 标签下拖入图片：落盘并插入引用，而不是打开文件
        const handledAsImage = await markdownImageDropRef.current?.(paths);
        if (handledAsImage) return;
        for (const filePath of paths) {
          try {
            await openFileByPath(filePath);
          } catch (error) {
            setStatusMessage("打开失败: " + error);
          }
        }
      });

      const unlistenDragEnter = await listen("tauri://drag-enter", () => {
        setIsDragOver(true);
      });

      const unlistenDragLeave = await listen("tauri://drag-leave", () => {
        setIsDragOver(false);
      });

      // 窗口准备完成，显示窗口
      try {
        await getCurrentWindow().show();
      } catch {
        // 开发环境下可能失败，忽略
      }

      return { drop: unlistenDragDrop, enter: unlistenDragEnter, leave: unlistenDragLeave };
    };

    let unlistenDragDrop: UnlistenFn | undefined;
    let unlistenDragEnter: UnlistenFn | undefined;
    let unlistenDragLeave: UnlistenFn | undefined;
    void setupOpenFileBridge().then((fns) => {
      unlistenDragDrop = fns?.drop;
      unlistenDragEnter = fns?.enter;
      unlistenDragLeave = fns?.leave;
    });
    return () => {
      if (unlisten) {
        unlisten();
      }
      if (unlistenDragDrop) unlistenDragDrop();
      if (unlistenDragEnter) unlistenDragEnter();
      if (unlistenDragLeave) unlistenDragLeave();
    };
  }, [openFileByPath]);

  // 监听文件变化事件
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;

    const setupFileChangeListener = async () => {
      unlisten = await listen<{ path: string; changeType: string }>("file-changed", (event) => {
        const { path } = event.payload;
        setTabs((prev) => {
          return prev.map((tab) => {
            if (isSamePath(tab.path, path)) {
              return { ...tab, externallyModified: true };
            }
            return tab;
          });
        });
      });
    };

    void setupFileChangeListener();
    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  
  useEffect(() => {
    setCursorLine(1);
    setCursorCol(1);
    cursorOffsetRef.current = 0;
  }, [activeTabId]);

  useEffect(() => {
    if (viewMode === "preview") {
      return;
    }

    const editorPane = editorPaneRef.current;
    const floatingScroll = floatingScrollRef.current;
    const floatingScrollContent = floatingScrollContentRef.current;
    if (!editorPane || !floatingScroll || !floatingScrollContent) {
      return;
    }

    let rafId = 0;
    let resizeObserver: ResizeObserver | null = null;
    let mutationObserver: MutationObserver | null = null;
    let cleanupScrollEvents: (() => void) | null = null;
    let syncingFromEditor = false;
    let syncingFromFloating = false;

    const applyWithScroller = (scroller: HTMLElement) => {
      cleanupScrollEvents?.();

      const syncMetrics = () => {
        const needHorizontalScroll = scroller.scrollWidth - scroller.clientWidth > 1;
        floatingScrollContent.style.width = `${scroller.scrollWidth}px`;
        floatingScroll.style.display = needHorizontalScroll ? "block" : "none";
        if (needHorizontalScroll) {
          floatingScroll.scrollLeft = scroller.scrollLeft;
        }
      };

      const onEditorScroll = () => {
        if (syncingFromFloating) {
          return;
        }
        syncingFromEditor = true;
        floatingScroll.scrollLeft = scroller.scrollLeft;
        syncingFromEditor = false;
      };

      const onFloatingScroll = () => {
        if (syncingFromEditor) {
          return;
        }
        syncingFromFloating = true;
        scroller.scrollLeft = floatingScroll.scrollLeft;
        syncingFromFloating = false;
      };

      scroller.addEventListener("scroll", onEditorScroll, { passive: true });
      floatingScroll.addEventListener("scroll", onFloatingScroll, { passive: true });

      resizeObserver?.disconnect();
      resizeObserver = new ResizeObserver(syncMetrics);
      resizeObserver.observe(scroller);
      resizeObserver.observe(editorPane);

      syncMetrics();
      rafId = requestAnimationFrame(syncMetrics);

      cleanupScrollEvents = () => {
        scroller.removeEventListener("scroll", onEditorScroll);
        floatingScroll.removeEventListener("scroll", onFloatingScroll);
      };
    };

    const bindScroller = () => {
      const scroller = editorPane.querySelector(".cm-scroller");
      if (!(scroller instanceof HTMLElement)) {
        floatingScroll.style.display = "none";
        return;
      }
      applyWithScroller(scroller);
    };

    mutationObserver = new MutationObserver(bindScroller);
    mutationObserver.observe(editorPane, { childList: true, subtree: true });
    bindScroller();

    return () => {
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
      cleanupScrollEvents?.();
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
    };
  }, [viewMode, activeTabId, content, fontSize, fontFamily]);

  const editorStyle = {
    "--editor-font-size": `${fontSize}px`,
    "--editor-font-family": fontFamily,
  } as CSSProperties;
  const zoomPercent = Math.round((fontSize / 15) * 100);

  const closeTab = async (tabId: string) => {
    const currentTabs = tabsRef.current;
    let tabToClose = currentTabs.find((tab) => tab.id === tabId);
    if (!tabToClose) return;

    // 先把未提交的防抖内容合并进来，避免关闭时误判为"无未保存修改"
    const pendingContent = flushPendingContent(tabId);
    if (pendingContent !== null) {
      tabToClose = { ...tabToClose, content: pendingContent };
      updateTab(tabId, { content: pendingContent });
    }

    // 检查是否有未保存的修改
    const hasUnsavedChanges = tabToClose.content !== tabToClose.savedContent;
    let savedByUser = false;
    if (hasUnsavedChanges) {
      const choice = await confirm<"save" | "discard" | "cancel">({
        title: "未保存的修改",
        message: `文件 "${tabToClose.title}" 有未保存的修改，是否保存？`,
        cancelValue: "cancel",
        buttons: [
          { label: "取消", value: "cancel" },
          { label: "不保存", value: "discard", variant: "danger" },
          { label: "保存", value: "save", variant: "primary" },
        ],
      });
      // 取消 / 关闭弹框：保留标签，不关闭
      if (choice === "cancel") return;
      if (choice === "save") {
        // 直接把要关闭的标签传给保存函数，避免依赖 activeTabId 而保存错标签
        const savedPath = await handleSaveFile(tabToClose);
        if (!savedPath) return;
        const latestPending = flushPendingContent(tabId);
        if (latestPending !== null) updateTab(tabId, { content: latestPending });
        const latestTab = tabsRef.current.find((tab) => tab.id === tabId);
        if (!latestTab || latestTab.content !== latestTab.savedContent) {
          setStatusMessage("保存期间产生了新修改，标签已保留");
          return;
        }
        savedByUser = true;
      }
    }
    // 未保存（或用户选择不保存）时删除缓存文件
    if (!savedByUser) {
      try {
        await invoke("delete_cache_file", { id: tabId });
      } catch (error) {
        console.error("Failed to delete cache:", error);
      }
    }

    // 如果关闭的标签页有文件路径，检查是否需要停止监听
    if (tabToClose.path) {
      const otherTabsWithPath = currentTabs.filter(
        (tab) => tab.id !== tabId && isSamePath(tab.path, tabToClose.path)
      );
      // 如果没有其他标签页打开同一文件，停止监听
      if (otherTabsWithPath.length === 0) {
        try {
          await invoke("unwatch_file", { path: tabToClose.path });
        } catch (error) {
          console.error("Failed to unwatch file:", error);
        }
      }
    }

    setTabs((prev) => {
      if (prev.length === 1) {
        const only = prev[0];
        const replacement: EditorTab = {
          id: only.id,
          title: "Untitled1",
          path: null,
          content: "",
          encoding: "UTF-8",
          language: "text",
          externallyModified: false,
          savedContent: "",
          fileSize: 0,
          lineCount: 0,
          isLargeFile: false,
          isReadOnly: false,
          chunkStartLine: 0,
          chunkEndLine: 0,
          totalLines: 0,
          hasMoreChunks: false,
          isLoadingChunk: false,
          isBinary: false,
          revision: null,
          bom: false,
        };
        setActiveTabId(replacement.id);
        return [replacement];
      }
      const index = prev.findIndex((tab) => tab.id === tabId);
      const nextTabs = prev.filter((tab) => tab.id !== tabId);
      if (tabId === activeTabId) {
        const nextActive = nextTabs[Math.max(0, index - 1)];
        if (nextActive) {
          setActiveTabId(nextActive.id);
        }
      }
      return nextTabs;
    });
  };

  const createNewTab = useCallback(() => {
    const newId = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const untitledNumber = tabs.filter(t => !t.path).length + 1;
    const newTab: EditorTab = {
      id: newId,
      title: `Untitled${untitledNumber}`,
      path: null,
      content: "",
      encoding: "UTF-8",
      language: "text",
      externallyModified: false,
      savedContent: "",
      fileSize: 0,
      lineCount: 0,
      isLargeFile: false,
      isReadOnly: false,
      chunkStartLine: 0,
      chunkEndLine: 0,
      totalLines: 0,
      hasMoreChunks: false,
      isLoadingChunk: false,
      isBinary: false,
      revision: null,
      bom: false,
    };
    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newId);
    setStatusMessage("新建文件");
  }, [tabs]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n") {
        event.preventDefault();
        createNewTab();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [createNewTab]);

  // 快捷键 Ctrl+W 关闭当前标签页
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "w") {
        event.preventDefault();
        void closeTab(activeTabId);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeTabId]);

  const [isDragOver, setIsDragOver] = useState(false);
  const [showFeatureGuide, setShowFeatureGuide] = useState(false);
  const cursorOffsetRef = useRef(0);

  const insertFeatureSnippet = useCallback((snippet: string) => {
    if (activeTab?.isReadOnly) {
      setStatusMessage("只读模式下无法插入示例");
      return;
    }

    if (!activeTab) {
      const newId = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const content = `${snippet}\n`;
      const lineCount = content.split("\n").length;
      setTabs((prev) => [
        ...prev,
        {
          id: newId,
          title: "增强功能示例",
          path: null,
          content,
          encoding: "UTF-8",
          language: "markdown",
          externallyModified: false,
          savedContent: "",
          fileSize: new Blob([content]).size,
          lineCount,
          isLargeFile: false,
          isReadOnly: false,
          chunkStartLine: 0,
          chunkEndLine: lineCount,
          totalLines: lineCount,
          hasMoreChunks: false,
          isLoadingChunk: false,
          isBinary: false,
          revision: null,
          bom: false,
        },
      ]);
      setActiveTabId(newId);
      setViewMode("split");
      setShowFeatureGuide(false);
      setStatusMessage("已创建示例文件，切换到分屏/预览模式查看效果");
      return;
    }

    const pos = Math.min(Math.max(cursorOffsetRef.current, 0), content.length);
    const before = content.slice(0, pos);
    const after = content.slice(pos);
    const prefix = before.length === 0 || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
    const suffix = after.length === 0 || after.startsWith("\n") ? "" : "\n";
    const next = `${before}${prefix}${snippet}${suffix}${after}`;

    const patch: Partial<EditorTab> = { content: next };
    if (language !== "markdown") {
      patch.language = "markdown";
      setViewMode("split");
    }
    updateActiveTab(patch);
    setShowFeatureGuide(false);
    setStatusMessage("已插入示例，切换到分屏/预览模式查看效果");
  }, [activeTab, content, language, updateActiveTab]);

  useEffect(() => {
    if (!showFeatureGuide) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setShowFeatureGuide(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showFeatureGuide]);

  return (
    <div className={`app-container${isDragOver ? " drag-over" : ""}`}>
      <div className="toolbar">
        <div className="file-controls">
          <button className="icon-button" onClick={createNewTab} title="新建文件 (Ctrl+N)" aria-label="新建文件">📄</button>
          <button className="icon-button" onClick={handleOpenFile} title="打开文件" aria-label="打开文件">📂</button>
          {language === 'json' && (
            <>
              <button className="icon-button" onClick={handleFormatJson} title="美化 JSON" aria-label="美化 JSON">✨</button>
              <button className="icon-button" onClick={handleMinifyJson} title="压缩 JSON" aria-label="压缩 JSON">⊟</button>
            </>
          )}
          <button
            className={`icon-button ${wordWrap ? 'active' : ''}`}
            onClick={() => setWordWrap(!wordWrap)}
            title={wordWrap ? "关闭自动换行" : "开启自动换行"}
            aria-label={wordWrap ? "关闭自动换行" : "开启自动换行"}
          >↩</button>
          <button
            className={`icon-button ${showFeatureGuide ? 'active' : ''}`}
            onClick={() => setShowFeatureGuide(true)}
            title="增强功能图鉴"
            aria-label="增强功能图鉴"
          >🧩</button>
        </div>
        
        <div className="view-controls">
          <div className="icon-field">
            <select value={fontFamily} onChange={(e) => setFontFamily(e.target.value)}>
              <optgroup label="等宽字体">
                <option value="Consolas">Consolas</option>
                <option value="Cascadia Mono">Cascadia Mono</option>
                <option value="Source Code Pro">Source Code Pro</option>
                <option value="Fira Code">Fira Code</option>
                <option value="JetBrains Mono">JetBrains Mono</option>
                <option value="Monaco">Monaco</option>
                <option value="Menlo">Menlo</option>
              </optgroup>
              <optgroup label="中文字体">
                <option value="Microsoft YaHei UI">微软雅黑</option>
                <option value="SimSun">宋体</option>
                <option value="SimHei">黑体</option>
                <option value="KaiTi">楷体</option>
                <option value="FangSong">仿宋</option>
              </optgroup>
              <optgroup label="其他字体">
                <option value="Arial">Arial</option>
                <option value="Times New Roman">Times New Roman</option>
                <option value="Georgia">Georgia</option>
              </optgroup>
            </select>
            <select value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))}>
              <option value={12}>12</option>
              <option value={13}>13</option>
              <option value={14}>14</option>
              <option value={15}>15</option>
              <option value={16}>16</option>
              <option value={18}>18</option>
              <option value={20}>20</option>
              <option value={24}>24</option>
            </select>
          </div>

          <select value={language} onChange={(e) => updateActiveTab({ language: e.target.value })}>
            <option value="text">Plain Text</option>
            <option value="markdown">Markdown</option>
            <option value="javascript">JavaScript/TypeScript</option>
            <option value="json">JSON</option>
            <option value="yaml">YAML</option>
            <option value="toml">TOML</option>
            <option value="bat">BAT/CMD</option>
            <option value="powershell">PowerShell</option>
            <option value="css">CSS</option>
            <option value="html">HTML</option>
            <option value="python">Python</option>
            <option value="sql">SQL</option>
            <option value="java">Java</option>
          </select>

          {language === 'markdown' && (
            <>
              <div className="mode-toggle">
                <button
                  className={`mode-icon-button ${viewMode === 'edit' ? 'active' : ''}`}
                  title="编辑模式"
                  aria-label="编辑模式"
                  onClick={() => setViewMode('edit')}
                >
                  ✎
                </button>
                <button
                  className={`mode-icon-button ${viewMode === 'split' ? 'active' : ''}`}
                  title="分屏模式"
                  aria-label="分屏模式"
                  onClick={() => setViewMode('split')}
                >
                  ◫
                </button>
                <button
                  className={`mode-icon-button ${viewMode === 'preview' ? 'active' : ''}`}
                  title="预览模式"
                  aria-label="预览模式"
                  onClick={() => setViewMode('preview')}
                >
                  👁
                </button>
              </div>
              <div className="icon-field">
                <select
                  className="markdown-theme-select"
                  value={markdownTheme}
                  onChange={(e) => setMarkdownTheme(e.target.value as MarkdownTheme)}
                  title="Markdown 预览主题"
                  aria-label="Markdown 预览主题"
                >
                  <option value="default">默认主题</option>
                  <option value="aicloud">AI 云主题</option>
                </select>
              </div>
              <div className="icon-field">
                <select
                  className="markdown-image-location-select"
                  value={markdownImageLocation}
                  onChange={(e) => setMarkdownImageLocation(e.target.value as ImageLocation)}
                  title="粘贴/拖入图片的存放位置"
                  aria-label="图片存放位置"
                >
                  <option value="sameDir">图片:同目录</option>
                  <option value="assets">图片:assets</option>
                </select>
              </div>
            </>
          )}

          <div className="theme-toggle" role="group" aria-label="主题切换">
            <span className="theme-toggle__indicator" data-active={themeMode} />
            <button
              aria-label="系统主题"
              title="系统主题"
              className={`theme-toggle__button ${themeMode === 'system' ? 'active' : ''}`}
              aria-pressed={themeMode === 'system'}
              onClick={() => setThemeMode('system')}
            >
              <svg className="theme-icon" viewBox="0 0 24 24" aria-hidden="true">
                <rect width="20" height="14" x="2" y="5" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5"/>
                <line x1="8" x2="16" y1="21" y2="21" stroke="currentColor" strokeWidth="1.5"/>
                <line x1="12" x2="12" y1="19" y2="21" stroke="currentColor" strokeWidth="1.5"/>
              </svg>
            </button>
            <button
              aria-label="亮色主题"
              title="亮色主题"
              className={`theme-toggle__button ${themeMode === 'light' ? 'active' : ''}`}
              aria-pressed={themeMode === 'light'}
              onClick={() => setThemeMode('light')}
            >
              <svg className="theme-icon" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M12 2v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                <path d="M12 20v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                <path d="m4.93 4.93 1.41 1.41" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                <path d="m17.66 17.66 1.41 1.41" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                <path d="M2 12h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                <path d="M20 12h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                <path d="m6.34 17.66-1.41 1.41" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                <path d="m19.07 4.93-1.41 1.41" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
            <button
              aria-label="暗色主题"
              title="暗色主题"
              className={`theme-toggle__button ${themeMode === 'dark' ? 'active' : ''}`}
              aria-pressed={themeMode === 'dark'}
              onClick={() => setThemeMode('dark')}
            >
              <svg className="theme-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401" fill="none" stroke="currentColor" strokeWidth="1.5"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
      <div className="tab-bar">
        {tabs.map((tab) => {
          const isDirty = tab.content !== tab.savedContent;
          return (
            <button
              key={tab.id}
              className={`tab-item ${tab.id === activeTabId ? "active" : ""} ${tab.externallyModified ? "modified-externally" : ""} ${isDirty ? "unsaved" : ""}`}
              onClick={() => { setActiveTabId(tab.id); setDisplayMode("text"); }}
              title={tab.path || tab.title}
            >
              {tab.externallyModified && <span className="modified-indicator">⚠</span>}
              {isDirty && !tab.externallyModified && <span className="unsaved-indicator">●</span>}
              <span className="tab-title">{tab.title}</span>
              <span
                className="tab-close"
                onClick={(event) => {
                  event.stopPropagation();
                  void closeTab(tab.id);
                }}
              >
                ×
              </span>
            </button>
          );
        })}
        <button
          className="tab-item tab-add"
          onClick={createNewTab}
          title="新建文件 (Ctrl+N)"
          aria-label="新建文件"
        >
          +
        </button>
      </div>

      {activeTab?.externallyModified && (
        <div className="file-change-notification">
          <span>文件 "{activeTab.title}" 已在外部被修改</span>
          <button onClick={handleRefreshFile}>刷新</button>
          <button onClick={() => updateActiveTab({ externallyModified: false })}>忽略</button>
        </div>
      )}

      {activeTab?.isLargeFile && (
        <div className="large-file-notification">
          <span>
            {activeTab.isReadOnly ? (
              <>
                🔒 只读模式 — {formatFileSize(activeTab.fileSize)}，显示第 {activeTab.chunkStartLine + 1}-{activeTab.chunkEndLine} 行 / 共 {activeTab.totalLines} 行
              </>
            ) : (
              <>📦 大文件 — {formatFileSize(activeTab.fileSize)}，{activeTab.lineCount} 行</>
            )}
          </span>
          {activeTab.isReadOnly && (
            <div className="large-file-actions">
              {activeTab.hasMoreChunks && (
                <button onClick={() => void loadMoreChunks()} disabled={activeTab.isLoadingChunk}>
                  {activeTab.isLoadingChunk ? "加载中..." : "加载更多"}
                </button>
              )}
              <button onClick={() => void loadAllChunks()}>加载全部</button>
              <button onClick={handleJumpToLine}>跳转到行 (Ctrl+G)</button>
            </div>
          )}
          {!activeTab.isReadOnly && (
            <div className="large-file-actions">
              <button onClick={handleJumpToLine}>跳转到行 (Ctrl+G)</button>
            </div>
          )}
        </div>
      )}

      <FeatureGuide
        open={showFeatureGuide}
        onClose={() => setShowFeatureGuide(false)}
        onInsert={insertFeatureSnippet}
        insertDisabled={Boolean(activeTab?.isReadOnly)}
      />

      {showJumpDialog && (
        <div className="jump-dialog-overlay" onClick={() => setShowJumpDialog(false)}>
          <div className="jump-dialog" onClick={(e) => e.stopPropagation()}>
            <label>跳转到行号 (1 - {activeTab?.totalLines || activeTab?.lineCount}):</label>
            <input
              type="number"
              min={1}
              max={activeTab?.totalLines || activeTab?.lineCount}
              value={jumpToLineValue}
              onChange={(e) => setJumpToLineValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") executeJumpToLine();
                if (e.key === "Escape") setShowJumpDialog(false);
              }}
              autoFocus
            />
            <div className="jump-dialog-buttons">
              <button onClick={executeJumpToLine}>跳转</button>
              <button onClick={() => setShowJumpDialog(false)}>取消</button>
            </div>
          </div>
        </div>
      )}

      {confirmRequest && (
        <div className="jump-dialog-overlay" onClick={() => resolveConfirm(confirmRequest.cancelValue)}>
          <div
            className="jump-dialog app-confirm"
            role="dialog"
            aria-modal="true"
            aria-label={confirmRequest.title}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="app-confirm-title">{confirmRequest.title}</h3>
            <p className="app-confirm-message">{confirmRequest.message}</p>
            <div className="jump-dialog-buttons app-confirm-buttons">
              {confirmRequest.buttons.map((button) => (
                <button
                  key={button.label}
                  className={button.variant && button.variant !== "default" ? button.variant : undefined}
                  autoFocus={button.variant === "primary"}
                  onClick={() => resolveConfirm(button.value)}
                >
                  {button.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 欢迎页面 */}
      {tabs.length === 0 && (
        <div className="welcome-page">
          <div className="welcome-content">
            <h1>Lite Code Editor</h1>
            <p className="welcome-subtitle">轻量级代码编辑器</p>

            <div className="welcome-actions">
              <button className="welcome-btn primary" onClick={createNewTab}>
                <span className="btn-icon">📄</span>
                新建文件
              </button>
              <button className="welcome-btn" onClick={handleOpenFile}>
                <span className="btn-icon">📂</span>
                打开文件
              </button>
            </div>

            <div className="welcome-section">
              <h3>快捷键</h3>
              <div className="shortcuts-grid">
                <div className="shortcut"><kbd>Ctrl+N</kbd><span>新建文件</span></div>
                <div className="shortcut"><kbd>Ctrl+O</kbd><span>打开文件</span></div>
                <div className="shortcut"><kbd>Ctrl+S</kbd><span>保存文件</span></div>
                <div className="shortcut"><kbd>Ctrl+W</kbd><span>关闭标签</span></div>
                <div className="shortcut"><kbd>Ctrl+滚轮</kbd><span>缩放字体</span></div>
                <div className="shortcut"><kbd>Ctrl+/-</kbd><span>调整字体</span></div>
              </div>
            </div>

            <div className="welcome-section">
              <h3>特性</h3>
              <ul className="features-list">
                <li>支持 Markdown 实时预览（标准/增强模式）</li>
                <li>支持多种编程语言语法高亮</li>
                <li>文件外部修改检测</li>
                <li>算法可视化组件支持</li>
                <li>脑图可视化支持</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* 编辑器区域 */}
      {tabs.length > 0 && (
        <>
        {displayMode === "hex" ? (
          <div className="hex-viewer">
            <div className="hex-container">
              <div className="hex-toolbar">
                <span className="hex-info">{activeTab.path} — {formatFileSize(activeTab.fileSize)}</span>
                <input className="hex-search-input" placeholder="搜索十六进制..." value={hexSearchPattern} onChange={(e) => setHexSearchPattern(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleHexSearch()} />
                <button onClick={handleHexSearch}>搜索</button>
                {hexSearchTotal > 0 && <span className="hex-search-count">{hexSearchTotal} 匹配</span>}
              </div>
              <div className="hex-content">
                <table className="hex-table">
                  <thead>
                    <tr>
                      <th className="hex-offset-col">Offset</th>
                      {Array.from({ length: 16 }, (_, i) => <th key={i} className="hex-byte-col">{i.toString(16).toUpperCase().padStart(2, "0")}</th>)}
                      <th className="hex-ascii-col">ASCII</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hexData.map((row, idx) => (
                      <tr key={idx}>
                        <td className="hex-offset-col">{row.offset}</td>
                        {row.hex_values.map((hex, byteIdx) => (
                          <td key={byteIdx} className="hex-byte-col">{hex}</td>
                        ))}
                        {row.hex_values.length < 16 && Array.from({ length: 16 - row.hex_values.length }, (_, i) => <td key={`pad-${i}`} className="hex-byte-col"></td>)}
                        <td className="hex-ascii-col">{row.ascii}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : (
        <div className={`editor-area mode-${language === 'markdown' ? viewMode : 'edit'}`} style={editorStyle}>
        {(language !== 'markdown' || viewMode === 'edit' || viewMode === 'split') && (
          <div className="editor-pane" ref={editorPaneRef}>
            <CodeMirror
              value={content}
              height="100%"
              extensions={extensions}
              onChange={handleEditorChange}
              onCreateEditor={(view) => {
                editorViewRef.current = view;
              }}
              onUpdate={(viewUpdate) => {
                const head = viewUpdate.state.selection.main.head;
                cursorOffsetRef.current = head;
                const line = viewUpdate.state.doc.lineAt(head);
                setCursorLine(line.number);
                setCursorCol(head - line.from + 1);
              }}
              theme={currentTheme === "dark" ? oneDark : "light"}
            />
          </div>
        )}

        {language === 'markdown' && (viewMode === 'preview' || viewMode === 'split') && (
          <div className={`preview-pane markdown-body markdown-theme-${markdownTheme}`}>
            <div className="preview-main">
              <PreviewEngine
                ref={previewEngineRef}
                content={content}
                currentFilePath={filePath}
              />
            </div>
            <Toc
              content={content}
              getPreviewContainer={() => previewEngineRef.current?.getContainer() ?? null}
            />
          </div>
        )}
      </div>
        )}
      <div className={`floating-h-scroll mode-${language === 'markdown' ? viewMode : 'edit'}`} ref={floatingScrollRef} aria-hidden="true">
        <div className="floating-h-scroll-content" ref={floatingScrollContentRef} />
      </div>
      <div className="status-bar">
        <div className="status-left">
          <div className="status-segment status-path" title={filePath || "Untitled"}>
            <span className="file-path">{filePath || "Untitled"}</span>
          </div>
          {activeTab?.fileSize > 0 && (
            <div className="status-segment status-filesize">{formatFileSize(activeTab.fileSize)}</div>
          )}
          <div className="status-segment status-encoding">
            <select value={displayMode === "hex" ? "hex" : encoding} onChange={(e) => {
               const newEnc = e.target.value;
               if (newEnc === "hex") {
                 setDisplayMode("hex");
               } else {
                 setDisplayMode("text");
                 if (activeTab?.path) void reloadWithEncoding(newEnc);
                 else updateActiveTab({ encoding: newEnc });
               }
             }}>
                <option value="UTF-8">UTF-8</option>
                <option value="UTF-16LE">UTF-16LE</option>
                <option value="UTF-16BE">UTF-16BE</option>
                <option value="GBK">GBK</option>
                <option value="GB18030">GB18030</option>
                <option value="Big5">Big5</option>
                <option value="hex">十六进制</option>
            </select>
          </div>
          <div className="status-segment status-message" title={statusMessage}>{statusMessage}</div>
        </div>
        <div className="status-right">
          <div className="status-segment status-readout">Ln {cursorLine}, Col {cursorCol}</div>
          <div className="status-segment status-readout">{zoomPercent}%</div>
        </div>
      </div>
      </>
      )}
    </div>
  );
}

export default App;
