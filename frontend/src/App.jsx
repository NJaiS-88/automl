import { NavLink, Route, Routes } from "react-router-dom";
import "./App.css";
import { useAuthStore } from "./authStore";
import HistoryPage from "./pages/HistoryPage";
import AuthPage from "./pages/AuthPage";
import RunDetailsPage from "./pages/RunDetailsPage";
import RunPage from "./pages/RunPage";

function App() {
  const { user, logout } = useAuthStore();

  if (!user) {
    return <AuthPage />;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">AutoML Studio</div>
        <nav>
          <NavLink to="/" end className="nav-link">
            New Run
          </NavLink>
          <NavLink to="/history" className="nav-link">
            History
          </NavLink>
        </nav>
        <div className="sidebar-user">
          <p>{user.name}</p>
          <small>{user.email}</small>
          <button className="secondary-btn logout-btn" onClick={logout}>
            Logout
          </button>
        </div>
      </aside>
      <main className="content">
        <header className="topbar">
          <h1>Professional AutoML Dashboard</h1>
          <p>Upload dataset, train, analyze, predict and export.</p>
        </header>
        <Routes>
          <Route path="/" element={<RunPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/history/:id" element={<RunDetailsPage />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
