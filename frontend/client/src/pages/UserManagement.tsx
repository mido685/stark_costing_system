import { useState } from "react";
import {
  Shield, ShieldOff, Trash2, UserCog, RefreshCw,
  Crown, User, Wrench, UserPlus, Search, PenLine,
} from "lucide-react";
import { Button }   from "@/components/ui/button";
import { Badge }    from "@/components/ui/badge";
import { Input }    from "@/components/ui/input";
import { Label }    from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
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
  value: Role;
  label: string;
  icon:  React.ReactNode;
  /** Border + text colour for the pill badge */
  pill:  string;
  /** Avatar background */
  avatar: string;
}

const ROLES: RoleMeta[] = [
  {
    value: "owner",
    label: "Owner",
    icon:  <Crown  className="w-3 h-3" />,
    pill:  "border-purple-500/60 text-purple-300",
    avatar:"bg-purple-500/20 text-purple-300",
  },
  {
    value: "admin",
    label: "Admin",
    icon:  <Crown  className="w-3 h-3" />,
    pill:  "border-amber-500/60  text-amber-300",
    avatar:"bg-amber-500/20  text-amber-300",
  },
  {
    value: "manager",
    label: "Manager",
    icon:  <Wrench className="w-3 h-3" />,
    pill:  "border-sky-500/60    text-sky-300",
    avatar:"bg-sky-500/20    text-sky-300",
  },
  {
    value: "clerk",
    label: "Clerk",
    icon:  <User   className="w-3 h-3" />,
    pill:  "border-slate-500/60  text-slate-300",
    avatar:"bg-slate-500/20  text-slate-300",
  },
];

function getRoleMeta(role: string): RoleMeta {
  return ROLES.find((r) => r.value === role) ?? ROLES[3];
}

// ─── Stat card ────────────────────────────────────────────────────────────────

interface StatCardProps {
  label:   string;
  value:   number;
  numCls:  string;
  dotCls:  string;
}

function StatCard({ label, value, numCls, dotCls }: StatCardProps) {
  return (
    <div className="bg-[#1c1c1e] border border-white/8 rounded-2xl px-5 py-4">
      <p className={`text-3xl font-semibold tabular-nums ${numCls}`}>{value}</p>
      <div className="flex items-center gap-1.5 mt-2">
        <span className={`w-2 h-2 rounded-full shrink-0 ${dotCls}`} />
        <span className="text-[13px] text-[#888]">{label}</span>
      </div>
    </div>
  );
}

// ─── Role pill ────────────────────────────────────────────────────────────────

function RolePill({ role }: { role: string }) {
  const m = getRoleMeta(role);
  return (
    <span
      className={`inline-flex items-center gap-1 px-3 py-1 rounded-full border text-[12px] font-medium bg-transparent ${m.pill}`}
    >
      {m.icon}
      {m.label}
    </span>
  );
}

// ─── Table row ────────────────────────────────────────────────────────────────

interface UserRowProps {
  u:              CompanyUser;
  currentUserId:  number;
  currentRole:    string;
  onRoleChange:   (id: number, role: Role) => void;
  onToggleActive: (id: number, active: boolean) => void;
  onDelete:       (id: number) => void;
}

