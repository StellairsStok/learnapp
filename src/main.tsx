import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App";
import "katex/dist/katex.min.css";
import "./styles/global.css";

// HashRouter:GitHub Pages 无 SPA 重写,用 #/ 路由最稳(刷新任意页都不 404)。
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
);
