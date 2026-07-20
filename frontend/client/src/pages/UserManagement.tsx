import { useState } from "react";
import {
  Shield, ShieldOff, Trash2, RefreshCw,
  Crown, User, Wrench, UserPlus, Search, PenLine,
} from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast }                  from "sonner";
import { useAuth }                from "@/contexts/AuthContext";
import { useApi, useApiMutation } from "@/hooks/useApi";
import { apiCall, type UserRow }  from "@/lib/api";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CompanyUser extends UserRow {
  display_name: string;
  is_active:    boolean;
  created_at:   string;
}

type Role = "owner" | "admin" | "manager" | "clerk";

interface RoleMeta {
  value:  Role;
  label:  string;
  icon:   React.ReactNode;
  pill:   string;
  avatar: string;
}

const ROLES: RoleMeta[] = [
  { value: "owner",   label: "Owner",   icon: <Crown  className="w-3 h-3" />, pill: "border-purple-500/60 text-purple-600 dark:text-purple-300", avatar: "bg-purple-500/15 text-purple-600 dark:bg-purple-500/20 dark:text-purple-300" },
  { value: "admin",   label: "Admin",   icon: <Crown  className="w-3 h-3" />, pill: "border-amber-500/60  text-amber-600  dark:text-amber-300",  avatar: "bg-amber-500/15  text-amber-600  dark:bg-amber-500/20  dark:text-amber-300"  },
  { value: "manager", label: "Manager", icon: <Wrench className="w-3 h-3" />, pill: "border-sky-500/60    text-sky-600    dark:text-sky-300",    avatar: "bg-sky-500/15    text-sky-600    dark:bg-sky-500/20    dark:text-sky-300"    },
  { value: "clerk",   label: "Clerk",   icon: <User   className="w-3 h-3" />, pill: "border-slate-400/60  text-slate-600  dark:text-slate-300",  avatar: "bg-slate-500/10  text-slate-600  dark:bg-slate-500/20  dark:text-slate-300"  },
];

function getRoleMeta(role: string): RoleMeta {
  return ROLES.find((r) => r.value === role) ?? ROLES[3];
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, numCls, dotCls }: {
  label: string; value: number; numCls: string; dotCls: string;
}) {
  return (
    <div className="bg-white dark:bg-[#1c1c1e] border border-black/8 dark:border-white/8 rounded-2xl px-5 py-4">
      <p className={`text-3xl font-semibold tabular-nums ${numCls}`}>{value}</p>
      <div className="flex items-center gap-1.5 mt-2">
        <span className={`w-2 h-2 rounded-full shrink-0 ${dotCls}`} />
        <span className="text-[13px] text-gray-500 dark:text-[#888]">{label}</span>
      </div>
    </div>
  );
}

// ─── Role pill ────────────────────────────────────────────────────────────────