function UserTableRow({
  u, currentUserId, currentRole,
  onRoleChange, onToggleActive, onDelete,
}: UserRowProps) {
  const isSelf   = u.id === currentUserId;
  const isOwner  = u.role === "owner";
  const disabled = isSelf || (isOwner && currentRole !== "owner");
  const meta     = getRoleMeta(u.role);
  const initials = (u.display_name || u.username).slice(0, 2).toUpperCase();

  const joinedDate = u.created_at
    ? new Date(u.created_at).toLocaleDateString("en-US", { month: "short", year: "numeric" })
    : "—";

  return (
    <tr className="border-t border-white/6 hover:bg-white/3 transition-colors group">
      {/* User */}
      <td className="px-5 py-3.5">
        <div className="flex items-center gap-3">
          <div
            className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 ${
              u.is_active ? meta.avatar : "bg-white/8 text-[#666]"
            }`}
          >
            {initials}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-[13px] font-medium text-white truncate">
                {u.display_name || u.username}
              </span>
              {isSelf && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-400 font-medium border border-blue-500/30">
                  you
                </span>
              )}
              {!u.is_active && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/8 text-[#888] border border-white/10">
                  suspended
                </span>
              )}
            </div>
            <p className="text-[12px] text-[#666] truncate">@{u.username}</p>
          </div>
        </div>
      </td>

      {/* Role */}
      <td className="px-5 py-3.5">
        <RolePill role={u.role} />
      </td>

      {/* Status */}
      <td className="px-5 py-3.5">
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full shrink-0 ${
              u.is_active ? "bg-green-400" : "bg-[#666]"
            }`}
          />
          <span className={`text-[13px] ${u.is_active ? "text-green-400" : "text-[#666]"}`}>
            {u.is_active ? "Active" : "Suspended"}
          </span>
        </div>
      </td>

      {/* Joined */}
      <td className="px-5 py-3.5 text-[13px] text-[#888]">{joinedDate}</td>

      {/* Actions */}
      <td className="px-5 py-3.5">
        <div className="flex items-center justify-end gap-1.5">
          {/* Change role — cycles through roles */}
          <button
            title="Edit role"
            disabled={disabled}
            onClick={() => {
              const order: Role[] = ["clerk", "manager", "admin", "owner"];
              const next = order[(order.indexOf(u.role as Role) + 1) % order.length];
              onRoleChange(u.id, next);
            }}
            className={`w-8 h-8 rounded-lg border flex items-center justify-center transition-colors
              ${disabled
                ? "opacity-30 cursor-not-allowed border-white/8 text-[#555]"
                : "border-white/10 text-[#888] hover:border-white/20 hover:text-white hover:bg-white/8 cursor-pointer"
              }`}
          >
            <PenLine className="w-3.5 h-3.5" />
          </button>

          {/* Revoke / Restore */}
          <button
            title={u.is_active ? "Suspend access" : "Restore access"}
            disabled={disabled}
            onClick={() => onToggleActive(u.id, !u.is_active)}
            className={`w-8 h-8 rounded-lg border flex items-center justify-center transition-colors
              ${disabled
                ? "opacity-30 cursor-not-allowed border-white/8 text-[#555]"
                : "border-white/10 text-[#888] hover:border-white/20 hover:text-white hover:bg-white/8 cursor-pointer"
              }`}
          >
            {u.is_active
              ? <ShieldOff className="w-3.5 h-3.5" />
              : <Shield    className="w-3.5 h-3.5" />}
          </button>

          {/* Delete */}
          <button
            title="Remove user"
            disabled={disabled}
            onClick={() => onDelete(u.id)}
            className={`w-8 h-8 rounded-lg border flex items-center justify-center transition-colors
              ${disabled
                ? "opacity-30 cursor-not-allowed border-white/8 text-[#555]"
                : "border-white/10 text-[#888] hover:border-red-500/40 hover:text-red-400 hover:bg-red-500/10 cursor-pointer"
              }`}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </td>
    </tr>
  );
}

// ─── Add user dialog ──────────────────────────────────────────────────────────

const EMPTY_FORM = {
  username:     "",
  display_name: "",
  password:     "",
  role:         "clerk" as Role,
};

interface AddUserDialogProps {
  open:          boolean;
  onClose:       () => void;
  onCreated:     () => void;
  currentUserId: number;
  currentRole:   string;
}

