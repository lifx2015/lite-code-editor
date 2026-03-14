import { CSSProperties, useCallback, useEffect, useRef, useState, lazy, Suspense } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import CodeMirror from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { rectangularSelection } from "@codemirror/view";
import remarkGfm from "remark-gfm";
import "./App.css";

// 懒加载 ReactMarkdown 预览组件，提升启动速度
const ReactMarkdown = lazy(() => import("react-markdown"));

type EditorTab = {
  id: string;
  title: string;
  path: string | null;
  content: string;
  encoding: string;
  language: string;
};

function App() {
  const [tabs, setTabs] = useState<EditorTab[]>([
    { id: "tab-initial", title: "Untitled1", path: null, content: "", encoding: "UTF-8", language: "markdown" }
  ]);
  const [activeTabId, setActiveTabId] = useState<string>("tab-initial");
  const [viewMode, setViewMode] = useState<"edit" | "preview" | "split">("edit");
  const [fontFamily, setFontFamily] = useState<string>("Consolas");
  const [fontSize, setFontSize] = useState<number>(15);
  const [cursorLine, setCursorLine] = useState<number>(1);
  const [cursorCol, setCursorCol] = useState<number>(1);
  const [statusMessage, setStatusMessage] = useState<string>("就绪");
  const editorPaneRef = useRef<HTMLDivElement | null>(null);
  const floatingScrollRef = useRef<HTMLDivElement | null>(null);
  const floatingScrollContentRef = useRef<HTMLDivElement | null>(null);

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
  const content = activeTab?.content ?? "";
  const filePath = activeTab?.path ?? null;
  const encoding = activeTab?.encoding ?? "UTF-8";
  const language = activeTab?.language ?? "text";

  const detectLanguageByPath = (path: string) => {
    if (path.endsWith(".md")) return "markdown";
    if (path.endsWith(".js") || path.endsWith(".ts")) return "javascript";
    if (path.endsWith(".json")) return "json";
    return "text";
  };

  const toTabTitle = (path: string) => path.split(/[\\/]/).pop() || path;

  const updateActiveTab = useCallback((patch: Partial<EditorTab>) => {
    setTabs((prev) => prev.map((tab) => (tab.id === activeTabId ? { ...tab, ...patch } : tab)));
  }, [activeTabId]);

  const openFileByPath = useCallback(async (path: string) => {
    const result: { content: string, encoding: string } = await invoke("load_file", { path });
    const nextLanguage = detectLanguageByPath(path);
    let targetTabId = "";
    setTabs((prev) => {
      const existed = prev.find((tab) => tab.path === path);
      if (existed) {
        targetTabId = existed.id;
        return prev.map((tab) =>
          tab.id === existed.id
            ? { ...tab, content: result.content, encoding: result.encoding, language: nextLanguage, title: toTabTitle(path) }
            : tab
        );
      }
      const nextId = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      targetTabId = nextId;
      const nextTab: EditorTab = {
        id: nextId,
        title: toTabTitle(path),
        path,
        content: result.content,
        encoding: result.encoding,
        language: nextLanguage,
      };
      return [...prev, nextTab];
    });
    if (targetTabId) {
      setActiveTabId(targetTabId);
    }
    setCursorLine(1);
    setCursorCol(1);
    setStatusMessage(`已打开 ${path}`);
  }, []);

  const handleOpenFile = async () => {
    try {
      const selected = await open({
        multiple: true,
        filters: [{
          name: 'Text',
          extensions: ['txt', 'md', 'js', 'ts', 'json', 'html', 'css', 'rs', 'py']
        }]
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

  const handleSaveFile = async () => {
    try {
      if (!activeTab) return;
      let path = activeTab.path;
      if (!path) {
        path = await save({
          filters: [{
            name: 'Text',
            extensions: ['txt', 'md']
          }]
        });
      }

      if (path) {
        await invoke("save_file", { path, content, encoding });
        updateActiveTab({ path, title: toTabTitle(path) });
        setStatusMessage("保存成功");
      }
    } catch (error) {
      console.error("Failed to save file:", error);
      setStatusMessage("保存失败: " + error);
    }
  };

  const getExtensions = () => {
    const baseExtensions = [rectangularSelection()];
    switch (language) {
      case 'markdown': return [...baseExtensions, markdown()];
      case 'javascript': return [...baseExtensions, javascript()];
      case 'json': return [...baseExtensions, json()];
      default: return baseExtensions;
    }
  };

  const handleFormatJson = () => {
    if (!content.trim()) return;
    try {
      const parsed = JSON.parse(content);
      const formatted = JSON.stringify(parsed, null, 2);
      updateActiveTab({ content: formatted });
      setStatusMessage("JSON 格式化成功");
    } catch (error) {
      setStatusMessage("JSON 格式错误: " + (error as Error).message);
    }
  };

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

      // 窗口准备完成，显示窗口
      try {
        await getCurrentWindow().show();
      } catch {
        // 开发环境下可能失败，忽略
      }
    };

    void setupOpenFileBridge();
    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [openFileByPath]);

  useEffect(() => {
    setCursorLine(1);
    setCursorCol(1);
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

  const closeTab = (tabId: string) => {
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

  return (
    <div className="app-container">
      <div className="toolbar">
        <div className="file-controls">
          <button className="icon-button" onClick={createNewTab} title="新建文件 (Ctrl+N)" aria-label="新建文件">📄</button>
          <button className="icon-button" onClick={handleOpenFile} title="打开文件" aria-label="打开文件">📂</button>
          {language === 'json' && (
            <button className="icon-button" onClick={handleFormatJson} title="格式化 JSON" aria-label="格式化 JSON">⟳</button>
          )}
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
            <option value="javascript">JavaScript</option>
            <option value="json">JSON</option>
          </select>

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
        </div>
      </div>
      <div className="tab-bar">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`tab-item ${tab.id === activeTabId ? "active" : ""}`}
            onClick={() => setActiveTabId(tab.id)}
            title={tab.path || tab.title}
          >
            <span className="tab-title">{tab.title}</span>
            <span
              className="tab-close"
              onClick={(event) => {
                event.stopPropagation();
                closeTab(tab.id);
              }}
            >
              ×
            </span>
          </button>
        ))}
        <button
          className="tab-item tab-add"
          onClick={createNewTab}
          title="新建文件 (Ctrl+N)"
          aria-label="新建文件"
        >
          +
        </button>
      </div>

      <div className={`editor-area mode-${viewMode}`} style={editorStyle}>
        {(viewMode === 'edit' || viewMode === 'split') && (
          <div className="editor-pane" ref={editorPaneRef}>
            <CodeMirror
              value={content}
              height="100%"
              extensions={getExtensions()}
              onChange={(val) => updateActiveTab({ content: val })}
              onUpdate={(viewUpdate) => {
                const head = viewUpdate.state.selection.main.head;
                const line = viewUpdate.state.doc.lineAt(head);
                setCursorLine(line.number);
                setCursorCol(head - line.from + 1);
              }}
              theme="light"
            />
          </div>
        )}
        
        {(viewMode === 'preview' || viewMode === 'split') && (
          <div className="preview-pane markdown-body">
            <Suspense fallback={<div className="preview-loading">加载预览...</div>}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            </Suspense>
          </div>
        )}
      </div>
      <div className={`floating-h-scroll mode-${viewMode}`} ref={floatingScrollRef} aria-hidden="true">
        <div className="floating-h-scroll-content" ref={floatingScrollContentRef} />
      </div>
      <div className="status-bar">
        <div className="status-left">
          <div className="status-segment status-path" title={filePath || "Untitled"}>
            <span className="file-path">{filePath || "Untitled"}</span>
          </div>
          <div className="status-segment status-encoding">
            <select value={encoding} onChange={(e) => updateActiveTab({ encoding: e.target.value })}>
              <option value="UTF-8">UTF-8</option>
              <option value="windows-1252">Windows-1252</option>
              <option value="GBK">GBK</option>
              <option value="Shift_JIS">Shift_JIS</option>
              <option value="EUC-KR">EUC-KR</option>
            </select>
          </div>
          <div className="status-segment status-message" title={statusMessage}>{statusMessage}</div>
        </div>
        <div className="status-right">
          <div className="status-segment status-readout">Ln {cursorLine}, Col {cursorCol}</div>
          <div className="status-segment status-readout">{zoomPercent}%</div>
        </div>
      </div>
    </div>
  );
}

export default App;
