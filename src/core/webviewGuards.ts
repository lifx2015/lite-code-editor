/**
 * WebView2 / Tauri 外壳防护。
 *
 * 背景：Windows 上 Tauri 使用 WebView2，默认会显示浏览器右键菜单
 * （返回 / 刷新 / 另存为 / 打印 / 共享）。其中“刷新”会重新加载整个页面，
 * 把编辑器中所有尚未保存的内容从内存里清空，造成数据丢失。
 *
 * 这里做两件事：
 *   1. 屏蔽 WebView2 默认右键菜单；
 *   2. 拦截刷新类快捷键（F5 / Ctrl+R / Ctrl+Shift+R / Ctrl+F5 / Shift+F5）。
 *
 * 关闭窗口仍由 App.tsx 中基于 onCloseRequested 的“未保存确认”流程处理，
 * 因此这里只拦截刷新，不影响正常的关闭交互。
 *
 * 仅在真正运行于 Tauri 环境时生效，方便在浏览器里调试时保留原生右键与“审查元素”。
 */

/** 是否为会触发页面重载的快捷键组合。 */
export function isReloadShortcut(
  event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey">,
): boolean {
  // F5 同时覆盖 Ctrl+F5 / Shift+F5（组合键的 key 仍是 "F5"）
  if (event.key === "F5") return true;
  return (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "r";
}

function inTauri(): boolean {
  return Boolean((globalThis as { isTauri?: boolean }).isTauri);
}

export interface WebviewGuardOptions {
  /** 是否屏蔽默认右键菜单，默认 true。 */
  disableContextMenu?: boolean;
  /** 是否拦截刷新快捷键，默认 true。 */
  blockReloadShortcuts?: boolean;
}

/**
 * 安装防护监听，返回卸载函数。
 * 不在 Tauri 环境或所有选项都关闭时返回空操作，不会绑定任何监听。
 */
export function installWebviewGuards(options: WebviewGuardOptions = {}): () => void {
  const { disableContextMenu = true, blockReloadShortcuts = true } = options;
  if (!inTauri() || (!disableContextMenu && !blockReloadShortcuts)) {
    return () => {};
  }

  // capture 阶段确保先于其它监听器生效；只调用 preventDefault，
  // 不调用 stopPropagation，避免影响应用自身的快捷键与菜单逻辑。
  const onContextMenu = (event: MouseEvent) => {
    event.preventDefault();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (isReloadShortcut(event)) {
      event.preventDefault();
    }
  };

  if (disableContextMenu) {
    document.addEventListener("contextmenu", onContextMenu, true);
  }
  if (blockReloadShortcuts) {
    window.addEventListener("keydown", onKeyDown, true);
  }

  return () => {
    if (disableContextMenu) {
      document.removeEventListener("contextmenu", onContextMenu, true);
    }
    if (blockReloadShortcuts) {
      window.removeEventListener("keydown", onKeyDown, true);
    }
  };
}
