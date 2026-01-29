import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./App";

// 兼容性处理
const rootElement = document.getElementById("root");

if (rootElement) {
  const root = createRoot(rootElement);
  root.render(<App />);
} else {
  console.error("找不到根元素");
}
