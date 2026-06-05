import { useState, useEffect, useCallback } from "react";
import {
  Building2, Trash2, RefreshCw, LogOut, Plus,
  AlertTriangle, Users, ShieldCheck, X, UserPlus,
  UserX, RotateCcw, ChevronDown, Power, PowerOff,
  Search, PenLine, Crown, Wrench, User, Shield,
  Activity, Ban, CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import { apiCall, assetUrl } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Company {
  id:         number;
  name:       string;
  slug:       string;
  logo_url:   string | null;
  plan?:      string;
  max_users?: number;
  is_active:  boolean;
  created_at: string;
  user_count?: number;
}

interface CompanyRole {
  id:   number;
  name: string;
}

interface CompanyUser {
  id:           number;
  username:     string;
  display_name: string;
  role_id:      number;
  role:         string;
  is_active:    boolean;
  created_at:   string;
}

type ConfirmAction =
  | { type: "delete";   company: Company }
  | { type: "deactivate"; company: Company }
  | { type: "activate";  company: Company }
  | { type: "purge";    company: Company };

const EMPTY_USER_FORM = { username: "", display_name: "", password: "", role_id: "" };
// ─── Role meta ────────────────────────────────────────────────────────────────

interface RoleMeta { value: string; label: string; icon: React.ReactNode; pill: string; avatar: string; }

const ROLES_META: RoleMeta[] = [
  { value: "owner",   label: "Owner",   icon: <Crown  className="w-3 h-3" />, pill: "border-purple-500/60 text-purple-300", avatar: "bg-purple-500/20 text-purple-300" },
  { value: "admin",   label: "Admin",   icon: <Crown  className="w-3 h-3" />, pill: "border-amber-500/60  text-amber-300",  avatar: "bg-amber-500/20  text-amber-300"  },
  { value: "manager", label: "Manager", icon: <Wrench className="w-3 h-3" />, pill: "border-sky-500/60    text-sky-300",    avatar: "bg-sky-500/20    text-sky-300"    },
  { value: "clerk",   label: "Clerk",   icon: <User   className="w-3 h-3" />, pill: "border-slate-500/60  text-slate-300", avatar: "bg-slate-500/20  text-slate-300"  },
];

function getRoleMeta(role: string): RoleMeta {
  return ROLES_META.find((r) => r.value === role.toLowerCase()) ?? ROLES_META[3];
}

function RolePill({ role }: { role: string }) {
  const m = getRoleMeta(role);
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full border text-[11px] font-medium bg-transparent ${m.pill}`}>
      {m.icon}{m.label}
    </span>
  );
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({
  label, value, numCls, dotCls, icon,
}: { label: string; value: number; numCls: string; dotCls: string; icon?: React.ReactNode }) {
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

// ─── Plan badge ───────────────────────────────────────────────────────────────

function PlanBadge({ plan }: { plan?: string }) {
  if (!plan) return null;
  const map: Record<string, string> = {
    enterprise: "border-purple-500/50 text-purple-300 bg-purple-500/10",
    pro:        "border-blue-500/50   text-blue-300   bg-blue-500/10",
    starter:    "border-slate-500/40  text-slate-400  bg-slate-500/8",
  };
  const cls = map[plan.toLowerCase()] ?? "border-white/15 text-[#888] bg-white/5";
  return (
    <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border ${cls}`}>
      {plan}
    </span>
  );
}

// ─── User sub-row ─────────────────────────────────────────────────────────────

