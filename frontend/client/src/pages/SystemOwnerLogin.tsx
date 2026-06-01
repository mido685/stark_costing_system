import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Loader2, Lock, User, ShieldCheck, Eye, EyeOff } from "lucide-react";
import { apiCall } from "@/lib/api";
import { useAuth, type AuthUser } from "@/contexts/AuthContext";

const inputClass =
  "w-full px-3 py-2.5 rounded-lg border border-input bg-background text-sm " +
  "focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground transition-colors";

export default function SystemOwnerLogin() {
  const { login }       = useAuth();
  const [, setLocation] = useLocation();
  const [form, setForm]         = useState({ username: "", password: "" });
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");
  const [showPass, setShowPass] = useState(false);

  function update(field: keyof typeof form, value: string) {
    setForm(f => ({ ...f, [field]: value }));
    if (error) setError("");
  }

  async function handleSubmit() {
    if (!form.username.trim()) return setError("Username is required");
    if (!form.password)        return setError("Password is required");

    setLoading(true);
    setError("");
    try {
      const data = await apiCall<{ user: AuthUser; token: string }>("/api/auth/superadmin/login", {
        method: "POST",
        body: JSON.stringify({
          company_slug: "",
          username: form.username.trim(),
          password: form.password,
        }),
      });
      login(data.user, data.token);
      setLocation("/");
    } catch (err: any) {
      setError(err?.message ?? "Access denied.");
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
              System Owner Access
            </p>
          </div>
        </div>

        <Card className="p-6 shadow-lg border-border/60">
          <div className="mb-4 px-3 py-2.5 rounded-lg bg-purple-50 border border-purple-200 text-xs text-purple-700 flex items-center gap-2">
            <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
            Restricted area — authorized personnel only
          </div>

          {error && (
            <div className="mb-4 px-3 py-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
              {error}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">Username</label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <input
                  type="text"
                  className={inputClass + " pl-9"}
                  placeholder="system username"
                  value={form.username}
                  onChange={e => update("username", e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleSubmit()}
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
                  value={form.password}
                  onChange={e => update("password", e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleSubmit()}
                />
                <button
                  type="button"
                  onClick={() => setShowPass(s => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>

          <Button
            className="w-full mt-6 bg-purple-600 hover:bg-purple-700"
            onClick={handleSubmit}
            disabled={loading}
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <ShieldCheck className="w-4 h-4 mr-2" />}
            {loading ? "Verifying..." : "Access System"}
          </Button>
        </Card>

      </div>
    </div>
  );
}