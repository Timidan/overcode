import { Component, useEffect, type ErrorInfo, type ReactNode } from "react";
import { Dashboard } from "./screens/Dashboard";
import { CogneeDashboard } from "./screens/CogneeDashboard";
import { RepoDetail } from "./screens/RepoDetail";
import { PullRequests } from "./screens/PullRequests";
import { PRDetail } from "./screens/PRDetail";
import { GitHubIssues } from "./screens/GitHubIssues";
import { GitHubIssueDetail } from "./screens/GitHubIssueDetail";
import { Repositories } from "./screens/Repositories";
import { SettingsScreen } from "./screens/Settings";
import { AIPanel } from "./components/ai/AIPanel";
import { CommandPalette } from "./components/CommandPalette";
import { LocalChangesPanel } from "./components/LocalChangesPanel";
import { RouteFrame } from "./components/RouteFrame";
import { useNav, type Screen } from "./store/useNav";
import { useCommandPalette } from "./store/useCommandPalette";
import { useAIPanel } from "./store/useAIPanel";
import { useTheme } from "./store/useTheme";
import "./App.css";

interface RouteErrorBoundaryProps {
  screen: Screen;
  onReset: () => void;
  children: ReactNode;
}

interface RouteErrorBoundaryState {
  error: Error | null;
}

class RouteErrorBoundary extends Component<
  RouteErrorBoundaryProps,
  RouteErrorBoundaryState
> {
  state: RouteErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): RouteErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[overcode-route-error]", error, info.componentStack);
  }

  componentDidUpdate(prevProps: RouteErrorBoundaryProps) {
    if (prevProps.screen !== this.props.screen && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="route-error">
        <span className="route-error-kicker">Renderer recovered</span>
        <h1>Could not render this view</h1>
        <p>{this.state.error.message || "Unexpected renderer error."}</p>
        <button type="button" onClick={this.props.onReset}>
          Back to dashboard
        </button>
      </main>
    );
  }
}

function renderScreen(screen: ReturnType<typeof useNav.getState>["screen"]) {
  if (screen === "cognee") return <CogneeDashboard />;
  if (screen === "repo-detail") return <RepoDetail />;
  if (screen === "prs") return <PullRequests />;
  if (screen === "pr-detail") return <PRDetail />;
  if (screen === "issues") return <GitHubIssues />;
  if (screen === "issue-detail") return <GitHubIssueDetail />;
  if (screen === "repositories") return <Repositories />;
  if (screen === "settings") return <SettingsScreen />;
  return <Dashboard />;
}

// Numbers mirror the sidebar rail top-to-bottom so position = shortcut.
const NUM_TO_SCREEN: Record<string, Screen> = {
  "1": "dashboard",
  "2": "cognee",
  "3": "repositories",
  "4": "prs",
  "5": "issues",
};

function App() {
  const screen = useNav((s) => s.screen);
  const navigate = useNav((s) => s.navigate);
  const toggleCmd = useCommandPalette((s) => s.toggle);
  const toggleAI = useAIPanel((s) => s.toggle);
  const toggleTheme = useTheme((s) => s.toggle);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      const key = e.key.toLowerCase();
      if (key === "k" && !e.shiftKey) {
        e.preventDefault();
        toggleCmd();
        return;
      }
      if (key === "j" && e.shiftKey) {
        e.preventDefault();
        toggleTheme();
        return;
      }
      if (e.key === ".") {
        e.preventDefault();
        toggleAI();
        return;
      }
      const target = NUM_TO_SCREEN[e.key];
      if (target) {
        e.preventDefault();
        navigate(target);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleCmd, toggleAI, toggleTheme, navigate]);

  return (
    <>
      {/* App shell: the rounded paper window the screens live inside.
          Overlays (AIPanel, CommandPalette) stay outside so they can use
          position: fixed against the viewport. */}
      <div className="app-shell">
        <RouteErrorBoundary screen={screen} onReset={() => navigate("dashboard")}>
          <RouteFrame screen={screen}>{renderScreen(screen)}</RouteFrame>
        </RouteErrorBoundary>
      </div>
      <AIPanel />
      <CommandPalette />
      <LocalChangesPanel />
    </>
  );
}

export default App;
