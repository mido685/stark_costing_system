import SystemLogsPage from "./pages/SystemLogsPage";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, Router as WouterRouter } from "wouter";
import ErrorBoundary             from "./components/ErrorBoundary";
import { ThemeProvider }         from "./contexts/ThemeContext";
import { LanguageProvider }      from "./contexts/LanguageContext";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { WorkingPeriodProvider } from "./contexts/Workingperiodcontext";
import DashboardLayout           from "./components/DashboardLayout";
import Dashboard                 from "./pages/Dashboard";
import Masters                   from "./pages/Masters";
import InventoryControls         from "./pages/InventoryControls";
import Procurement               from "./pages/Procurement";
import Production                from "./pages/Production";
import Recipes                   from "./pages/Recipes";
import Sales                     from "./pages/Sales";
import Finance                   from "./pages/Finance";
import Governance                from "./pages/Governance";
import Report                    from "./pages/Report";
import Login                     from "./pages/Login";
import Register                  from "./pages/Register";
import UserManagement            from "./pages/UserManagement";
import SuperAdminPanel           from "./pages/Superadminpanel";
import SystemOwnerLogin          from "./pages/SystemOwnerLogin";
import { ShieldCheck }            from "lucide-react";

// ─── Routers ──────────────────────────────────────────────────────────────────

function SuperAdminRouter() {
  return (
    <Switch>
      <Route path="/"             component={SuperAdminPanel} />
      <Route path="/register"     component={Register}        />
      <Route path="/system-owner" component={SuperAdminPanel} />
      <Route                      component={NotFound}        />
    </Switch>
  );
}
function RequireRole({ roles, children }: { roles: string[]; children: React.ReactNode }) {
  const { user } = useAuth();
  const role = (user?.role ?? "").toLowerCase();
  if (!roles.includes(role)) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-24 text-center px-6">
        <div className="w-14 h-14 rounded-full bg-amber-100 dark:bg-amber-950/40 flex items-center justify-center mb-4">
          <ShieldCheck className="w-7 h-7 text-amber-600 dark:text-amber-400" />
        </div>
        <h1 className="text-xl font-semibold text-foreground mb-1">Restricted page</h1>
        <p className="text-sm text-muted-foreground max-w-sm">
          This page is only available to {roles.join(" and ")} accounts. Contact an administrator if you need access.
        </p>
      </div>
    );
  }
  return <>{children}</>;
}
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
        <Route path="/user-management">
        <RequireRole roles={["owner", "admin"]}>
          <UserManagement />
        </RequireRole>
      </Route>
        <Route path="/system-logs">
        <RequireRole roles={["owner", "admin", "manager"]}>
          <SystemLogsPage />
        </RequireRole>
      </Route>
        <Route                            component={NotFound}          />
      </Switch>
    </DashboardLayout>
  );
}

// ─── Shell ────────────────────────────────────────────────────────────────────

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
        <Route path="/register"     component={Register}         />
        <Route path="/system-owner" component={SystemOwnerLogin} />
        <Route                      component={Login}            />
      </Switch>
    );
  }

  if (user.role === "superadmin") return <SuperAdminRouter />;

  return <AppRouter />;
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <ErrorBoundary>
      <WouterRouter>
        <ThemeProvider defaultTheme="light">
          <LanguageProvider>
            <AuthProvider>
              <WorkingPeriodProvider>
                <TooltipProvider>
                  <Toaster />
                  <AppShell />
                </TooltipProvider>
              </WorkingPeriodProvider>
            </AuthProvider>
          </LanguageProvider>
        </ThemeProvider>
      </WouterRouter>
    </ErrorBoundary>
  );
}