function RolePill({ role }: { role: string }) {
  const m = getRoleMeta(role);
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full border text-[11px] font-medium bg-transparent ${m.pill}`}>
      {m.icon}{m.label}
    </span>
  );
}

// ─── Add user inline form ─────────────────────────────────────────────────────

const EMPTY_FORM = { username: "", display_name: "", password: "", role: "clerk" as Role };

function AddUserForm({ currentUserId, currentRole, onCreated }: {
  currentUserId: number; currentRole: string; onCreated: () => void;
}) {
  const [form, setForm] = useState(EMPTY_FORM);

  const { mutate: createUser, loading: saving } = useApiMutation(
    (data: typeof EMPTY_FORM & { user_id: number }) =>
      apiCall("/api/users", { method: "POST", body: JSON.stringify(data) })
  );

  const availableRoles = currentRole === "owner" ? ROLES : ROLES.filter((r) => r.value !== "owner");

  async function handleSubmit() {
    if (!form.username.trim() || !form.display_name.trim() || !form.password.trim()) {
      toast.error("All fields are required");
      return;
    }
    const result = await createUser({ ...form, user_id: currentUserId });
    if (result !== null) {
      toast.success("User created");
      setForm(EMPTY_FORM);
      onCreated();
    } else {
      toast.error("Failed to create user");
    }
  }

  return (
    <div className="px-5 pt-4 pb-4 border-b border-black/6 dark:border-white/6 bg-gray-50 dark:bg-[#141414]">
      <p className="text-[11px] font-medium text-gray-400 dark:text-[#555] uppercase tracking-wider mb-3">Add User</p>
      <div className="grid grid-cols-1 md:grid-cols-[1.2fr_1fr_1fr_0.8fr_auto] gap-2">
        {[
          { ph: "Display name", key: "display_name", type: "text"     },
          { ph: "Username",     key: "username",     type: "text"     },
          { ph: "Password",     key: "password",     type: "password" },
        ].map(({ ph, key, type }) => (
          <input
            key={key}
            type={type}
            placeholder={ph}
            value={(form as any)[key]}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                [key]: key === "username" ? e.target.value.toLowerCase().trim() : e.target.value,
              }))
            }
            className="h-9 rounded-xl border border-black/8 dark:border-white/8 bg-black/[0.03] dark:bg-white/5 px-3 text-[13px] text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-[#444] outline-none focus:border-black/20 dark:focus:border-white/20 transition-colors"
          />
        ))}
        <select
          value={form.role}
          onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as Role }))}
          className="h-9 rounded-xl border border-black/8 dark:border-white/8 bg-black/[0.03] dark:bg-white/5 px-3 text-[13px] text-gray-900 dark:text-white outline-none focus:border-black/20 dark:focus:border-white/20 transition-colors cursor-pointer"
        >
          {availableRoles.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>
        <button
          onClick={handleSubmit}
          disabled={saving}
          className="h-9 px-4 flex items-center gap-2 rounded-xl bg-black text-white dark:bg-white dark:text-black text-[13px] font-medium hover:opacity-90 transition-colors disabled:opacity-40 shrink-0"
        >
          {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
          Add
        </button>
      </div>
    </div>
  );
}

// ─── Table row ────────────────────────────────────────────────────────────────

function UserTableRow({ u, currentUserId, currentRole, onRoleChange, onToggleActive, onDelete }: {
  u: CompanyUser; currentUserId: number; currentRole: string;
  onRoleChange:   (id: number, role: Role) => void;
  onToggleActive: (id: number, active: boolean) => void;
  onDelete:       (id: number) => void;
}) {
  const isSelf   = u.id === currentUserId;
  const isOwner  = u.role === "owner";
  const disabled = isSelf || (isOwner && currentRole !== "owner");
  const meta     = getRoleMeta(u.role);
  const initials = (u.display_name || u.username).slice(0, 2).toUpperCase();
  const joined   = u.created_at
    ? new Date(u.created_at).toLocaleDateString("en-US", { month: "short", year: "numeric" })
    : "—";

  return (
    <tr className="border-t border-black/5 dark:border-white/5 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors">
      {/* User */}
      <td className="px-5 py-3.5">
        <div className="flex items-center gap-3">
          <div className={`w-9 h-9 rounded-full flex items-center justify-center text-[11px] font-semibold shrink-0 ${u.is_active ? meta.avatar : "bg-black/6 dark:bg-white/6 text-gray-400 dark:text-[#555]"}`}>
            {initials}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-[13px] font-medium text-gray-900 dark:text-white truncate">{u.display_name || u.username}</span>
              {isSelf && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/15 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400 border border-blue-500/30">you</span>
              )}
              {!u.is_active && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-black/6 dark:bg-white/6 text-gray-500 dark:text-[#666] border border-black/8 dark:border-white/8">suspended</span>
              )}
            </div>
            <p className="text-[11px] text-gray-500 dark:text-[#666]">@{u.username}</p>
          </div>
        </div>
      </td>

      {/* Role */}
      <td className="px-5 py-3.5"><RolePill role={u.role} /></td>

      {/* Status */}
      <td className="px-5 py-3.5">
        <div className="flex items-center gap-2">
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${u.is_active ? "bg-green-400" : "bg-gray-300 dark:bg-[#555]"}`} />
          <span className={`text-[12px] ${u.is_active ? "text-green-600 dark:text-green-400" : "text-gray-400 dark:text-[#555]"}`}>
            {u.is_active ? "Active" : "Suspended"}
          </span>
        </div>
      </td>

      {/* Joined */}
      <td className="px-5 py-3.5 text-[12px] text-gray-500 dark:text-[#666]">{joined}</td>

      {/* Actions */}
      <td className="px-5 py-3.5">
        <div className="flex items-center justify-end gap-1.5">
          {/* Cycle role */}
          <button
            title="Change role"
            disabled={disabled}
            onClick={() => {
              const order: Role[] = ["clerk", "manager", "admin", "owner"];
              const next = order[(order.indexOf(u.role as Role) + 1) % order.length];
              onRoleChange(u.id, next);
            }}
            className={`w-7 h-7 flex items-center justify-center rounded-lg border transition-colors
              ${disabled
                ? "opacity-30 cursor-not-allowed border-black/8 dark:border-white/8 text-gray-400 dark:text-[#555]"
                : "border-black/8 dark:border-white/8 text-gray-500 dark:text-[#666] hover:border-black/20 dark:hover:border-white/20 hover:text-gray-900 dark:hover:text-white hover:bg-black/8 dark:hover:bg-white/8"}`}
          >
            <PenLine className="w-3 h-3" />
          </button>

          {/* Suspend / Restore */}
          <button
            title={u.is_active ? "Suspend access" : "Restore access"}
            disabled={disabled}
            onClick={() => onToggleActive(u.id, !u.is_active)}
            className={`w-7 h-7 flex items-center justify-center rounded-lg border transition-colors
              ${disabled
                ? "opacity-30 cursor-not-allowed border-black/8 dark:border-white/8 text-gray-400 dark:text-[#555]"
                : u.is_active
                  ? "border-black/8 dark:border-white/8 text-gray-500 dark:text-[#666] hover:border-orange-500/40 hover:text-orange-600 dark:hover:text-orange-400 hover:bg-orange-500/8"
                  : "border-black/8 dark:border-white/8 text-gray-500 dark:text-[#666] hover:border-green-500/40  hover:text-green-600 dark:hover:text-green-400  hover:bg-green-500/8"
              }`}
          >
            {u.is_active ? <ShieldOff className="w-3 h-3" /> : <Shield className="w-3 h-3" />}
          </button>
        </div>
      </td>
    </tr>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function UserManagement() {
  const { user } = useAuth();
  const currentUserId = user?.id   ?? 0;
  const currentRole   = user?.role ?? "clerk";

  const { data: rawUsers, loading, refetch } = useApi(
    () => apiCall<CompanyUser[]>("/api/users"),
    { skip: currentRole !== "admin" && currentRole !== "owner" }
  );

  const users: CompanyUser[] = rawUsers ?? [];

  const { mutate: updateRole }   = useApiMutation(({ id, role }: { id: number; role: Role }) =>
    apiCall(`/api/users/${id}/role`,   { method: "PATCH", body: JSON.stringify({ role }) })
  );
  const { mutate: updateAccess } = useApiMutation(({ id, is_active }: { id: number; is_active: boolean }) =>
    apiCall(`/api/users/${id}/access`, { method: "PATCH", body: JSON.stringify({ is_active }) })
  );
  const { mutate: removeUser } = useApiMutation((id: number) =>
    apiCall(`/api/users/${id}/access`, { method: "PATCH", body: JSON.stringify({ is_active: false }) })
  );

  const [search,       setSearch]       = useState("");
  const [roleFilter,   setRoleFilter]   = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);

  async function handleRoleChange(id: number, role: Role) {
    const ok = await updateRole({ id, role });
    if (ok !== null) { toast.success("Role updated");  refetch(); }
    else               toast.error("Failed to update role");
  }

  async function handleToggleActive(id: number, is_active: boolean) {
    const ok = await updateAccess({ id, is_active });
    if (ok !== null) { toast.success(is_active ? "Access restored" : "Access revoked"); refetch(); }
    else               toast.error("Failed to update access");
  }

  async function handleDelete(id: number) {
    const ok = await removeUser(id);
    if (ok !== null) { toast.success("User removed"); refetch(); }
    else               toast.error("Failed to remove user");
    setDeleteTarget(null);
  }

  const filtered = users.filter((u) => {
    const q = search.toLowerCase();
    if (q && !u.display_name?.toLowerCase().includes(q) && !u.username.toLowerCase().includes(q)) return false;
    if (roleFilter   !== "all" && u.role !== roleFilter)  return false;
    if (statusFilter === "active"   && !u.is_active)      return false;
    if (statusFilter === "inactive" &&  u.is_active)      return false;
    return true;
  });

  const activeCount = users.filter((u) =>  u.is_active).length;
  const adminCount  = users.filter((u) => u.role === "owner" || u.role === "admin").length;

  // ── Access guard ──────────────────────────────────────────────────────────
  if (currentRole !== "admin" && currentRole !== "owner") {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-3 text-gray-400 dark:text-[#666]">
        <Shield className="w-10 h-10" />
        <p className="text-sm font-medium text-gray-900 dark:text-white">Admin access only</p>
        <p className="text-xs">You don't have permission to manage users.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold text-gray-900 dark:text-white">User Management</h1>
          <p className="text-[13px] text-gray-500 dark:text-[#888] mt-0.5">Manage roles, permissions, and access for your organization</p>
        </div>
        <button
          onClick={refetch}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 rounded-xl border border-black/15 dark:border-white/15 text-[13px] text-gray-900 dark:text-white hover:bg-black/8 dark:hover:bg-white/8 transition-colors disabled:opacity-40 shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        <StatCard label="Total users"      value={users.length}              numCls="text-gray-900 dark:text-white" dotCls="bg-gray-400 dark:bg-[#666]" />
        <StatCard label="Active"           value={activeCount}               numCls="text-green-600 dark:text-green-400"  dotCls="bg-green-400"  />
        <StatCard label="Suspended"        value={users.length - activeCount} numCls="text-red-600 dark:text-red-400"   dotCls="bg-red-400"    />
        <StatCard label="Admins & owners"  value={adminCount}                numCls="text-purple-600 dark:text-purple-400" dotCls="bg-purple-400" />
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 dark:text-[#555] pointer-events-none" />
          <input
            type="text"
            placeholder="Search users…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-10 pl-9 pr-4 rounded-xl bg-white dark:bg-[#1c1c1e] border border-black/8 dark:border-white/8 text-[13px] text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-[#555] outline-none focus:border-black/20 dark:focus:border-white/20 transition-colors"
          />
        </div>
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="h-10 px-3 rounded-xl bg-white dark:bg-[#1c1c1e] border border-black/8 dark:border-white/8 text-[13px] text-gray-900 dark:text-white outline-none focus:border-black/20 dark:focus:border-white/20 transition-colors min-w-36 cursor-pointer"
        >
          <option value="all">All roles</option>
          {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="h-10 px-3 rounded-xl bg-white dark:bg-[#1c1c1e] border border-black/8 dark:border-white/8 text-[13px] text-gray-900 dark:text-white outline-none focus:border-black/20 dark:focus:border-white/20 transition-colors min-w-36 cursor-pointer"
        >
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Suspended</option>
        </select>
      </div>

      {/* Add user form + table */}
      <div className="rounded-2xl border border-black/8 dark:border-white/8 overflow-hidden">

        {/* Inline add user */}
        <AddUserForm
          currentUserId={currentUserId}
          currentRole={currentRole}
          onCreated={refetch}
        />

        {/* Table */}
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-gray-50 dark:bg-[#1a1a1a]">
              {["USER", "ROLE", "STATUS", "JOINED", "ACTIONS"].map((h, i) => (
                <th
                  key={h}
                  className={`px-5 py-3 text-[10px] font-medium tracking-wider text-gray-400 dark:text-[#444] ${i === 4 ? "text-right" : "text-left"}`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-[#111]">
            {loading ? (
              [1, 2, 3].map((i) => (
                <tr key={i} className="border-t border-black/5 dark:border-white/5">
                  <td colSpan={5} className="px-5 py-3.5">
                    <div className="h-9 bg-black/5 dark:bg-white/5 rounded-xl animate-pulse" />
                  </td>
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-5 py-12 text-center text-[13px] text-gray-400 dark:text-[#555]">
                  {users.length === 0 ? "No users found" : "No users match your filters"}
                </td>
              </tr>
            ) : (
              filtered.map((u) => (
                <UserTableRow
                  key={u.id}
                  u={u}
                  currentUserId={currentUserId}
                  currentRole={currentRole}
                  onRoleChange={handleRoleChange}
                  onToggleActive={handleToggleActive}
                  onDelete={(id) => setDeleteTarget(id)}
                />
              ))
            )}
          </tbody>
        </table>

        {!loading && filtered.length > 0 && (
          <div className="px-5 py-3 border-t border-black/5 dark:border-white/5 bg-white dark:bg-[#111]">
            <p className="text-[12px] text-gray-400 dark:text-[#555]">
              Showing {filtered.length} of {users.length} user{users.length !== 1 ? "s" : ""}
            </p>
          </div>
        )}
      </div>

      {/* Delete confirmation */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent className="bg-white dark:bg-[#1c1c1e] border-black/10 dark:border-white/10 text-gray-900 dark:text-white">
          <AlertDialogHeader>
          <AlertDialogTitle className="text-gray-900 dark:text-white">Deactivate user?</AlertDialogTitle>
          <AlertDialogDescription className="text-gray-500 dark:text-[#888]">
            This will suspend the user's access. Their historical records will be preserved. You can restore them anytime.
          </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-transparent border-black/10 dark:border-white/10 text-gray-500 dark:text-[#aaa] hover:bg-black/8 dark:hover:bg-white/8 hover:text-gray-900 dark:hover:text-white">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-orange-600 hover:bg-orange-700 text-white border-0"
              onClick={() => deleteTarget !== null && handleDelete(deleteTarget)}
            >
              Yes, deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}