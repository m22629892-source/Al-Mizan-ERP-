import React, { useState, useEffect } from 'react';
import {
  ShieldCheck, UserCheck, History, Lock, Plus, Key, ToggleLeft, ToggleRight,
  CheckCircle2, XCircle, AlertCircle, X, Search, Shield, Edit, Trash2, Save,
  CheckSquare, Square, RotateCcw
} from 'lucide-react';
import { User, AuditLog, Branch, Warehouse } from '../types.ts';
import { apiClient } from '../services/apiClient';
import { ConfirmModal } from './ConfirmModal';
import { SCREEN_PERMISSIONS_CONFIG, SECURITY_CONTROLS_CONFIG } from '../utils/permissions';

interface UsersAndAuditViewProps {
  token: string;
  currentUser: User | null;
  lang: 'ar' | 'en';
}

export const UsersAndAuditView: React.FC<UsersAndAuditViewProps> = ({ token, currentUser, lang }) => {
  const [activeTab, setActiveTab] = useState<'users' | 'matrix' | 'audit'>('users');
  const [usersList, setUsersList] = useState<User[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState('');

  // Modals
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [resetPassUser, setResetPassUser] = useState<User | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Individual User Permissions State
  const [permissionUser, setPermissionUser] = useState<User | null>(null);
  const [customPermissions, setCustomPermissions] = useState(false);
  const [individualPermissions, setIndividualPermissions] = useState<string[]>([]);
  const [rolePermissions, setRolePermissions] = useState<string[]>([]);
  const [savingIndividualPermissions, setSavingIndividualPermissions] = useState(false);
  const [userPermModalTab, setUserPermModalTab] = useState<'screens' | 'security' | 'all'>('screens');

  // Deletion and Status Modal State
  const [userToDelete, setUserToDelete] = useState<User | null>(null);
  const [isDeletingUser, setIsDeletingUser] = useState(false);
  const [userToToggleActive, setUserToToggleActive] = useState<User | null>(null);

  // New User Form State
  const [formUsername, setFormUsername] = useState('');
  const [formDisplayName, setFormDisplayName] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [formRole, setFormRole] = useState('accountant');
  const [formBranchScope, setFormBranchScope] = useState('*');
  const [formWarehouseScope, setFormWarehouseScope] = useState('*');

  // Edit User Form State
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editRole, setEditRole] = useState('');
  const [editBranchScope, setEditBranchScope] = useState('*');
  const [editWarehouseScope, setEditWarehouseScope] = useState('*');

  // Permissions Matrix State
  const [matrixRoles, setMatrixRoles] = useState<any[]>([]);
  const [availablePermissions, setAvailablePermissions] = useState<any[]>([]);
  const [rolePermissionsMatrix, setRolePermissionsMatrix] = useState<Record<string, string[]>>({});
  const [selectedMatrixRole, setSelectedMatrixRole] = useState<string>('accountant');
  const [savingMatrix, setSavingMatrix] = useState(false);

  // Audit filter
  const [auditSearch, setAuditSearch] = useState('');

  const canManage = currentUser?.role === 'owner' || currentUser?.role === 'admin' || (currentUser?.permissions || []).includes('manage_settings');

  const loadData = async () => {
    setLoading(true);
    try {
      const [uData, aData] = await Promise.all([
        apiClient.get('/users'),
        apiClient.get('/audit-logs')
      ]);
      if (uData.users) setUsersList(uData.users);
      if (aData.logs) setAuditLogs(aData.logs);
    } catch (err: any) {
      setError(err.message || 'فشل تحميل بيانات المستخدمين والتدقيق');
    } finally {
      setLoading(false);
    }
  };

  const loadPermissionsMatrix = async () => {
    try {
      const data = await apiClient.get('/permissions-matrix');
      if (data.roles) setMatrixRoles(data.roles);
      if (data.availablePermissions) setAvailablePermissions(data.availablePermissions);
      if (data.matrix) setRolePermissionsMatrix(data.matrix);
    } catch (err: any) {
      console.error('Error fetching permissions matrix:', err);
    }
  };

  useEffect(() => {
    loadData();
    loadPermissionsMatrix();
  }, [token]);

  const openIndividualPermissions = async (user: User) => {
    setError(null);
    try {
      const data = await apiClient.get(`/users/${user.id}/permissions`);
      setPermissionUser(user);
      setCustomPermissions(Boolean(data.custom));
      setIndividualPermissions(data.permissions || []);
      setRolePermissions(data.rolePermissions || []);
    } catch (err: any) {
      setError(err.message || 'فشل جلب صلاحيات المستخدم.');
    }
  };

  const handleSaveIndividualPermissions = async () => {
    if (!permissionUser) return;
    setSavingIndividualPermissions(true);
    setError(null);
    try {
      const res = await apiClient.put(`/users/${permissionUser.id}/permissions`, {
        custom: customPermissions,
        permissions: customPermissions ? individualPermissions : null
      });
      setSuccessMsg(res.message || 'تم حفظ الصلاحيات الفردية بنجاح.');
      setPermissionUser(null);
      await loadData();
    } catch (err: any) {
      setError(err.message || 'فشل حفظ الصلاحيات الفردية.');
    } finally {
      setSavingIndividualPermissions(false);
    }
  };

  const handleConfirmToggleActive = async () => {
    if (!userToToggleActive) return;
    const newStatus = userToToggleActive.is_active === 1 ? 0 : 1;
    setError(null);
    try {
      await apiClient.put(`/users/${userToToggleActive.id}`, { is_active: newStatus });
      setSuccessMsg(`تم ${newStatus === 1 ? 'تفعيل' : 'تعطيل'} حساب المستخدم "${userToToggleActive.display_name}" بنجاح.`);
      setUserToToggleActive(null);
      await loadData();
    } catch (err: any) {
      setError(err.message || 'فشل تعديل حالة المستخدم.');
      setUserToToggleActive(null);
    }
  };

  const handleResetPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetPassUser || !newPassword) return;

    setError(null);
    try {
      setIsSubmitting(true);
      await apiClient.put(`/users/${resetPassUser.id}`, { password: newPassword });
      setSuccessMsg(`تم تحديث كلمة المرور للمستخدم "${resetPassUser.display_name}" بنجاح.`);
      setResetPassUser(null);
      setNewPassword('');
    } catch (err: any) {
      setError(err.message || 'فشل تحديث كلمة المرور.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreateUserSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formUsername || !formPassword || !formDisplayName) {
      setError('يرجى تعبئة كافة الحقول المطلوبة لإنشاء المستخدم.');
      return;
    }

    setError(null);
    try {
      setIsSubmitting(true);
      await apiClient.post('/users', {
        username: formUsername,
        password: formPassword,
        display_name: formDisplayName,
        role: formRole,
        allowed_branch_ids: formBranchScope,
        allowed_warehouse_ids: formWarehouseScope
      });

      setSuccessMsg(`تم إنشاء المستخدم "${formDisplayName}" بنجاح.`);
      setIsCreateOpen(false);
      setFormUsername('');
      setFormDisplayName('');
      setFormPassword('');
      await loadData();
    } catch (err: any) {
      setError(err.message || 'فشل إنشاء المستخدم.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenEditUser = (user: User) => {
    setEditingUser(user);
    setEditDisplayName(user.display_name);
    setEditRole(user.role);
    setEditBranchScope(user.allowed_branch_ids || '*');
    setEditWarehouseScope(user.allowed_warehouse_ids || '*');
    setError(null);
  };

  const handleUpdateUserSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;

    setError(null);
    try {
      setIsSubmitting(true);
      await apiClient.put(`/users/${editingUser.id}`, {
        display_name: editDisplayName,
        role: editRole,
        allowed_branch_ids: editBranchScope,
        allowed_warehouse_ids: editWarehouseScope
      });

      setSuccessMsg(`تم تحديث بيانات المستخدم "${editDisplayName}" بنجاح.`);
      setEditingUser(null);
      await loadData();
    } catch (err: any) {
      setError(err.message || 'فشل تحديث بيانات المستخدم.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmDeleteUser = async () => {
    if (!userToDelete) return;
    setIsDeletingUser(true);
    setError(null);

    try {
      await apiClient.del(`/users/${userToDelete.id}`);
      setSuccessMsg(`تم حذف المستخدم "${userToDelete.display_name}" بنجاح.`);
      setUserToDelete(null);
      await loadData();
    } catch (err: any) {
      setError(`تعذر حذف المستخدم: ${err.message}`);
      setUserToDelete(null);
    } finally {
      setIsDeletingUser(false);
    }
  };

  // Matrix Permission Toggle
  const handleToggleRolePermission = (permKey: string) => {
    if (selectedMatrixRole === 'owner' && currentUser?.role !== 'owner') {
      setError('صلاحيات المالك محمية ولا يمكن تعديلها إلا من المالك.');
      return;
    }

    setRolePermissionsMatrix(prev => {
      const currentList = prev[selectedMatrixRole] || [];
      const hasPerm = currentList.includes(permKey);
      const nextList = hasPerm
        ? currentList.filter(k => k !== permKey)
        : [...currentList, permKey];
      return { ...prev, [selectedMatrixRole]: nextList };
    });
  };

  const handleSaveRolePermissions = async () => {
    setSavingMatrix(true);
    setError(null);
    try {
      const perms = rolePermissionsMatrix[selectedMatrixRole] || [];
      const res = await apiClient.put(`/roles/${selectedMatrixRole}/permissions`, {
        permissions: perms
      });
      setSuccessMsg(res.message || 'تم حفظ صلاحيات الدور بنجاح.');
      await loadPermissionsMatrix();
    } catch (err: any) {
      setError(err.message || 'فشل حفظ الصلاحيات.');
    } finally {
      setSavingMatrix(false);
    }
  };

  const filteredAudit = auditLogs.filter(l => {
    const s = auditSearch.toLowerCase();
    return (
      (l.action && l.action.toLowerCase().includes(s)) ||
      (l.display_name && l.display_name.toLowerCase().includes(s)) ||
      (l.user_id && l.user_id.toLowerCase().includes(s)) ||
      (l.entity_type && l.entity_type.toLowerCase().includes(s)) ||
      (l.details && l.details.toLowerCase().includes(s))
    );
  });

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-slate-900 rounded-2xl p-6 text-white flex flex-col md:flex-row md:items-center justify-between gap-4 border border-slate-800 shadow-xl">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="px-2.5 py-1 rounded-md bg-emerald-500/20 text-emerald-400 font-mono text-xs font-semibold border border-emerald-500/30">
              RBAC & IMMUTABLE AUDIT ENGINE
            </span>
          </div>
          <h2 className="text-xl font-bold flex items-center gap-2 text-white">
            <Shield className="w-6 h-6 text-emerald-400" />
            <span>إدارة المستخدمين والأدوار والرقابة الداخلية التدقيقية</span>
          </h2>
          <p className="text-xs text-slate-400 mt-1 max-w-2xl leading-relaxed">
            التحكم الدقيق في الأدوار والصلاحيات، حظر التعديل المالي العشوائي، وعزل بيانات التكلفة والربحية مع تسجيل تدقيقي غير قابل للتعديل (WORM compliant).
          </p>
        </div>

        {canManage && (
          <button
            onClick={() => setIsCreateOpen(true)}
            className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold text-xs flex items-center gap-2 transition shadow-lg shadow-emerald-900/30 self-start md:self-auto"
          >
            <Plus className="w-4 h-4" />
            <span>{lang === 'ar' ? 'إضافة مستخدم جديد' : 'Add New User'}</span>
          </button>
        )}
      </div>

      {successMsg && (
        <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center justify-between">
          <span>{successMsg}</span>
          <button onClick={() => setSuccessMsg('')}><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex bg-slate-800/80 p-1 rounded-xl w-full sm:w-auto self-start border border-slate-700/60">
        <button
          onClick={() => setActiveTab('users')}
          className={`px-4 py-2 rounded-lg text-xs font-bold transition flex items-center gap-2 ${
            activeTab === 'users' ? 'bg-emerald-600 text-white shadow-md' : 'text-slate-300 hover:text-white'
          }`}
        >
          <UserCheck className="w-4 h-4" />
          <span>{lang === 'ar' ? 'سجل المستخدمين' : 'Users Directory'} ({usersList.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('matrix')}
          className={`px-4 py-2 rounded-lg text-xs font-bold transition flex items-center gap-2 ${
            activeTab === 'matrix' ? 'bg-emerald-600 text-white shadow-md' : 'text-slate-300 hover:text-white'
          }`}
        >
          <ShieldCheck className="w-4 h-4" />
          <span>{lang === 'ar' ? 'مصفوفة الصلاحيات التفاعلية' : 'Permissions Matrix'}</span>
        </button>

        <button
          onClick={() => setActiveTab('audit')}
          className={`px-4 py-2 rounded-lg text-xs font-bold transition flex items-center gap-2 ${
            activeTab === 'audit' ? 'bg-emerald-600 text-white shadow-md' : 'text-slate-300 hover:text-white'
          }`}
        >
          <History className="w-4 h-4" />
          <span>{lang === 'ar' ? 'سجل التدقيق الرقابي' : 'Audit Logs'} ({auditLogs.length})</span>
        </button>
      </div>

      {/* Tab 1: Users Directory */}
      {activeTab === 'users' && (
        <div className="bg-slate-800/60 rounded-2xl border border-slate-700/60 overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="bg-slate-900/60 text-slate-300 border-b border-slate-700/80 text-xs">
                <tr>
                  <th className="py-3 px-4">{lang === 'ar' ? 'اسم الدخول' : 'Username'}</th>
                  <th className="py-3 px-4">{lang === 'ar' ? 'الاسم المعروض' : 'Display Name'}</th>
                  <th className="py-3 px-4">{lang === 'ar' ? 'الدور الوظيفي' : 'Role'}</th>
                  <th className="py-3 px-4">{lang === 'ar' ? 'نطاق الفروع والمخازن' : 'Scope'}</th>
                  <th className="py-3 px-4">{lang === 'ar' ? 'الحالة' : 'Status'}</th>
                  <th className="py-3 px-4 text-center">{lang === 'ar' ? 'إجراءات الأمان' : 'Actions'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/40 text-slate-200 text-xs">
                {usersList.map(u => (
                  <tr key={u.id} className="hover:bg-slate-700/30 transition">
                    <td className="py-3 px-4 font-mono font-medium text-emerald-400">{u.username}</td>
                    <td className="py-3 px-4 font-medium">{u.display_name}</td>
                    <td className="py-3 px-4">
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-semibold bg-slate-700 text-slate-200 border border-slate-600">
                        {u.role}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-400">
                      <div>فروع: {u.allowed_branch_ids === '*' ? 'كافة الفروع' : u.allowed_branch_ids}</div>
                      <div>مخازن: {u.allowed_warehouse_ids === '*' ? 'كافة المخازن' : u.allowed_warehouse_ids}</div>
                    </td>
                    <td className="py-3 px-4">
                      {u.is_active === 1 ? (
                        <span className="inline-flex items-center gap-1 text-xs text-emerald-400 font-medium">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>نشط</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-rose-400 font-medium">
                          <XCircle className="w-3.5 h-3.5" />
                          <span>معطل</span>
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        {canManage && (
                          <>
                            {currentUser?.role === 'owner' && u.role !== 'owner' && (
                              <button
                                type="button"
                                onClick={() => openIndividualPermissions(u)}
                                className="px-2 py-1 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 hover:text-emerald-200 border border-emerald-500/30 rounded-lg text-xs font-semibold flex items-center gap-1 transition"
                                title="تخصيص صلاحيات مستقلة لهذا المستخدم"
                              >
                                <Shield className="w-3.5 h-3.5 text-emerald-400" />
                                <span>صلاحيات المستخدم</span>
                              </button>
                            )}

                            <button
                              onClick={() => handleOpenEditUser(u)}
                              disabled={u.role === 'owner' && currentUser?.role !== 'owner'}
                              className="p-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 hover:text-white transition disabled:opacity-30"
                              title="تعديل بيانات المستخدم"
                            >
                              <Edit className="w-3.5 h-3.5" />
                            </button>

                            <button
                              onClick={() => setUserToToggleActive(u)}
                              disabled={u.role === 'owner'}
                              className={`p-1.5 rounded-lg text-xs font-medium transition ${
                                u.is_active === 1
                                  ? 'bg-rose-500/10 text-rose-300 hover:bg-rose-500/20'
                                  : 'bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
                              } disabled:opacity-30`}
                              title={u.is_active === 1 ? 'تعطيل الحساب' : 'تفعيل الحساب'}
                            >
                              {u.is_active === 1 ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
                            </button>

                            <button
                              onClick={() => setResetPassUser(u)}
                              className="p-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 hover:text-white transition"
                              title="إعادة تعيين كلمة المرور"
                            >
                              <Key className="w-3.5 h-3.5" />
                            </button>

                            <button
                              onClick={() => setUserToDelete(u)}
                              disabled={u.role === 'owner'}
                              className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 hover:text-rose-200 transition disabled:opacity-30"
                              title="حذف المستخدم"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 2: Interactive Permissions Matrix */}
      {activeTab === 'matrix' && (
        <div className="bg-slate-800/60 rounded-2xl border border-slate-700/60 p-6 shadow-xl space-y-5">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4 bg-blue-500/10 border border-blue-500/20 rounded-xl text-xs text-blue-200">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 shrink-0 text-blue-400" />
              <span>
                مصفوفة الصلاحيات محددة على مستوى الخادم بشكل صارم. يمكنك تخصيص وتعديل صلاحيات كل دور وظيفي وحفظها مباشرة.
              </span>
            </div>

            <button
              onClick={handleSaveRolePermissions}
              disabled={savingMatrix}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg flex items-center gap-1.5 transition self-end sm:self-auto shrink-0"
            >
              <Save className="w-4 h-4" />
              <span>{savingMatrix ? 'جارٍ الحفظ...' : 'حفظ تعديلات الدور'}</span>
            </button>
          </div>

          {/* Role selector tabs */}
          <div className="flex items-center gap-2 overflow-x-auto pb-2 text-xs">
            {matrixRoles.map(r => (
              <button
                key={r.id}
                onClick={() => setSelectedMatrixRole(r.id)}
                className={`px-3 py-1.5 rounded-lg whitespace-nowrap font-medium transition ${
                  selectedMatrixRole === r.id
                    ? 'bg-emerald-600 text-white font-bold shadow-md'
                    : 'bg-slate-900/60 text-slate-300 hover:bg-slate-700/60'
                }`}
              >
                {r.name}
              </button>
            ))}
          </div>

          {/* Permissions checkboxes grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {availablePermissions.map(perm => {
              const currentList = rolePermissionsMatrix[selectedMatrixRole] || [];
              const isChecked = currentList.includes(perm.key);
              const isStorekeeperBlocked = selectedMatrixRole === 'storekeeper' && (perm.key === 'view_cost' || perm.key === 'view_profit');

              return (
                <div
                  key={perm.key}
                  onClick={() => !isStorekeeperBlocked && handleToggleRolePermission(perm.key)}
                  className={`p-3 rounded-xl border flex items-center justify-between cursor-pointer transition ${
                    isChecked
                      ? 'bg-emerald-950/30 border-emerald-500/40 text-emerald-200'
                      : 'bg-slate-900/40 border-slate-700/50 text-slate-400 hover:bg-slate-800/40'
                  } ${isStorekeeperBlocked ? 'opacity-40 cursor-not-allowed' : ''}`}
                >
                  <div className="pr-1">
                    <span className="block font-bold text-xs text-white mb-0.5">{perm.label_ar}</span>
                    <span className="block font-mono text-[10px] text-slate-400">
                      {perm.key} • {perm.category}
                    </span>
                    {isStorekeeperBlocked && (
                      <span className="text-[10px] text-rose-400 block mt-1">محظور على أمين المخزن للأمان المحاسبي</span>
                    )}
                  </div>

                  <input
                    type="checkbox"
                    checked={isChecked}
                    disabled={isStorekeeperBlocked}
                    onChange={() => {}}
                    className="w-4 h-4 text-emerald-600 rounded bg-slate-900 border-slate-600"
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Tab 3: Immutable Audit Logs */}
      {activeTab === 'audit' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-xs text-amber-300">
            <Lock className="w-4 h-4 shrink-0 text-amber-400" />
            <span>
              سجل التدقيق الرقابي غير قابل للتعديل أو الحذف برمجياً. يتم قيد كل حركة مع هوية المستخدم وعنوان IP والتوقيت الزمني والأثر المالي.
            </span>
          </div>

          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-3 pointer-events-none" />
            <input
              type="text"
              value={auditSearch}
              onChange={e => setAuditSearch(e.target.value)}
              placeholder="بحث في سجل التدقيق بالعملية، المستخدم، التفاصيل..."
              className="w-full bg-slate-800/70 border border-slate-700 rounded-xl px-9 py-2.5 text-sm text-white placeholder-slate-400 focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div className="bg-slate-800/60 rounded-2xl border border-slate-700/60 overflow-hidden shadow-xl">
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="bg-slate-900/60 text-slate-300 border-b border-slate-700/80">
                  <tr>
                    <th className="py-3 px-4">التوقيت</th>
                    <th className="py-3 px-4">المستخدم</th>
                    <th className="py-3 px-4">عنوان IP</th>
                    <th className="py-3 px-4">نوع الحركة</th>
                    <th className="py-3 px-4">الكيان / الجدول</th>
                    <th className="py-3 px-4">تفاصيل العملية</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/40 text-slate-200">
                  {filteredAudit.map(log => (
                    <tr key={log.id} className="hover:bg-slate-700/30 transition">
                      <td className="py-2.5 px-4 font-mono text-slate-400">{log.created_at}</td>
                      <td className="py-2.5 px-4 font-medium text-emerald-400">{log.display_name || log.user_id}</td>
                      <td className="py-2.5 px-4 font-mono text-slate-400">{log.ip_address || '127.0.0.1'}</td>
                      <td className="py-2.5 px-4 font-mono font-bold text-amber-400">{log.action}</td>
                      <td className="py-2.5 px-4 font-mono text-slate-400">{log.entity_type}</td>
                      <td className="py-2.5 px-4 text-slate-300 max-w-md">{log.details || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Create User */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-800 rounded-2xl border border-slate-700 w-full max-w-lg p-6 shadow-2xl relative">
            <button
              onClick={() => setIsCreateOpen(false)}
              className="absolute left-6 top-6 p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <Plus className="w-5 h-5 text-emerald-400" />
              <span>إنشاء حساب مستخدم جديد</span>
            </h3>

            <form onSubmit={handleCreateUserSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 mb-1">اسم الدخول (Username) *</label>
                <input
                  type="text"
                  required
                  value={formUsername}
                  onChange={e => setFormUsername(e.target.value)}
                  placeholder="e.g. ahmed_acc"
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white"
                />
              </div>

              <div>
                <label className="block text-slate-300 mb-1">الاسم الكامل / المسمى *</label>
                <input
                  type="text"
                  required
                  value={formDisplayName}
                  onChange={e => setFormDisplayName(e.target.value)}
                  placeholder="e.g. أحمد محمود - محاسب فرع الإسكندرية"
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white"
                />
              </div>

              <div>
                <label className="block text-slate-300 mb-1">كلمة المرور *</label>
                <input
                  type="password"
                  required
                  value={formPassword}
                  onChange={e => setFormPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white"
                />
              </div>

              <div>
                <label className="block text-slate-300 mb-1">الدور الوظيفي والصلاحيات *</label>
                <select
                  value={formRole}
                  onChange={e => setFormRole(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white"
                >
                  <option value="accountant">محاسب عام (Accountant)</option>
                  <option value="finance_manager">مدير مالي (Finance Manager)</option>
                  <option value="admin">مدير نظام (System Admin)</option>
                  <option value="sales_officer">مسؤول مبيعات (Sales Officer)</option>
                  <option value="purchase_officer">مسؤول مشتريات (Purchase Officer)</option>
                  <option value="storekeeper">أمين مخزن (Storekeeper)</option>
                  <option value="cashier">أمين خزينة / كاشير (Cashier)</option>
                  <option value="auditor_readonly">مراجع حسابات (Auditor Readonly)</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 mb-1">نطاق الفروع المسموحة</label>
                  <input
                    type="text"
                    value={formBranchScope}
                    onChange={e => setFormBranchScope(e.target.value)}
                    placeholder="* لكافة الفروع أو كود الفرع"
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 mb-1">نطاق المخازن المسموحة</label>
                  <input
                    type="text"
                    value={formWarehouseScope}
                    onChange={e => setFormWarehouseScope(e.target.value)}
                    placeholder="* لكافة المخازن أو كود المخزن"
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-700">
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
                  className="px-4 py-2 rounded-xl text-slate-300 hover:bg-slate-700"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold"
                >
                  {isSubmitting ? 'جارٍ الإنشاء...' : 'إنشاء الحساب'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Edit User */}
      {editingUser && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-800 rounded-2xl border border-slate-700 w-full max-w-lg p-6 shadow-2xl relative">
            <button
              onClick={() => setEditingUser(null)}
              className="absolute left-6 top-6 p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <Edit className="w-5 h-5 text-emerald-400" />
              <span>تعديل بيانات المستخدم: {editingUser.username}</span>
            </h3>

            <form onSubmit={handleUpdateUserSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 mb-1">الاسم الكامل / المسمى *</label>
                <input
                  type="text"
                  required
                  value={editDisplayName}
                  onChange={e => setEditDisplayName(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white"
                />
              </div>

              <div>
                <label className="block text-slate-300 mb-1">الدور الوظيفي *</label>
                <select
                  value={editRole}
                  disabled={editingUser.role === 'owner' && currentUser?.role !== 'owner'}
                  onChange={e => setEditRole(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white disabled:opacity-50"
                >
                  {currentUser?.role === 'owner' && <option value="owner">المالك / Super Admin</option>}
                  <option value="admin">مدير نظام (System Admin)</option>
                  <option value="finance_manager">مدير مالي (Finance Manager)</option>
                  <option value="accountant">محاسب عام (Accountant)</option>
                  <option value="sales_officer">مسؤول مبيعات (Sales Officer)</option>
                  <option value="purchase_officer">مسؤول مشتريات (Purchase Officer)</option>
                  <option value="storekeeper">أمين مخزن (Storekeeper)</option>
                  <option value="cashier">أمين خزينة / كاشير (Cashier)</option>
                  <option value="auditor_readonly">مراجع حسابات (Auditor Readonly)</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 mb-1">نطاق الفروع المسموحة</label>
                  <input
                    type="text"
                    value={editBranchScope}
                    onChange={e => setEditBranchScope(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 mb-1">نطاق المخازن المسموحة</label>
                  <input
                    type="text"
                    value={editWarehouseScope}
                    onChange={e => setEditWarehouseScope(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-700">
                <button
                  type="button"
                  onClick={() => setEditingUser(null)}
                  className="px-4 py-2 rounded-xl text-slate-300 hover:bg-slate-700"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold"
                >
                  {isSubmitting ? 'جارٍ الحفظ...' : 'حفظ التعديلات'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Reset Password */}
      {resetPassUser && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-800 rounded-2xl border border-slate-700 w-full max-w-sm p-6 shadow-2xl relative">
            <button
              onClick={() => setResetPassUser(null)}
              className="absolute left-6 top-6 p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-base font-bold text-white mb-2 flex items-center gap-2">
              <Key className="w-5 h-5 text-amber-400" />
              <span>إعادة تعيين كلمة المرور</span>
            </h3>
            <p className="text-xs text-slate-400 mb-4">
              للمستخدم: <b className="text-emerald-400">{resetPassUser.display_name}</b>
            </p>

            <form onSubmit={handleResetPasswordSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 mb-1">كلمة المرور الجديدة *</label>
                <input
                  type="password"
                  required
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-700">
                <button
                  type="button"
                  onClick={() => setResetPassUser(null)}
                  className="px-3 py-1.5 rounded-lg text-slate-400 hover:text-white"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-lg font-bold"
                >
                  {isSubmitting ? 'جارٍ التحديث...' : 'تحديث كلمة المرور'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Modal: Individual User Permissions */}
      {permissionUser && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-800 rounded-2xl border border-slate-700 w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-700 flex items-center justify-between bg-slate-900/50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                  <Shield className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <span>صلاحيات المستخدم: {permissionUser.display_name}</span>
                    <span className="font-mono text-xs text-emerald-400 font-normal">({permissionUser.username})</span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    الدور الوظيفي الأساسي: <span className="font-mono font-semibold text-slate-300">{permissionUser.role}</span>
                  </p>
                </div>
              </div>
              <button
                onClick={() => setPermissionUser(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Mode Selector */}
            <div className="p-4 bg-slate-900/40 border-b border-slate-700/80 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div className="flex items-center gap-4 text-xs">
                <label className="flex items-center gap-2 cursor-pointer font-medium text-slate-200">
                  <input
                    type="radio"
                    name="perm_mode"
                    checked={!customPermissions}
                    onChange={() => setCustomPermissions(false)}
                    className="accent-emerald-500 w-4 h-4"
                  />
                  <span>يرث صلاحيات الدور الوظيفي ({permissionUser.role})</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer font-medium text-slate-200">
                  <input
                    type="radio"
                    name="perm_mode"
                    checked={customPermissions}
                    onChange={() => setCustomPermissions(true)}
                    className="accent-emerald-500 w-4 h-4"
                  />
                  <span>تخصيص صلاحيات مستقلة لهذا الحساب</span>
                </label>
              </div>

              {customPermissions && (
                <div className="flex items-center gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setIndividualPermissions(availablePermissions.map(p => p.key))}
                    className="px-2.5 py-1 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded text-[11px] font-medium flex items-center gap-1 transition"
                  >
                    <CheckSquare className="w-3.5 h-3.5 text-emerald-400" />
                    <span>تحديد الكل</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setIndividualPermissions([])}
                    className="px-2.5 py-1 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded text-[11px] font-medium flex items-center gap-1 transition"
                  >
                    <Square className="w-3.5 h-3.5 text-rose-400" />
                    <span>إلغاء الكل (تفريغ)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setIndividualPermissions([...rolePermissions])}
                    className="px-2.5 py-1 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded text-[11px] font-medium flex items-center gap-1 transition"
                  >
                    <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
                    <span>نسخ صلاحيات الدور</span>
                  </button>
                </div>
              )}
            </div>

            {/* Sub-Tabs: Allowed Screens vs Security Controls vs All */}
            <div className="flex items-center gap-2 px-5 pt-3 pb-2 bg-slate-900/60 border-b border-slate-700/60 text-xs">
              <button
                type="button"
                onClick={() => setUserPermModalTab('screens')}
                className={`px-3 py-1.5 rounded-lg font-bold transition flex items-center gap-1.5 ${
                  userPermModalTab === 'screens'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800'
                }`}
              >
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>الشاشات المسموحة والإجراءات المتاحة</span>
              </button>

              <button
                type="button"
                onClick={() => setUserPermModalTab('security')}
                className={`px-3 py-1.5 rounded-lg font-bold transition flex items-center gap-1.5 ${
                  userPermModalTab === 'security'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800'
                }`}
              >
                <Lock className="w-4 h-4 text-amber-400" />
                <span>ضوابط الأمان والسرية المالية</span>
              </button>

              <button
                type="button"
                onClick={() => setUserPermModalTab('all')}
                className={`px-3 py-1.5 rounded-lg font-bold transition flex items-center gap-1.5 ${
                  userPermModalTab === 'all'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800'
                }`}
              >
                <Shield className="w-4 h-4 text-sky-400" />
                <span>كافة الصلاحيات المتقدمة</span>
              </button>
            </div>

            {/* Permissions List Organized by Selected Sub-Tab */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {!customPermissions && (
                <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl text-xs text-blue-200 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-blue-400 shrink-0" />
                  <span>
                    هذا الحساب يرث صلاحياته الحالية تلقائياً من دوره الوظيفي ({permissionUser.role}). لتخصيص الشاشات أو استبعاد صلاحيات محددة، اختر «تخصيص صلاحيات مستقلة لهذا الحساب» أعلاه.
                  </span>
                </div>
              )}

              {/* Sub-Tab 1: Allowed Screens & Modular Actions */}
              {userPermModalTab === 'screens' && (
                <div className="space-y-4">
                  {SCREEN_PERMISSIONS_CONFIG.map(screen => {
                    const activeList = customPermissions ? individualPermissions : rolePermissions;
                    const hasView = activeList.includes(screen.viewKey);
                    const screenActionKeys = [screen.viewKey, ...screen.actions.map(a => a.key)];
                    const allScreenChecked = screenActionKeys.every(k => activeList.includes(k));

                    const togglePermissionKey = (key: string, checked: boolean) => {
                      if (!customPermissions) return;
                      setIndividualPermissions(prev =>
                        checked ? [...new Set([...prev, key])] : prev.filter(k => k !== key)
                      );
                    };

                    const handleGrantAllScreen = () => {
                      if (!customPermissions) return;
                      setIndividualPermissions(prev => [...new Set([...prev, ...screenActionKeys])]);
                    };

                    const handleRevokeAllScreen = () => {
                      if (!customPermissions) return;
                      setIndividualPermissions(prev => prev.filter(k => !screenActionKeys.includes(k)));
                    };

                    return (
                      <div
                        key={screen.id}
                        className={`rounded-2xl border transition overflow-hidden shadow-sm ${
                          hasView
                            ? 'bg-slate-900/60 border-slate-700/80'
                            : 'bg-slate-900/30 border-slate-800/80 opacity-75'
                        }`}
                      >
                        {/* Screen Header */}
                        <div className="p-3.5 bg-slate-950/40 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div className="flex items-center gap-3">
                            <label className={`flex items-center gap-2.5 font-bold text-xs ${customPermissions ? 'cursor-pointer' : 'cursor-default'}`}>
                              <input
                                type="checkbox"
                                disabled={!customPermissions || savingIndividualPermissions}
                                checked={hasView}
                                onChange={e => togglePermissionKey(screen.viewKey, e.target.checked)}
                                className="accent-emerald-500 w-4 h-4 rounded shrink-0"
                              />
                              <span className="text-white text-sm">{screen.title_ar}</span>
                            </label>
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-mono ${
                              hasView ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-slate-800 text-slate-400'
                            }`}>
                              {hasView ? 'الشاشة مسموحة' : 'الشاشة محجوبة'}
                            </span>
                          </div>

                          <div className="flex items-center gap-2 self-end sm:self-auto">
                            {customPermissions && (
                              <>
                                <button
                                  type="button"
                                  onClick={handleGrantAllScreen}
                                  className="text-[10px] px-2 py-0.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 rounded border border-emerald-500/30 transition"
                                >
                                  منح كل الإجراءات
                                </button>
                                <button
                                  type="button"
                                  onClick={handleRevokeAllScreen}
                                  className="text-[10px] px-2 py-0.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 rounded border border-rose-500/30 transition"
                                >
                                  حجب الشاشة وإجراءاتها
                                </button>
                              </>
                            )}
                          </div>
                        </div>

                        {/* Actions Subgrid */}
                        <div className="p-3.5">
                          <p className="text-[11px] text-slate-400 mb-3">{screen.description_ar}</p>

                          {screen.actions.length === 0 ? (
                            <div className="text-[11px] text-slate-500 italic p-2 bg-slate-800/30 rounded-lg">
                              هذه الشاشة مخصصة للعرض والتحليل ولا تتضمن إجراءات تحرير منفصلة (تخضع لحجب التكلفة والربح).
                            </div>
                          ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                              {screen.actions.map(action => {
                                const isActionChecked = activeList.includes(action.key);
                                return (
                                  <label
                                    key={action.key}
                                    className={`flex items-start gap-2 p-2 rounded-xl border text-xs transition ${
                                      isActionChecked
                                        ? 'bg-emerald-950/30 border-emerald-500/40 text-emerald-200'
                                        : 'bg-slate-800/40 border-slate-700/50 text-slate-400'
                                    } ${customPermissions ? 'cursor-pointer hover:bg-slate-700/40' : 'cursor-default opacity-85'}`}
                                  >
                                    <input
                                      type="checkbox"
                                      disabled={!customPermissions || savingIndividualPermissions}
                                      checked={isActionChecked}
                                      onChange={e => togglePermissionKey(action.key, e.target.checked)}
                                      className="accent-emerald-500 w-3.5 h-3.5 mt-0.5 rounded shrink-0"
                                    />
                                    <div>
                                      <div className="font-semibold text-slate-200 text-[11px]">{action.label_ar}</div>
                                      <div className="font-mono text-[9px] text-slate-400 mt-0.5">{action.key}</div>
                                    </div>
                                  </label>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Sub-Tab 2: Security & Visibility Controls */}
              {userPermModalTab === 'security' && (
                <div className="space-y-3">
                  <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-xs text-amber-300 flex items-center gap-2">
                    <Lock className="w-4 h-4 text-amber-400 shrink-0" />
                    <span>
                      الضوابط الأمنية تحجب المعلومات المالية الحساسة (أسعار الشراء، تكلفة المخزون، وهوامش الربح) عن الحساب حتى داخل الشاشات المسموحة له.
                    </span>
                  </div>

                  <div className="grid grid-cols-1 gap-3">
                    {SECURITY_CONTROLS_CONFIG.map(ctrl => {
                      const activeList = customPermissions ? individualPermissions : rolePermissions;
                      const isChecked = activeList.includes(ctrl.key);

                      return (
                        <label
                          key={ctrl.key}
                          className={`flex items-start gap-3 p-3.5 rounded-xl border transition ${
                            isChecked
                              ? 'bg-amber-950/20 border-amber-500/40 text-amber-200'
                              : 'bg-slate-800/40 border-slate-700/50 text-slate-400'
                          } ${customPermissions ? 'cursor-pointer hover:bg-slate-700/40' : 'cursor-default'}`}
                        >
                          <input
                            type="checkbox"
                            disabled={!customPermissions || savingIndividualPermissions}
                            checked={isChecked}
                            onChange={e => {
                              if (!customPermissions) return;
                              const checked = e.target.checked;
                              setIndividualPermissions(prev =>
                                checked ? [...prev, ctrl.key] : prev.filter(k => k !== ctrl.key)
                              );
                            }}
                            className="accent-amber-500 w-4 h-4 mt-0.5 shrink-0 rounded"
                          />
                          <div>
                            <div className="font-bold text-white text-xs mb-1">{ctrl.label_ar}</div>
                            <p className="text-[11px] text-slate-300 leading-relaxed">{ctrl.description_ar}</p>
                            <span className="font-mono text-[10px] text-amber-400/80 mt-1 inline-block">{ctrl.key}</span>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Sub-Tab 3: All Available Permissions Grid */}
              {userPermModalTab === 'all' && (
                <div className="space-y-4">
                  {Array.from(new Set(availablePermissions.map(p => p.category || 'عام'))).map(category => {
                    const permsInCategory = availablePermissions.filter(p => (p.category || 'عام') === category);

                    return (
                      <div key={category} className="bg-slate-900/40 rounded-xl border border-slate-700/60 p-4">
                        <h4 className="text-xs font-bold text-emerald-400 mb-3 flex items-center gap-2 pb-2 border-b border-slate-800">
                          <ShieldCheck className="w-4 h-4" />
                          <span>{category}</span>
                          <span className="text-[10px] text-slate-500 font-normal">({permsInCategory.length} صلاحيات)</span>
                        </h4>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                          {permsInCategory.map(perm => {
                            const activeList = customPermissions ? individualPermissions : rolePermissions;
                            const isChecked = activeList.includes(perm.key);

                            return (
                              <label
                                key={perm.key}
                                className={`flex items-start gap-2.5 p-2 rounded-lg border transition ${
                                  isChecked
                                    ? 'bg-emerald-950/20 border-emerald-500/30 text-white'
                                    : 'bg-slate-800/40 border-slate-700/40 text-slate-400'
                                } ${customPermissions ? 'cursor-pointer hover:bg-slate-700/40' : 'cursor-default opacity-85'}`}
                              >
                                <input
                                  type="checkbox"
                                  disabled={!customPermissions || savingIndividualPermissions}
                                  checked={isChecked}
                                  onChange={e => {
                                    if (!customPermissions) return;
                                    const checked = e.target.checked;
                                    setIndividualPermissions(prev =>
                                      checked ? [...prev, perm.key] : prev.filter(k => k !== perm.key)
                                    );
                                  }}
                                  className="accent-emerald-500 w-4 h-4 mt-0.5 shrink-0 rounded"
                                />
                                <div>
                                  <div className="font-semibold text-slate-200">{perm.label_ar}</div>
                                  <div className="font-mono text-[10px] text-slate-500 mt-0.5">{perm.key}</div>
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-700 bg-slate-900/50 flex items-center justify-between">
              <span className="text-xs text-slate-400">
                {customPermissions
                  ? `تم تحديد (${individualPermissions.length}) صلاحية مخصصة لهذا الحساب.`
                  : `يرث (${rolePermissions.length}) صلاحية من دور (${permissionUser.role}).`}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPermissionUser(null)}
                  disabled={savingIndividualPermissions}
                  className="px-4 py-2 rounded-xl text-xs text-slate-300 hover:bg-slate-700 transition"
                >
                  إلغاء
                </button>
                <button
                  type="button"
                  onClick={handleSaveIndividualPermissions}
                  disabled={savingIndividualPermissions}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 transition disabled:opacity-50"
                >
                  <Save className="w-4 h-4" />
                  <span>{savingIndividualPermissions ? 'جارٍ الحفظ...' : 'حفظ وتطبيق الصلاحيات'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ConfirmModal: Delete User */}
      <ConfirmModal
        isOpen={!!userToDelete}
        title="تأكيد حذف المستخدم"
        message={`هل أنت متأكد من حذف المستخدم "${userToDelete?.display_name}" (${userToDelete?.username})؟`}
        warning="سيتم رفض الحذف نهائياً في حال وجود أي مستندات أو فواتير أو قيود يومية منسوبة إلى هذا المستخدم حفاظاً على سلامة سجل التدقيق."
        confirmLabel="تأكيد الحذف"
        confirmVariant="danger"
        isLoading={isDeletingUser}
        onConfirm={handleConfirmDeleteUser}
        onCancel={() => setUserToDelete(null)}
      />

      {/* ConfirmModal: Toggle User Status */}
      <ConfirmModal
        isOpen={!!userToToggleActive}
        title={userToToggleActive?.is_active === 1 ? 'تعطيل حساب المستخدم' : 'تفعيل حساب المستخدم'}
        message={`هل تريد بالتأكيد ${userToToggleActive?.is_active === 1 ? 'تعطيل' : 'تفعيل'} حساب المستخدم "${userToToggleActive?.display_name}"؟`}
        confirmLabel={userToToggleActive?.is_active === 1 ? 'تعطيل الحساب' : 'تفعيل الحساب'}
        confirmVariant={userToToggleActive?.is_active === 1 ? 'danger' : 'primary'}
        onConfirm={handleConfirmToggleActive}
        onCancel={() => setUserToToggleActive(null)}
      />
    </div>
  );
};