function AddUserDialog({
  open, onClose, onCreated, currentUserId, currentRole,
}: AddUserDialogProps) {
  const [form, setForm] = useState(EMPTY_FORM);

  const { mutate: createUser, loading: saving } = useApiMutation(
    (data: typeof EMPTY_FORM & { user_id: number }) =>
      apiCall("/api/users", { method: "POST", body: JSON.stringify(data) })
  );

  const availableRoles = currentRole === "owner"
    ? ROLES
    : ROLES.filter((r) => r.value !== "owner");

  async function handleSubmit() {
    if (!form.username.trim() || !form.display_name.trim() || !form.password.trim()) {
      toast.error("Username, display name, and password are required");
      return;
    }
    const result = await createUser({ ...form, user_id: currentUserId });
    if (result !== null) {
      toast.success("User created");
      setForm(EMPTY_FORM);
      onCreated();
      onClose();
    } else {
      toast.error("Failed to create user");
    }
  }

  function handleClose() {
    setForm(EMPTY_FORM);
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md bg-[#1c1c1e] border-white/10 text-white">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[15px] font-medium text-white">
            <UserPlus className="w-4 h-4 text-blue-400" />
            Add new user
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {[
            { id: "add-display_name", label: "Display name", key: "display_name", type: "text",     ph: "Jane Smith" },
            { id: "add-username",     label: "Username",     key: "username",     type: "text",     ph: "janesmith"  },
            { id: "add-password",     label: "Password",     key: "password",     type: "password", ph: "••••••••"    },
          ].map(({ id, label, key, type, ph }) => (
            <div key={id} className="space-y-1.5">
              <Label htmlFor={id} className="text-[12px] text-[#aaa]">{label}</Label>
              <Input
                id={id}
                type={type}
                placeholder={ph}
                className="bg-white/5 border-white/10 text-white placeholder:text-[#555] focus:border-white/25 h-9 text-sm"
                value={(form as any)[key]}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    [key]: key === "username"
                      ? e.target.value.toLowerCase().trim()
                      : e.target.value,
                  }))
                }
              />
            </div>
          ))}

          <div className="space-y-1.5">
            <Label className="text-[12px] text-[#aaa]">Role</Label>
            <Select
              value={form.role}
              onValueChange={(val) => setForm((f) => ({ ...f, role: val as Role }))}
            >
              <SelectTrigger className="bg-white/5 border-white/10 text-white h-9 text-sm focus:border-white/25">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-[#1c1c1e] border-white/10">
                {availableRoles.map((r) => (
                  <SelectItem key={r.value} value={r.value} className="text-[13px] text-white focus:bg-white/8">
                    <div className="flex items-center gap-1.5">{r.icon} {r.label}</div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={handleClose}
            disabled={saving}
            className="text-[#888] hover:text-white hover:bg-white/8"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={saving}
            className="gap-2 bg-white text-black hover:bg-white/90 font-medium"
          >
            {saving
              ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              : <UserPlus  className="w-3.5 h-3.5" />}
            Create user
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
    apiCall(`/api/users/${id}/role`, { method: "PATCH", body: JSON.stringify({ role }) })
  );
  const { mutate: updateAccess } = useApiMutation(({ id, is_active }: { id: number; is_active: boolean }) =>
    apiCall(`/api/users/${id}/access`, { method: "PATCH", body: JSON.stringify({ is_active }) })
  );
  const { mutate: removeUser }   = useApiMutation((id: number) =>
    apiCall(`/api/users/${id}`, { method: "DELETE" })
  );

  const [search,       setSearch]       = useState("");
  const [roleFilter,   setRoleFilter]   = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
  const [showAdd,      setShowAdd]      = useState(false);

  async function handleRoleChange(id: number, role: Role) {
    const ok = await updateRole({ id, role });
    if (ok !== null) { toast.success("Role updated");         refetch(); }
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
    if (q && !u.display_name?.toLowerCase().includes(q) && !u.username.toLowerCase().includes(q))
      return false;
    if (roleFilter   !== "all" && u.role !== roleFilter)   return false;
    if (statusFilter === "active"   && !u.is_active)       return false;
    if (statusFilter === "inactive" &&  u.is_active)       return false;
    return true;
  });

  const activeCount  = users.filter((u) =>  u.is_active).length;
  const adminCount   = users.filter((u) => u.role === "owner" || u.role === "admin").length;

  // ── Access guard ──────────────────────────────────────────────────────────
  if (currentRole !== "admin" && currentRole !== "owner") {
    return (
      <div className="min-h-screen bg-[#111] flex flex-col items-center justify-center gap-3 text-[#666]">
        <Shield className="w-12 h-12" />
        <p className="text-lg font-medium text-white">Admin access only</p>
        <p className="text-sm">You don't have permission to manage users.</p>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#111] text-white">
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-[22px] font-semibold text-white">User management</h1>
            <p className="text-[13px] text-[#888] mt-0.5">
              Manage roles, permissions, and access for your organization
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={refetch}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 rounded-xl border border-white/15 text-[13px] text-white
                         hover:bg-white/8 transition-colors disabled:opacity-40"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
            <button
              onClick={() => setShowAdd(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl border border-white/15 text-[13px] text-white
                         hover:bg-white/8 transition-colors"
            >
              <UserPlus className="w-3.5 h-3.5" />
              Invite user
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-3">
          <StatCard label="Total users"    value={users.length}  numCls="text-white"       dotCls="bg-[#666]"     />
          <StatCard label="Active"         value={activeCount}   numCls="text-green-400"   dotCls="bg-green-400"  />
          <StatCard label="Suspended"      value={users.length - activeCount} numCls="text-red-400" dotCls="bg-red-400" />
          <StatCard label="Admins & owners" value={adminCount}   numCls="text-purple-400"  dotCls="bg-purple-400" />
        </div>

        {/* Filters */}
        <div className="flex gap-2 flex-wrap">
          {/* Search */}
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#555] pointer-events-none" />
            <input
              type="text"
              placeholder="Search users…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full h-10 pl-9 pr-4 rounded-xl bg-[#1c1c1e] border border-white/8 text-[13px]
                         text-white placeholder:text-[#555] outline-none focus:border-white/20 transition-colors"
            />
          </div>

          {/* Role filter */}
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="h-10 px-3 rounded-xl bg-[#1c1c1e] border border-white/8 text-[13px] text-white
                       outline-none focus:border-white/20 transition-colors min-w-36 cursor-pointer"
          >
            <option value="all">All roles</option>
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>

          {/* Status filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-10 px-3 rounded-xl bg-[#1c1c1e] border border-white/8 text-[13px] text-white
                       outline-none focus:border-white/20 transition-colors min-w-36 cursor-pointer"
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Suspended</option>
          </select>
        </div>

        {/* Table */}
        <div className="rounded-2xl border border-white/8 overflow-hidden">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-[#1a1a1a]">
                {["USER", "ROLE", "STATUS", "JOINED", "ACTIONS"].map((h, i) => (
                  <th
                    key={h}
                    className={`px-5 py-3 text-[11px] font-medium tracking-wider text-[#555]
                      ${i === 4 ? "text-right" : "text-left"}`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-[#111]">
              {loading ? (
                [1, 2, 3].map((i) => (
                  <tr key={i} className="border-t border-white/6">
                    <td colSpan={5} className="px-5 py-3.5">
                      <div className="h-9 bg-white/5 rounded-lg animate-pulse" />
                    </td>
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-12 text-center text-[13px] text-[#555]">
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
        </div>

        {/* Footer count */}
        {!loading && filtered.length > 0 && (
          <p className="text-[12px] text-[#555] text-center">
            Showing {filtered.length} of {users.length} user{users.length !== 1 ? "s" : ""}
          </p>
        )}
      </div>

      {/* Add user dialog */}
      <AddUserDialog
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onCreated={refetch}
        currentUserId={currentUserId}
        currentRole={currentRole}
      />

      {/* Delete confirmation */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent className="bg-[#1c1c1e] border-white/10 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">Remove user?</AlertDialogTitle>
            <AlertDialogDescription className="text-[#888]">
              This will permanently delete the user account and cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-transparent border-white/10 text-[#aaa] hover:bg-white/8 hover:text-white">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white border-0"
              onClick={() => deleteTarget !== null && handleDelete(deleteTarget)}
            >
              Yes, remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}