function UserSubRow({
  u, updatingUserId, onDisable, onRestore,
}: {
  u: CompanyUser;
  updatingUserId: number | null;
  onDisable: (id: number) => void;
  onRestore: (id: number) => void;
}) {
  const meta     = getRoleMeta(u.role);
  const initials = (u.display_name || u.username).slice(0, 2).toUpperCase();
  const joined   = u.created_at
    ? new Date(u.created_at).toLocaleDateString("en-US", { month: "short", year: "numeric" })
    : "—";
  const busy = updatingUserId === u.id;

  return (
    <tr className="border-t border-white/5 hover:bg-white/2 transition-colors">
      {/* User */}
      <td className="pl-6 pr-4 py-3">
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-semibold shrink-0 ${u.is_active ? meta.avatar : "bg-white/6 text-[#555]"}`}>
            {initials}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-[13px] font-medium text-white truncate">{u.display_name}</span>
              {!u.is_active && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/6 text-[#666] border border-white/8">suspended</span>
              )}
            </div>
            <p className="text-[11px] text-[#666]">@{u.username}</p>
          </div>
        </div>
      </td>
      {/* Role */}
      <td className="px-4 py-3"><RolePill role={u.role} /></td>
      {/* Status */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${u.is_active ? "bg-green-400" : "bg-[#555]"}`} />
          <span className={`text-[12px] ${u.is_active ? "text-green-400" : "text-[#555]"}`}>
            {u.is_active ? "Active" : "Suspended"}
          </span>
        </div>
      </td>
      {/* Joined */}
      <td className="px-4 py-3 text-[12px] text-[#666]">{joined}</td>
      {/* Actions */}
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-1.5">
          {u.is_active ? (
            <button
              onClick={() => onDisable(u.id)}
              disabled={busy}
              title="Suspend user"
              className="w-7 h-7 flex items-center justify-center rounded-lg border border-white/8 text-[#666] hover:border-red-500/40 hover:text-red-400 hover:bg-red-500/8 transition-colors disabled:opacity-30"
            >
              {busy ? <RefreshCw className="w-3 h-3 animate-spin" /> : <UserX className="w-3 h-3" />}
            </button>
          ) : (
            <button
              onClick={() => onRestore(u.id)}
              disabled={busy}
              title="Restore user"
              className="w-7 h-7 flex items-center justify-center rounded-lg border border-white/8 text-[#666] hover:border-green-500/40 hover:text-green-400 hover:bg-green-500/8 transition-colors disabled:opacity-30"
            >
              {busy ? <RefreshCw className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

// ─── Company row ──────────────────────────────────────────────────────────────

function CompanyRow({
  company, isOpen, onToggle,
  onConfirm,
  users, roles, usersLoading,
  userForm, setUserForm, savingUser, onCreateUser,
  updatingUserId, onDisableUser, onRestoreUser,
  userSearch, setUserSearch,
}: {
  company:        Company;
  isOpen:         boolean;
  onToggle:       () => void;
  onConfirm:      (action: ConfirmAction) => void;
  users:          CompanyUser[];
  roles:          CompanyRole[];
  usersLoading:   boolean;
  userForm:       typeof EMPTY_USER_FORM;
  setUserForm:    React.Dispatch<React.SetStateAction<typeof EMPTY_USER_FORM>>;
  savingUser:     boolean;
  onCreateUser:   () => void;
  updatingUserId: number | null;
  onDisableUser:  (uid: number) => void;
  onRestoreUser:  (uid: number) => void;
  userSearch:     string;
  setUserSearch:  (v: string) => void;
}) {
  const initials    = company.name.slice(0, 2).toUpperCase();
  const isActive    = company.is_active !== false;
  const joinedDate  = company.created_at
    ? new Date(company.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : "—";

  const filteredUsers = users.filter((u) => {
    const q = userSearch.toLowerCase();
    return !q || u.display_name.toLowerCase().includes(q) || u.username.toLowerCase().includes(q);
  });

  const activeUsers = users.filter((u) => u.is_active).length;

  return (
    <div className={`rounded-2xl border overflow-hidden transition-colors ${isActive ? "border-white/8" : "border-white/4 opacity-75"}`}>
      {/* Main row */}
      <div className="bg-[#1c1c1e] px-5 py-4 flex items-center gap-3">
        {/* Avatar */}
        <div className="w-10 h-10 rounded-full shrink-0 overflow-hidden ring-1 ring-white/10">
          {company.logo_url ? (
            <img src={assetUrl(company.logo_url)} alt={company.name} className="w-full h-full object-cover" />
          ) : (
            <div className={`w-full h-full flex items-center justify-center text-[13px] font-semibold ${isActive ? "bg-white/10 text-white" : "bg-white/5 text-[#555]"}`}>
              {initials}
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[14px] font-medium text-white truncate">{company.name}</span>
            <PlanBadge plan={company.plan} />
            {!isActive && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/6 text-[#666] border border-white/8">inactive</span>
            )}
          </div>
          <p className="text-[12px] text-[#666] truncate mt-0.5">
            @{company.slug} · {activeUsers}{company.max_users ? `/${company.max_users}` : ""} active users · Since {joinedDate}
          </p>
        </div>

        {/* Status indicator */}
        <div className="flex items-center gap-1.5 shrink-0">
          <span className={`w-2 h-2 rounded-full ${isActive ? "bg-green-400" : "bg-[#555]"}`} />
          <span className={`text-[12px] ${isActive ? "text-green-400" : "text-[#555]"}`}>
            {isActive ? "Active" : "Inactive"}
          </span>
        </div>

        {/* Toggle users */}
        <button
          onClick={onToggle}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-white/10 text-[13px] text-[#aaa] hover:text-white hover:bg-white/8 hover:border-white/20 transition-colors shrink-0"
        >
          <Users className="w-3.5 h-3.5" />
          <span>{users.length > 0 ? `${users.length} Users` : "Users"}</span>
          <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} />
        </button>

        {/* Action buttons */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Toggle active */}
          <button
            onClick={() => onConfirm(isActive
              ? { type: "deactivate", company }
              : { type: "activate",   company }
            )}
            title={isActive ? "Deactivate company" : "Activate company"}
            className={`w-8 h-8 flex items-center justify-center rounded-xl border transition-colors
              ${isActive
                ? "border-white/10 text-[#888] hover:border-orange-500/40 hover:text-orange-400 hover:bg-orange-500/8"
                : "border-white/10 text-[#888] hover:border-green-500/40  hover:text-green-400  hover:bg-green-500/8"
              }`}
          >
            {isActive ? <PowerOff className="w-3.5 h-3.5" /> : <Power className="w-3.5 h-3.5" />}
          </button>

          {/* Purge data */}
          <button
            onClick={() => onConfirm({ type: "purge", company })}
            title="Purge all company data"
            className="w-8 h-8 flex items-center justify-center rounded-xl border border-white/10 text-[#888] hover:border-orange-500/40 hover:text-orange-400 hover:bg-orange-500/8 transition-colors"
          >
            <Ban className="w-3.5 h-3.5" />
          </button>

          {/* Delete */}
          <button
            onClick={() => onConfirm({ type: "delete", company })}
            title="Delete company"
            className="w-8 h-8 flex items-center justify-center rounded-xl border border-white/10 text-[#888] hover:border-red-500/40 hover:text-red-400 hover:bg-red-500/8 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Expanded users panel */}
      {isOpen && (
        <div className="border-t border-white/6 bg-[#141414]">
          {/* Add user form */}
          <div className="px-5 pt-4 pb-3 border-b border-white/5">
            <p className="text-[11px] font-medium text-[#666] uppercase tracking-wider mb-3">Add User</p>
            <div className="grid grid-cols-1 md:grid-cols-[1.2fr_1fr_1fr_0.8fr_auto] gap-2">
              {[
                { ph: "Display name", key: "display_name", type: "text" },
                { ph: "Username",     key: "username",     type: "text" },
                { ph: "Password",     key: "password",     type: "password" },
              ].map(({ ph, key, type }) => (
                <input
                  key={key}
                  type={type}
                  placeholder={ph}
                  value={(userForm as any)[key]}
                  onChange={(e) =>
                    setUserForm((f) => ({
                      ...f,
                      [key]: key === "username" ? e.target.value.toLowerCase().trim() : e.target.value,
                    }))
                  }
                  className="h-9 rounded-xl border border-white/8 bg-white/5 px-3 text-[13px] text-white placeholder:text-[#444] outline-none focus:border-white/20 transition-colors"
                />
              ))}
              <select
                value={userForm.role_id || roles[0]?.id || ""}
                onChange={(e) => setUserForm((f) => ({ ...f, role_id: e.target.value }))}
                disabled={roles.length === 0}
                className="h-9 rounded-xl border border-white/8 bg-white/5 px-3 text-[13px] text-white outline-none focus:border-white/20 transition-colors cursor-pointer disabled:opacity-40"
              >
                {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              <button
                onClick={onCreateUser}
                disabled={savingUser || usersLoading || roles.length === 0}
                className="h-9 px-4 flex items-center gap-2 rounded-xl bg-white text-black text-[13px] font-medium hover:bg-white/90 transition-colors disabled:opacity-40 shrink-0"
              >
                {savingUser
                  ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  : <UserPlus  className="w-3.5 h-3.5" />}
                Add
              </button>
            </div>
          </div>

          {/* User table */}
          <div className="px-5 py-3">
            {/* Search + count */}
            <div className="flex items-center gap-3 mb-3">
              <div className="relative flex-1 max-w-xs">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3 h-3 text-[#444] pointer-events-none" />
                <input
                  type="text"
                  placeholder="Search users…"
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  className="w-full h-8 pl-8 pr-3 rounded-xl bg-white/5 border border-white/8 text-[12px] text-white placeholder:text-[#444] outline-none focus:border-white/20 transition-colors"
                />
              </div>
              {!usersLoading && users.length > 0 && (
                <p className="text-[12px] text-[#555]">
                  {filteredUsers.length} of {users.length} user{users.length !== 1 ? "s" : ""}
                </p>
              )}
            </div>

            {usersLoading ? (
              <div className="space-y-2 pb-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-12 rounded-xl bg-white/4 animate-pulse" />
                ))}
              </div>
            ) : users.length === 0 ? (
              <div className="h-20 rounded-xl border border-dashed border-white/8 flex items-center justify-center text-[13px] text-[#444] mb-3">
                No users in this company yet
              </div>
            ) : (
              <div className="rounded-xl border border-white/6 overflow-hidden mb-3">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-[#1a1a1a]">
                      {["USER", "ROLE", "STATUS", "JOINED", "ACTIONS"].map((h, i) => (
                        <th
                          key={h}
                          className={`px-4 py-2.5 text-[10px] font-medium tracking-wider text-[#444] ${i === 0 ? "pl-6" : ""} ${i === 4 ? "text-right" : "text-left"}`}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="bg-[#111]">
                    {filteredUsers.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-[12px] text-[#444]">
                          No users match your search
                        </td>
                      </tr>
                    ) : (
                      filteredUsers.map((u) => (
                        <UserSubRow
                          key={u.id}
                          u={u}
                          updatingUserId={updatingUserId}
                          onDisable={onDisableUser}
                          onRestore={onRestoreUser}
                        />
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Confirm modal ────────────────────────────────────────────────────────────

const CONFIRM_CONFIG = {
  delete: {
    icon:    <Trash2 className="w-5 h-5 text-red-400" />,
    iconBg:  "bg-red-500/15",
    title:   "Delete company",
    desc:    (name: string) => `Permanently deletes "${name}" and all its data. This cannot be undone.`,
    confirm: "Delete",
    btnCls:  "bg-red-600 hover:bg-red-700",
  },
  deactivate: {
    icon:    <PowerOff className="w-5 h-5 text-orange-400" />,
    iconBg:  "bg-orange-500/15",
    title:   "Deactivate company",
    desc:    (name: string) => `Users of "${name}" will lose access immediately. You can reactivate anytime.`,
    confirm: "Deactivate",
    btnCls:  "bg-orange-600 hover:bg-orange-700",
  },
  activate: {
    icon:    <CheckCircle2 className="w-5 h-5 text-green-400" />,
    iconBg:  "bg-green-500/15",
    title:   "Activate company",
    desc:    (name: string) => `Restore access for all users of "${name}".`,
    confirm: "Activate",
    btnCls:  "bg-green-600 hover:bg-green-700",
  },
  purge: {
    icon:    <Ban className="w-5 h-5 text-orange-400" />,
    iconBg:  "bg-orange-500/15",
    title:   "Purge company data",
    desc:    (name: string) => `This will permanently erase all transactions, records, and data for "${name}". The company account itself will remain. This cannot be undone.`,
    confirm: "Purge Data",
    btnCls:  "bg-orange-600 hover:bg-orange-700",
  },
};

function ConfirmModal({
  action, loading, onConfirm, onCancel,
}: {
  action:    ConfirmAction;
  loading:   boolean;
  onConfirm: () => void;
  onCancel:  () => void;
}) {
  const cfg = CONFIRM_CONFIG[action.type];
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
      <div className="w-full max-w-sm bg-[#1c1c1e] border border-white/10 rounded-2xl p-6 shadow-2xl">
        <div className="flex items-start gap-3 mb-5">
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${cfg.iconBg}`}>
            {cfg.icon}
          </div>
          <div className="flex-1">
            <h3 className="text-[14px] font-semibold text-white">{cfg.title}</h3>
            <p className="text-[12px] text-[#888] mt-1 leading-relaxed">
              {cfg.desc(action.company.name)}
            </p>
          </div>
          <button onClick={onCancel} className="text-[#555] hover:text-white transition-colors mt-0.5">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            disabled={loading}
            className="flex-1 h-9 rounded-xl border border-white/10 text-[13px] text-[#aaa] hover:text-white hover:bg-white/8 transition-colors disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={`flex-1 h-9 rounded-xl text-[13px] text-white font-medium flex items-center justify-center gap-2 transition-colors disabled:opacity-40 ${cfg.btnCls}`}
          >
            {loading
              ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              : cfg.icon}
            {loading ? "Processing…" : cfg.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function SuperAdminPanel() {
  const { logout } = useAuth();

  const [companies,      setCompanies]      = useState<Company[]>([]);
  const [loading,        setLoading]        = useState(true);
  const [confirmAction,  setConfirmAction]  = useState<ConfirmAction | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [openCompanyId,  setOpenCompanyId]  = useState<number | null>(null);
  const [usersByCompany, setUsersByCompany] = useState<Record<number, CompanyUser[]>>({});
  const [rolesByCompany, setRolesByCompany] = useState<Record<number, CompanyRole[]>>({});
  const [usersLoading,   setUsersLoading]   = useState(false);
  const [userForm,       setUserForm]       = useState(EMPTY_USER_FORM);
  const [savingUser,     setSavingUser]     = useState(false);
  const [updatingUserId, setUpdatingUserId] = useState<number | null>(null);
  const [companySearch,  setCompanySearch]  = useState("");
  const [statusFilter,   setStatusFilter]   = useState("all");
  const [userSearch,     setUserSearch]     = useState("");

  const fetchCompanies = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await apiCall<any>("/api/superadmin/companies");
      const list = Array.isArray(res) ? res : (res.companies ?? res.data ?? []);
      setCompanies(list);
    } catch {
      toast.error("Failed to load companies");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchCompanies(); }, [fetchCompanies]);

  const fetchCompanyUsers = useCallback(async (companyId: number) => {
    setUsersLoading(true);
    try {
      const [usersRes, rolesRes] = await Promise.all([
        apiCall<any>(`/api/superadmin/companies/${companyId}/users`),
        apiCall<any>(`/api/superadmin/companies/${companyId}/roles`),
      ]);
      const users = Array.isArray(usersRes) ? usersRes : (usersRes.users ?? usersRes.data ?? []);
      const roles = Array.isArray(rolesRes) ? rolesRes : (rolesRes.roles ?? rolesRes.data ?? []);
      setUsersByCompany((p) => ({ ...p, [companyId]: users }));
      setRolesByCompany((p) => ({ ...p, [companyId]: roles }));
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to load users");
    } finally {
      setUsersLoading(false);
    }
  }, []);

  async function toggleCompanyUsers(companyId: number) {
    const nextId = openCompanyId === companyId ? null : companyId;
    setOpenCompanyId(nextId);
    setUserForm(EMPTY_USER_FORM);
    setUserSearch("");
    if (nextId) await fetchCompanyUsers(nextId);
  }

  async function handleCreateUser(companyId: number) {
    const roleId = Number(userForm.role_id || rolesByCompany[companyId]?.[0]?.id);
    if (!userForm.username.trim() || !userForm.display_name.trim() || !userForm.password.trim() || !roleId) {
      toast.error("All fields are required");
      return;
    }
    setSavingUser(true);
    try {
      await apiCall(`/api/superadmin/companies/${companyId}/users`, {
        method: "POST",
        body: JSON.stringify({
          username:     userForm.username.trim(),
          display_name: userForm.display_name.trim(),
          password:     userForm.password,
          role_id:      roleId,
        }),
      });
      toast.success("User created");
      setUserForm(EMPTY_USER_FORM);
      await fetchCompanyUsers(companyId);
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to create user");
    } finally {
      setSavingUser(false);
    }
  }

  async function handleDisableUser(companyId: number, userId: number) {
    setUpdatingUserId(userId);
    try {
      await apiCall(`/api/superadmin/companies/${companyId}/users/${userId}`, { method: "DELETE" });
      toast.success("User suspended");
      await fetchCompanyUsers(companyId);
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to suspend user");
    } finally {
      setUpdatingUserId(null);
    }
  }

  async function handleRestoreUser(companyId: number, userId: number) {
    setUpdatingUserId(userId);
    try {
      await apiCall(`/api/superadmin/companies/${companyId}/users/${userId}/restore`, { method: "PATCH" });
      toast.success("User restored");
      await fetchCompanyUsers(companyId);
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to restore user");
    } finally {
      setUpdatingUserId(null);
    }
  }

  async function executeConfirmAction() {
    if (!confirmAction) return;
    setConfirmLoading(true);
    const { type, company } = confirmAction;
    try {
      if (type === "delete") {
        await apiCall(`/api/superadmin/companies/${company.id}`, { method: "DELETE" });
        setCompanies((p) => p.filter((c) => c.id !== company.id));
        toast.success(`${company.name} deleted`);
      } else if (type === "deactivate") {
        await apiCall(`/api/superadmin/companies/${company.id}/deactivate`, { method: "PATCH" });
        setCompanies((p) => p.map((c) => c.id === company.id ? { ...c, is_active: false } : c));
        toast.success(`${company.name} deactivated`);
      } else if (type === "activate") {
        await apiCall(`/api/superadmin/companies/${company.id}/activate`, { method: "PATCH" });
        setCompanies((p) => p.map((c) => c.id === company.id ? { ...c, is_active: true } : c));
        toast.success(`${company.name} activated`);
      } else if (type === "purge") {
        await apiCall(`/api/superadmin/companies/${company.id}/purge`, { method: "DELETE" });
        toast.success(`Data purged for ${company.name}`);
        if (openCompanyId === company.id) await fetchCompanyUsers(company.id);
      }
      setConfirmAction(null);
    } catch (err: any) {
      toast.error(err?.message ?? "Action failed");
    } finally {
      setConfirmLoading(false);
    }
  }

  // Filtered companies
  const filtered = companies.filter((c) => {
    const q = companySearch.toLowerCase();
    if (q && !c.name.toLowerCase().includes(q) && !c.slug.toLowerCase().includes(q)) return false;
    if (statusFilter === "active"   && !c.is_active)  return false;
    if (statusFilter === "inactive" &&  c.is_active)  return false;
    return true;
  });

  const activeCount   = companies.filter((c) => c.is_active !== false).length;
  const inactiveCount = companies.length - activeCount;
  const totalUsers    = companies.reduce((sum, c) => sum + (c.user_count ?? 0), 0);

  return (
    <div className="min-h-screen bg-[#111] text-white">

      {/* Top bar */}
      <header className="border-b border-white/8 bg-[#111]/95 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img
              src="/logo.gif"
              alt="STARK AI"
              className="w-8 h-8 rounded-lg object-cover"
            />
            <span className="text-[14px] font-semibold text-white">STARK AI</span>
            <span className="text-[11px] text-purple-300 font-medium bg-purple-500/15 border border-purple-500/30 px-2 py-0.5 rounded-full">
              System Owner
            </span>
          </div>
          <button
            onClick={logout}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-[13px] text-[#888] hover:text-white hover:bg-white/8 transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign out
          </button>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">

        {/* Page header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-[22px] font-semibold text-white">Company Management</h1>
            <p className="text-[13px] text-[#888] mt-0.5">
              Manage tenants, user access, and data across the platform
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={fetchCompanies}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 rounded-xl border border-white/15 text-[13px] text-white hover:bg-white/8 transition-colors disabled:opacity-40"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
            <button
              onClick={() => window.location.href = "/register"}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white text-black text-[13px] font-medium hover:bg-white/90 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Company
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-3">
          <StatCard label="Total companies" value={companies.length} numCls="text-white"       dotCls="bg-[#666]"     />
          <StatCard label="Active"          value={activeCount}      numCls="text-green-400"   dotCls="bg-green-400"  />
          <StatCard label="Inactive"        value={inactiveCount}    numCls="text-orange-400"  dotCls="bg-orange-400" />
          <StatCard label="Total users"     value={totalUsers}       numCls="text-purple-400"  dotCls="bg-purple-400" />
        </div>

        {/* Filters */}
        <div className="flex gap-2 flex-wrap">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#555] pointer-events-none" />
            <input
              type="text"
              placeholder="Search companies…"
              value={companySearch}
              onChange={(e) => setCompanySearch(e.target.value)}
              className="w-full h-10 pl-9 pr-4 rounded-xl bg-[#1c1c1e] border border-white/8 text-[13px] text-white placeholder:text-[#555] outline-none focus:border-white/20 transition-colors"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-10 px-3 rounded-xl bg-[#1c1c1e] border border-white/8 text-[13px] text-white outline-none focus:border-white/20 transition-colors min-w-36 cursor-pointer"
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>

        {/* Company list */}
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 bg-white/5 rounded-2xl animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 gap-3 text-[#555]">
            <Building2 className="w-10 h-10" />
            <p className="text-[13px]">
              {companies.length === 0 ? "No companies registered yet" : "No companies match your filters"}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((company) => {
              const isOpen = openCompanyId === company.id;
              return (
                <CompanyRow
                  key={company.id}
                  company={company}
                  isOpen={isOpen}
                  onToggle={() => toggleCompanyUsers(company.id)}
                  onConfirm={setConfirmAction}
                  users={usersByCompany[company.id] ?? []}
                  roles={rolesByCompany[company.id] ?? []}
                  usersLoading={isOpen && usersLoading}
                  userForm={userForm}
                  setUserForm={setUserForm}
                  savingUser={savingUser}
                  onCreateUser={() => handleCreateUser(company.id)}
                  updatingUserId={updatingUserId}
                  onDisableUser={(uid) => handleDisableUser(company.id, uid)}
                  onRestoreUser={(uid) => handleRestoreUser(company.id, uid)}
                  userSearch={userSearch}
                  setUserSearch={setUserSearch}
                />
              );
            })}
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <p className="text-[12px] text-[#555] text-center">
            Showing {filtered.length} of {companies.length} {companies.length === 1 ? "company" : "companies"}
          </p>
        )}
      </div>

      {/* Confirm modal */}
      {confirmAction && (
        <ConfirmModal
          action={confirmAction}
          loading={confirmLoading}
          onConfirm={executeConfirmAction}
          onCancel={() => setConfirmAction(null)}
        />
      )}
    </div>
  );
}
