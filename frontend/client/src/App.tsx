import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, Router as WouterRouter } from "wouter";
import ErrorBoundary       from "./components/ErrorBoundary";
import { ThemeProvider }   from "./contexts/ThemeContext";
import { LanguageProvider } from "./contexts/LanguageContext";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import DashboardLayout     from "./components/DashboardLayout";
import Dashboard           from "./pages/Dashboard";
import Masters             from "./pages/Masters";
import InventoryControls   from "./pages/InventoryControls";
import Procurement         from "./pages/Procurement";
import Production          from "./pages/Production";
import Recipes             from "./pages/Recipes";
import Sales               from "./pages/Sales";
import Finance             from "./pages/Finance";
import Governance          from "./pages/Governance";
import Report              from "./pages/Report";
import Login               from "./pages/Login";
import Register            from "./pages/Register";
import UserManagement      from "./pages/UserManagement";
import SuperAdminPanel     from "./pages/Superadminpanel";

// ─── Superadmin router — no sidebar, just the panel ──────────────────────────

function SuperAdminRouter() {
  return (
    <Switch>
      <Route path="/"          component={SuperAdminPanel} />
      <Route path="/register"  component={Register}        />
      <Route                   component={NotFound} />
    </Switch>
  );
}

// ─── Normal authenticated router ─────────────────────────────────────────────

function AppRouter() {
  const { logout } = useAuth();
  return (
    <DashboardLayout onLogout={logout}>
      <Switch>
        <Route path="/"                   component={Dashboard}         />
        <Route path="/masters"            component={Masters}           />
        <Route path="/inventory-controls" component={InventoryControls} />
        <Route path="/procurement"        component={Procurement}       />
        <Route path="/production"         component={Production}        />
        <Route path="/recipes"            component={Recipes}           />
        <Route path="/sales"              component={Sales}             />
        <Route path="/finance"            component={Finance}           />
        <Route path="/governance"         component={Governance}        />
        <Route path="/report"             component={Report}            />
        <Route path="/user-management"    component={UserManagement}    />
        <Route component={NotFound}       />
      </Switch>
    </DashboardLayout>
  );
}

// ─── Inner app — reads from AuthContext ───────────────────────────────────────

function AppShell() {
  const { user, checking } = useAuth();

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 rounded-full border-4 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <Switch>
        <Route path="/register" component={Register} />
        <Route component={Login} />
      </Switch>
    );
  }

  // ── Superadmin gets their own panel, not the normal dashboard ────────────
  if (user.role === "superadmin") {
    return <SuperAdminRouter />;
  }

  return <AppRouter />;
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <ErrorBoundary>
      <WouterRouter>
        <ThemeProvider defaultTheme="light">
          <LanguageProvider>
            <AuthProvider>
              <TooltipProvider>
                <Toaster />
                <AppShell />
              </TooltipProvider>
            </AuthProvider>
          </LanguageProvider>
        </ThemeProvider>
      </WouterRouter>
    </ErrorBoundary>
  );
}
