import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import AppShell from "./components/fab/AppShell";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Analytics from "./pages/Analytics";
import Automation from "./pages/Automation";
import CalendarPage from "./pages/Calendar";
import CharacterDetail from "./pages/CharacterDetail";
import Characters from "./pages/Characters";
import Costs from "./pages/Costs";
import Dashboard from "./pages/Dashboard";
import Library from "./pages/Library";
import Premium from "./pages/Premium";
import QcPage from "./pages/Qc";
import RenderQueue from "./pages/RenderQueue";
import Scripts from "./pages/Scripts";
import SettingsPage from "./pages/Settings";
import Studio from "./pages/Studio";

function Router() {
  return (
    <AppShell>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/characters" component={Characters} />
        <Route path="/characters/:id" component={CharacterDetail} />
        <Route path="/scripts" component={Scripts} />
        <Route path="/premium" component={Premium} />
        <Route path="/studio" component={Studio} />
        <Route path="/render" component={RenderQueue} />
        <Route path="/qc" component={QcPage} />
        <Route path="/calendar" component={CalendarPage} />
        <Route path="/analytics" component={Analytics} />
        <Route path="/library" component={Library} />
        <Route path="/costs" component={Costs} />
        <Route path="/automation" component={Automation} />
        <Route path="/settings" component={SettingsPage} />
        <Route path="/404" component={NotFound} />
        <Route component={NotFound} />
      </Switch>
    </AppShell>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster position="top-center" richColors />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
