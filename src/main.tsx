import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { installWebviewGuards } from "./core/webviewGuards";

// 禁用 WebView2 默认右键菜单与刷新快捷键，避免误触刷新导致未保存内容丢失
installWebviewGuards();

// 生产环境移除 StrictMode 以提升启动性能
const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);
if (import.meta.env.DEV) {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
} else {
  root.render(<App />);
}
