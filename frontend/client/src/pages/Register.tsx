import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Loader2, Building2, User, Lock, Eye, EyeOff, ImagePlus, X } from "lucide-react";
import { Link } from "wouter";
import { API_BASE } from "@/lib/api";

const inputClass =
  "w-full px-3 py-2.5 rounded-lg border border-input bg-background text-sm " +
  "focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground transition-colors";

export default function Register() {
  const [form, setForm] = useState({
    company_name:       "",
    company_slug:       "",
    owner_username:     "",
    owner_display_name: "",
    owner_password:     "",
    confirm_password:   "",
  });

  const [logoFile,    setLogoFile]    = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState("");
  const [success,     setSuccess]     = useState(false);
  const [showPass,    setShowPass]    = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function update(field: keyof typeof form, value: string) {
    setForm(f => {
      const next: typeof form = { ...f, [field]: value };
      if (field === "company_name") {
        next.company_slug = value
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "");
      }
      return next;
    });
    if (error) setError("");
  }

  function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoFile(file);
    setLogoPreview(URL.createObjectURL(file));
  }

  function removeLogo() {
    setLogoFile(null);
    setLogoPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleSubmit() {
    const {
      company_name, company_slug, owner_username,
      owner_display_name, owner_password, confirm_password,
    } = form;

    if (!company_name.trim())       return setError("Company name is required");
    if (!company_slug.trim())       return setError("Company ID is required");
    if (!owner_username.trim())     return setError("Username is required");
    if (!owner_display_name.trim()) return setError("Display name is required");
    if (!owner_password)            return setError("Password is required");
    if (owner_password.length < 6)  return setError("Password must be at least 6 characters");
    if (owner_password !== confirm_password) return setError("Passwords do not match");

    setLoading(true);
    setError("");

    try {
      // Must use FormData (not JSON) because backend uses Form(...) + File(...)
      const formData = new FormData();
      formData.append("company_name",       company_name.trim());
      formData.append("company_slug",       company_slug.trim());
      formData.append("owner_username",     owner_username.trim());
      formData.append("owner_display_name", owner_display_name.trim());
      formData.append("owner_password",     owner_password);
      if (logoFile) formData.append("logo", logoFile);

      const token = localStorage.getItem("token");
      const res = await fetch(`${API_BASE}/api/auth/register`, {
        method: "POST",
        body: formData,
        // ⚠️ Do NOT set Content-Type — browser sets it automatically with boundary
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (!res.ok) {
        let msg = res.statusText;
        try {
          const body = await res.json();
          msg = body?.detail?.error ?? body?.error ?? body?.detail ?? msg;
        } catch { /* ignore */ }
        throw new Error(msg);
      }

      setSuccess(true);
    } catch (err: any) {
      setError(err?.message ?? "Registration failed.");
    }

    setLoading(false);
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Enter") handleSubmit();
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-secondary/40 to-background p-4">
        <div className="w-full max-w-sm space-y-6 text-center">
          <div className="w-14 h-14 rounded-2xl bg-green-100 border border-green-200 flex items-center justify-center mx-auto">
            <svg className="w-7 h-7 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Company registered!</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Your company <strong>{form.company_name}</strong> is ready.
            </p>
          </div>
          <Card className="p-5 text-left space-y-2 border-border/60">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Login details</p>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Company ID</span>
              <span className="font-mono font-medium">{form.company_slug}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Username</span>
              <span className="font-mono font-medium">{form.owner_username}</span>
            </div>
          </Card>
          <Link href="/">
            <Button className="w-full">Go to Login</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-secondary/40 to-background p-4">
      <div className="w-full max-w-sm space-y-6">

        {/* Logo */}
        <div className="text-center space-y-3">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto shadow-sm">
            <Building2 className="w-7 h-7 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground tracking-tight">STARK AI</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Create your company account</p>
          </div>
        </div>

        <Card className="p-6 shadow-lg border-border/60">
          <h2 className="text-base font-semibold text-foreground mb-5">Register your company</h2>

          {error && (
            <div className="mb-4 px-3 py-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
              {error}
            </div>
          )}

          <div className="space-y-4">

            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Company</p>

            {/* Company Logo Upload */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                Company logo <span className="text-[11px]">(optional)</span>
              </label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleLogoChange}
                className="hidden"
                id="logo-upload"
              />
              {logoPreview ? (
                <div className="flex items-center gap-3">
                  <img
                    src={logoPreview}
                    alt="Logo preview"
                    className="w-12 h-12 rounded-full object-cover ring-2 ring-primary/20"
                  />
                  <div className="flex-1 text-xs text-muted-foreground truncate">{logoFile?.name}</div>
                  <button
                    type="button"
                    onClick={removeLogo}
                    className="p-1 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <label
                  htmlFor="logo-upload"
                  className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-dashed border-input bg-muted/30 cursor-pointer hover:bg-muted/50 transition-colors"
                >
                  <ImagePlus className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span className="text-sm text-muted-foreground">Click to upload logo</span>
                </label>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">Company name</label>
              <div className="relative">
                <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <input
                  type="text"
                  className={inputClass + " pl-9"}
                  placeholder="e.g. Burger Palace"
                  value={form.company_name}
                  onChange={e => update("company_name", e.target.value)}
                  onKeyDown={handleKey}
                  autoFocus
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                Company ID <span className="text-[11px] text-muted-foreground">(used at login)</span>
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">@</span>
                <input
                  type="text"
                  className={inputClass + " pl-7"}
                  placeholder="burger-palace"
                  value={form.company_slug}
                  onChange={e => update("company_slug", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                  onKeyDown={handleKey}
                />
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">Lowercase letters, numbers, and hyphens only</p>
            </div>

            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide pt-1">Owner account</p>

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">Display name</label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <input
                  type="text"
                  className={inputClass + " pl-9"}
                  placeholder="Mohamed Stark"
                  value={form.owner_display_name}
                  onChange={e => update("owner_display_name", e.target.value)}
                  onKeyDown={handleKey}
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
                  placeholder="admin"
                  value={form.owner_username}
                  onChange={e => update("owner_username", e.target.value)}
                  onKeyDown={handleKey}
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
                  value={form.owner_password}
                  onChange={e => update("owner_password", e.target.value)}
                  onKeyDown={handleKey}
                  autoComplete="new-password"
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

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">Confirm password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <input
                  type={showPass ? "text" : "password"}
                  className={inputClass + " pl-9"}
                  placeholder="••••••••"
                  value={form.confirm_password}
                  onChange={e => update("confirm_password", e.target.value)}
                  onKeyDown={handleKey}
                  autoComplete="new-password"
                />
              </div>
            </div>

          </div>

          <Button className="w-full mt-6" onClick={handleSubmit} disabled={loading}>
            {loading
              ? <Loader2 className="w-4 h-4 animate-spin mr-2" />
              : <Building2 className="w-4 h-4 mr-2" />
            }
            {loading ? "Creating account..." : "Create company"}
          </Button>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          Already have an account?{" "}
          <Link href="/" className="text-primary hover:underline">Sign in</Link>
        </p>

      </div>
    </div>
  );
}
