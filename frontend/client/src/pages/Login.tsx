import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Loader2, Lock, Building2, User, Eye, EyeOff,
  ShieldCheck,
} from "lucide-react";
import { apiCall } from "@/lib/api";
import { useAuth, type AuthUser } from "@/contexts/AuthContext";

const inputClass =
  "w-full px-3 py-2.5 rounded-lg border border-input bg-background text-sm " +
  "focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground transition-colors";

export default function Login() {
  const { login } = useAuth();

  // ── Mode toggle ────────────────────────────────────────────────────────────
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  // ── Company login state ────────────────────────────────────────────────────
  const [form, setForm] = useState({ company_slug: "", username: "", password: "" });

  // ── Superadmin login state ─────────────────────────────────────────────────
  const [saForm, setSaForm] = useState({ username: "", password: "" });

  // ── Shared state ──────────────────────────────────────────────────────────
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState("");
  const [showPass, setShowPass] = useState(false);

  function update(field: keyof typeof form, value: string) {
    setForm(f => ({ ...f, [field]: value }));
    if (error) setError("");
  }

  function switchMode(superAdmin: boolean) {
    setIsSuperAdmin(superAdmin);
    setError("");
    setShowPass(false);
  }

  // ── Normal company login ───────────────────────────────────────────────────
  async function handleSubmit() {
    const { company_slug, username, password } = form;
    if (!company_slug.trim()) return setError("Company code is required");
    if (!username.trim()) return setError("Username is required");
    if (!password)        return setError("Password is required");

    setLoading(true);
    setError("");
    try {
      const data = await apiCall<{ user: AuthUser; token: string }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          company_slug: company_slug.trim().toLowerCase(),
          username:     username.trim(),
          password,
        }),
      });
      login(data.user, data.token);
    } catch (err: any) {
      setError(err?.message ?? "Login failed. Check your credentials.");
    }
    setLoading(false);
  }

  // ── Superadmin login ───────────────────────────────────────────────────────
  async function handleSuperAdminSubmit() {
    const { username, password } = saForm;
    if (!username.trim()) return setError("Username is required");
    if (!password)        return setError("Password is required");

    setLoading(true);
    setError("");
    try {
      // Superadmin endpoint ignores company_slug — send empty string
      const data = await apiCall<{ user: AuthUser; token: string }>("/api/auth/superadmin/login", {
        method: "POST",
        body: JSON.stringify({
          company_slug: "",
          username:     username.trim(),
          password,
        }),
      });
      login(data.user, data.token);
    } catch (err: any) {
      setError(err?.message ?? "Login failed. Check your credentials.");
    }
    setLoading(false);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-secondary/40 to-background p-4">
      <div className="w-full max-w-sm space-y-6">

        {/* Logo */}
        <div className="text-center space-y-3">
          <div className="w-14 h-14 rounded-full border-2 border-primary/20 flex items-center justify-center mx-auto shadow-sm overflow-hidden">
            <img src="/logo.gif" alt="Stark AI" className="w-full h-full object-cover" />
          </div>
          <div>
            <h1 style={{ fontFamily: "StardosStencil, sans-serif" }} className="text-2xl text-[#9c2177] tracking-wider">
              STARK AI
            </h1>
            <p className="text-[10px] text-muted-foreground mt-0.5 uppercase tracking-widest">
              Enterprise Costing System
            </p>
          </div>
        </div>

        {/* Mode tabs */}
        <div className="flex rounded-lg border border-border overflow-hidden">
          <button
            onClick={() => switchMode(false)}
            className={`flex-1 py-2 text-xs font-medium transition-colors ${
              !isSuperAdmin
                ? "bg-primary text-primary-foreground"
                : "bg-background text-muted-foreground hover:text-foreground"
            }`}
          >
            Company Login
          </button>
          <button
            onClick={() => switchMode(true)}
            className={`flex-1 py-2 text-xs font-medium transition-colors flex items-center justify-center gap-1.5 ${
              isSuperAdmin
                ? "bg-primary text-primary-foreground"
                : "bg-background text-muted-foreground hover:text-foreground"
            }`}
          >
            <ShieldCheck className="w-3 h-3" />
            System Owner
          </button>
        </div>

        {/* Card */}
        <Card className="p-6 shadow-lg border-border/60">
          <h2 className="text-base font-semibold text-foreground mb-5">
            {isSuperAdmin ? "System Owner Access" : "Sign in to your account"}
          </h2>

          {isSuperAdmin && (
            <div className="mb-4 px-3 py-2.5 rounded-lg bg-purple-50 border border-purple-200 text-xs text-purple-700 flex items-center gap-2">
              <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
              Full system access — no company required
            </div>
          )}

          {error && (
            <div className="mb-4 px-3 py-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
              {error}
            </div>
          )}

          {/* ── Company login form ── */}
          {!isSuperAdmin && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Company Code</label>
                <div className="relative">
                  <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                  <input
                    type="text"
                    className={inputClass + " pl-9"}
                    placeholder="company-code"
                    value={form.company_slug}
                    onChange={e => update("company_slug", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                    onKeyDown={e => e.key === "Enter" && handleSubmit()}
                    autoComplete="organization"
                    autoFocus
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Username</label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                  <input
                    type="text"
                    className={inputClass + " pl-9"}
                    placeholder="your username"
                    value={form.username}
                    onChange={e => update("username", e.target.value)}
                    onKeyDown={e => e.key === "Enter" && handleSubmit()}
                    autoComplete="username"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                  <input
                    type={showPass ? "text" : "password"}
                    className={inputClass + " pl-9 pr-10"}
                    placeholder="••••••••"
                    value={form.password}
                    onChange={e => update("password", e.target.value)}
                    onKeyDown={e => e.key === "Enter" && handleSubmit()}
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass(s => !s)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── Superadmin login form ── */}
          {isSuperAdmin && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Username</label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                  <input
                    type="text"
                    className={inputClass + " pl-9"}
                    placeholder="system username"
                    value={saForm.username}
                    onChange={e => { setSaForm(f => ({ ...f, username: e.target.value })); if (error) setError(""); }}
                    onKeyDown={e => e.key === "Enter" && handleSuperAdminSubmit()}
                    autoComplete="username"
                    autoFocus
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                  <input
                    type={showPass ? "text" : "password"}
                    className={inputClass + " pl-9 pr-10"}
                    placeholder="••••••••"
                    value={saForm.password}
                    onChange={e => { setSaForm(f => ({ ...f, password: e.target.value })); if (error) setError(""); }}
                    onKeyDown={e => e.key === "Enter" && handleSuperAdminSubmit()}
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass(s => !s)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>
          )}

          <Button
            type="button"
            className={`w-full mt-6 ${isSuperAdmin ? "bg-purple-600 hover:bg-purple-700" : ""}`}
            onClick={isSuperAdmin ? handleSuperAdminSubmit : handleSubmit}
            disabled={loading}
          >
            {loading
              ? <Loader2 className="w-4 h-4 animate-spin mr-2" />
              : isSuperAdmin
                ? <ShieldCheck className="w-4 h-4 mr-2" />
                : <Lock className="w-4 h-4 mr-2" />
            }
            {loading ? "Signing in..." : isSuperAdmin ? "Access System" : "Sign In"}
          </Button>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          New company?{" "}
          <Link href="/register" className="text-primary hover:underline">Register here</Link>
        </p>
      </div>

    </div>
  );
}
