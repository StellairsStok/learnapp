import { useEffect, useState } from "react";
import { Link, Route, Routes } from "react-router-dom";
import CosmicBackdrop from "./components/CosmicBackdrop";
import Sidebar, { BottomNav } from "./components/Sidebar";
import ChatPage from "./pages/ChatPage";
import MapPage from "./pages/MapPage";
import MistakesPage from "./pages/MistakesPage";
import PracticePage from "./pages/PracticePage";
import SettingsPage from "./pages/SettingsPage";

export default function App() {
  const [storageFull, setStorageFull] = useState(false);
  useEffect(() => {
    const on = () => setStorageFull(true);
    window.addEventListener("stellairs-storage-full", on);
    return () => window.removeEventListener("stellairs-storage-full", on);
  }, []);

  return (
    <div className="app">
      <CosmicBackdrop />
      <Sidebar />
      <main className="main">
        {storageFull && (
          <div className="storage-warn" role="alert">
            <span>本地存储已满,新的进度可能没能保存。请到<Link to="/settings">设置 · 备份与恢复</Link>导出一份备份。</span>
            <button aria-label="关闭" onClick={() => setStorageFull(false)}>✕</button>
          </div>
        )}
        <Routes>
          <Route path="/" element={<ChatPage />} />
          <Route path="/map" element={<MapPage />} />
          <Route path="/practice" element={<PracticePage />} />
          <Route path="/mistakes" element={<MistakesPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
      <BottomNav />
    </div>
  );
}
