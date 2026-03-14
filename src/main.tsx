import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

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
