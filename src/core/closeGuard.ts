export interface CloseRequestEvent {
  preventDefault: () => void;
}

/** 用户在“未保存修改”提示框中的选择。 */
export type CloseChoice = "save" | "discard" | "cancel";

export interface ClosePrompt {
  title: string;
  message: string;
}

export interface CloseGuardOptions<T> {
  dirtyTabs: T[];
  /**
   * 弹出三选一提示框：
   * - `"save"`：保存全部未保存标签后退出
   * - `"discard"`：不保存直接退出
   * - `"cancel"`：关闭提示框、保持窗口（包括按 ESC / 点击关闭按钮 / 点击遮罩）
   */
  ask: (prompt: ClosePrompt) => Promise<CloseChoice>;
  saveTab: (tab: T) => Promise<string | null>;
  destroy: () => Promise<void>;
  onStatus: (message: string) => void;
}

export async function handleCloseRequest<T>(
  event: CloseRequestEvent,
  options: CloseGuardOptions<T>,
): Promise<void> {
  if (options.dirtyTabs.length === 0) return;
  event.preventDefault();
  const choice = await options.ask({
    title: "未保存的修改",
    message: `有 ${options.dirtyTabs.length} 个标签存在未保存的修改，是否保存并退出？`,
  });
  // 取消（含关闭提示框）：不退出，保持窗口
  if (choice === "cancel") return;
  if (choice === "discard") {
    await options.destroy();
    return;
  }
  for (const tab of options.dirtyTabs) {
    const savedPath = await options.saveTab(tab);
    if (!savedPath) {
      options.onStatus("保存失败，已取消退出");
      return;
    }
  }
  await options.destroy();
}
