import { Route, Routes } from "react-router-dom";
import CosmicBackdrop from "./components/CosmicBackdrop";
import Sidebar from "./components/Sidebar";
import ChatPage from "./pages/ChatPage";
import MapPage from "./pages/MapPage";
import MistakesPage from "./pages/MistakesPage";
import PracticePage from "./pages/PracticePage";
import SettingsPage from "./pages/SettingsPage";

export default function App() {
  return (
    <div className="app">
      <CosmicBackdrop />
      <Sidebar />
      <main className="main">
        <Routes>
          <Route path="/" element={<ChatPage />} />
          <Route path="/map" element={<MapPage />} />
          <Route path="/practice" element={<PracticePage />} />
          <Route path="/mistakes" element={<MistakesPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </div>
  );
}
