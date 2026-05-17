import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Shield, CheckCircle, XCircle, AlertTriangle, RefreshCw,
  Plug, PlugZap, WifiOff, Plus, Settings, Loader2,
  Eye, EyeOff, Save, Trash2, Activity, X, Server, Pencil, Check,
} from 'lucide-react';
import PageHeader from '@/components/common/PageHeader';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import { useToast } from '@/components/common/Toast';
import { providerAPI } from '@/api/provider';
import { deviceAPI, type DeviceIntegration, type DeviceGroup } from '@/api/device';
import type { APIServiceSummary, APIServiceCredentialField } from '@/types';

// ============================================================================
// Vendor catalog
// ============================================================================

interface DeviceVendor {
  id: string;
  nameCn: string;
  color: string;
  serviceIdPrefixes: string[];
}

const VENDORS: DeviceVendor[] = [
  { id: 'sangfor',    nameCn: '深信服', color: 'bg-blue-100 text-blue-800',     serviceIdPrefixes: ['sangfor'] },
  { id: 'nsfocus',    nameCn: '绿盟',   color: 'bg-green-100 text-green-800',   serviceIdPrefixes: ['ngsoc', 'ngtip'] },
  { id: 'qianxin',    nameCn: '奇安信', color: 'bg-purple-100 text-purple-800', serviceIdPrefixes: ['onesec', 'onesig'] },
  { id: 'threatbook', nameCn: '微步',   color: 'bg-orange-100 text-orange-800', serviceIdPrefixes: ['tdp'] },
  { id: 'qingteng',   nameCn: '青藤',   color: 'bg-teal-100 text-teal-800',     serviceIdPrefixes: ['qingteng'] },
  { id: 'skyeye',     nameCn: '天眼',   color: 'bg-cyan-100 text-cyan-800',     serviceIdPrefixes: ['skyeye'] },
];

function getVendor(serviceId: string): DeviceVendor | undefined {
  return VENDORS.find((v) => v.serviceIdPrefixes.some((p) => serviceId.startsWith(p)));
}

// ============================================================================
// Status helpers
// ============================================================================

function StatusBadge({ status, enabled }: { status: string; enabled: boolean }) {
  if (!enabled) return (
    <span className="inline-flex items-center gap-1 text-xs text-zinc-400"><WifiOff className="w-3 h-3" />已禁用</span>
  );
  if (status === 'ok' || status === 'connected') return (
    <span className="inline-flex items-center gap-1 text-xs text-green-600"><CheckCircle className="w-3 h-3" />已连接</span>
  );
  if (status === 'error') return (
    <span className="inline-flex items-center gap-1 text-xs text-red-500"><XCircle className="w-3 h-3" />连接失败</span>
  );
  return (
    <span className="inline-flex items-center gap-1 text-xs text-zinc-400"><AlertTriangle className="w-3 h-3" />未检测</span>
  );
}

// ============================================================================
// Active device card
// ============================================================================

function ActiveCard({ device, selected, onClick }: {
  device: DeviceIntegration;
  selected: boolean;
  onClick: () => void;
}) {
  const vendor = getVendor(device.service_id);
  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-xl border p-4 transition-all duration-150 group ${
        selected
          ? 'border-blue-300 bg-blue-50 shadow-sm ring-1 ring-blue-200'
          : 'border-zinc-200 bg-white hover:border-zinc-300 hover:shadow-sm'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
          selected ? 'bg-blue-100' : 'bg-zinc-50 group-hover:bg-zinc-100'
        }`}>
          <PlugZap className={`w-4 h-4 ${selected ? 'text-blue-600' : 'text-zinc-500'}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-zinc-800 truncate">{device.name}</p>
            <Settings className={`w-3.5 h-3.5 flex-shrink-0 ${selected ? 'text-blue-400' : 'text-zinc-300 group-hover:text-zinc-400'}`} />
          </div>
          <p className="text-xs text-zinc-400 mt-0.5 truncate">{device.storage_key}</p>
          {device.fields.base_url && (
            <p className="text-xs text-zinc-400 truncate">{device.fields.base_url}</p>
          )}
          <div className="flex items-center gap-1.5 mt-2">
            <StatusBadge status={device.status} enabled={device.enabled} />
            {vendor && (
              <>
                <span className="text-zinc-200">·</span>
                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-md ${vendor.color}`}>{vendor.nameCn}</span>
              </>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}

// ============================================================================
// Available template card
// ============================================================================

function TemplateCard({ service, instanceCount, onAdd }: {
  service: APIServiceSummary;
  instanceCount: number;
  onAdd: () => void;
}) {
  const vendor = getVendor(service.id);
  const description = service.description_cn || service.description || '';
  return (
    <div className="rounded-xl border border-zinc-100 bg-white/60 p-4 transition-all duration-150">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-zinc-100 flex items-center justify-center flex-shrink-0">
          <Plug className="w-4 h-4 text-zinc-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-zinc-600 truncate">{service.name}</p>
            {service.version && <span className="text-[10px] text-zinc-400 flex-shrink-0">v{service.version}</span>}
          </div>
          {description && (
            <p className="text-xs text-zinc-400 line-clamp-2 mt-1 leading-relaxed">{description}</p>
          )}
          <div className="flex items-center justify-between mt-3">
            <div className="flex items-center gap-1.5">
              {vendor && <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-md ${vendor.color}`}>{vendor.nameCn}</span>}
              {instanceCount > 0 && (
                <span className="text-[10px] text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-md font-medium">
                  已有 {instanceCount} 台
                </span>
              )}
            </div>
            <button
              onClick={onAdd}
              className="flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-lg transition-colors text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100"
            >
              <Plus className="w-3 h-3" />
              {instanceCount > 0 ? '再接入' : '接入'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Add / Edit device panel (right side)
// ============================================================================

function DeviceConfigPanel({ device, template, onSave, onDelete, onClose, onTest }: {
  device?: DeviceIntegration;           // existing → edit mode
  template?: APIServiceSummary;         // new from template → add mode
  onSave: (data: { name: string; fields: Record<string, string>; enabled: boolean; verify_ssl: boolean }) => Promise<void>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
  onTest?: () => Promise<{ success: boolean; message: string }>;
}) {
  const { toast } = useToast();
  const [name, setName] = useState(device?.name ?? '');
  // ``fields`` holds *user-pending* input. For edit mode, sensitive fields
  // start empty (their existing masked preview is shown via placeholder
  // and is preserved server-side when the user leaves the input blank).
  // Non-sensitive fields start populated with the saved value.
  const [fields, setFields] = useState<Record<string, string>>(() => {
    if (!device) return {};
    return { ...device.fields };
  });
  const [enabled, setEnabled] = useState(device?.enabled ?? true);
  const [verifySsl, setVerifySsl] = useState(device?.verify_ssl ?? false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [credFields, setCredFields] = useState<APIServiceCredentialField[]>([]);
  const [visibility, setVisibility] = useState<Record<string, boolean>>({});

  // Load credential schema from template
  useEffect(() => {
    const key = device?.storage_key ?? template?.id;
    if (!key) return;
    providerAPI.getServiceMetadata(key)
      .then((res) => {
        const schema: APIServiceCredentialField[] = res.data?.credential_schema ?? [];
        setCredFields(schema);
        if (device) {
          // Edit mode: clear all sensitive fields' input so the masked
          // preview shines through as placeholder and "blank = keep" works.
          setFields((prev) => {
            const next = { ...prev };
            schema.forEach((f) => {
              if (f.storage === 'secret') next[f.key] = '';
            });
            return next;
          });
        } else {
          // Add mode: pre-fill defaults declared in the schema.
          const defaults: Record<string, string> = {};
          schema.forEach((f) => { if (f.default_value) defaults[f.key] = f.default_value; });
          setFields((prev) => ({ ...defaults, ...prev }));
        }
      })
      .catch(() => setCredFields([]));
  }, [device, template?.id]);

  const handleSave = async () => {
    if (!name.trim()) { toast.error('请填写设备名称'); return; }
    setSaving(true);
    try {
      await onSave({ name: name.trim(), fields, enabled, verify_ssl: verifySsl });
      toast.success(device ? '配置已保存' : '设备已添加');
    } catch {
      toast.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!onTest) return;
    setTesting(true);
    setTestResult(null);
    try {
      const r = await onTest();
      setTestResult(r);
    } finally {
      setTesting(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      // Auto-revert the "confirm?" state after 4s so the button doesn't get
      // stuck in armed mode forever.
      window.setTimeout(() => setConfirmDelete(false), 4000);
      return;
    }
    if (!onDelete) return;
    setDeleting(true);
    try {
      await onDelete();
      toast.success('已删除设备');
    } catch {
      toast.error('删除失败');
    } finally {
      setDeleting(false);
    }
  };

  const vendor = getVendor(device?.service_id ?? template?.id ?? '');

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100 flex-shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${device ? 'bg-blue-100' : 'bg-zinc-100'}`}>
            {device ? <PlugZap className="w-4 h-4 text-blue-600" /> : <Plus className="w-4 h-4 text-zinc-500" />}
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-zinc-800 truncate">{device ? '编辑设备' : '接入新设备'}</h3>
            <div className="flex items-center gap-1.5 mt-0.5">
              {vendor && <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-md ${vendor.color}`}>{vendor.nameCn}</span>}
              <span className="text-xs text-zinc-400">{device?.storage_key ?? template?.id}</span>
            </div>
          </div>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-zinc-100 text-zinc-400 hover:text-zinc-600 flex-shrink-0">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {/* Device name */}
        <div>
          <label className="block text-xs font-semibold text-zinc-600 mb-1.5">
            设备名称 <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：总部 AF 防火墙"
            className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-100"
          />
        </div>

        {/* Credential fields */}
        {credFields.length > 0 && (
          <div className="space-y-3">
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">连接配置</p>
            {credFields.map((f) => {
              const isSecret = f.storage === 'secret' || f.input_type === 'password';
              const show = !!visibility[f.key];
              const hasExisting = !!device?.fields_set?.[f.key];
              const existingMask = device?.fields?.[f.key] ?? '';
              const placeholder = isSecret && hasExisting
                ? `已配置（${existingMask}）— 留空保留`
                : (f.default_value ?? '');
              return (
                <div key={f.key}>
                  <label className="block text-xs font-medium text-zinc-600 mb-1">
                    {f.label}
                    {f.required && !hasExisting && <span className="text-red-500 ml-0.5">*</span>}
                  </label>
                  <div className="relative">
                    <input
                      type={isSecret && !show ? 'password' : 'text'}
                      value={fields[f.key] ?? ''}
                      onChange={(e) => setFields((p) => ({ ...p, [f.key]: e.target.value }))}
                      placeholder={placeholder}
                      className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-100 pr-10"
                    />
                    {isSecret && (
                      <button
                        type="button"
                        onClick={() => setVisibility((p) => ({ ...p, [f.key]: !p[f.key] }))}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
                        title={show ? '隐藏' : '显示'}
                      >
                        {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    )}
                  </div>
                  {f.description && <p className="mt-1 text-xs text-zinc-400">{f.description}</p>}
                </div>
              );
            })}
          </div>
        )}

        {/* SSL + Enable toggles */}
        <div className="space-y-3 pt-1">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-zinc-700">SSL 验证</p>
              <p className="text-xs text-zinc-400 mt-0.5">关闭以允许自签名证书（内网设备通常需关闭）</p>
            </div>
            <button
              type="button"
              onClick={() => setVerifySsl((v) => !v)}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${verifySsl ? 'bg-blue-500' : 'bg-zinc-300'}`}
            >
              <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${verifySsl ? 'translate-x-4' : 'translate-x-0.5'}`} />
            </button>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-zinc-700">启用设备</p>
              <p className="text-xs text-zinc-400 mt-0.5">关闭后不会调用此设备的 API</p>
            </div>
            <button
              type="button"
              onClick={() => setEnabled((v) => !v)}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${enabled ? 'bg-blue-500' : 'bg-zinc-300'}`}
            >
              <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
            </button>
          </div>
        </div>

        {/* Test result */}
        {testResult && (
          <div className={`rounded-lg px-4 py-3 text-sm flex items-start gap-2 ${
            testResult.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'
          }`}>
            {testResult.success ? <CheckCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /> : <XCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />}
            <span>{testResult.message}</span>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex-shrink-0 px-5 py-4 border-t border-zinc-100 space-y-2">
        <div className="flex gap-2">
          {device && onTest && (
            <button
              onClick={handleTest}
              disabled={testing}
              className="flex items-center justify-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-zinc-200 text-zinc-600 hover:bg-zinc-50 disabled:opacity-50 transition-colors flex-1"
            >
              {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Activity className="w-3.5 h-3.5" />}
              测试连通
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center justify-center gap-1.5 px-3 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors flex-1"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            {device ? '保存配置' : '确认接入'}
          </button>
        </div>
        {device && onDelete && (
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="w-full flex items-center justify-center gap-1.5 py-2 text-sm rounded-lg border border-red-200 text-red-500 hover:bg-red-50 disabled:opacity-50 transition-colors"
          >
            {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
            {confirmDelete ? '确认删除此设备配置？' : '删除设备'}
          </button>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Group banner (inline rename for the single default room)
// ============================================================================

function GroupBanner({ group, onRenamed }: {
  group: DeviceGroup | undefined;
  onRenamed: () => void;
}) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(group?.name ?? '');
  const [saving, setSaving] = useState(false);

  useEffect(() => { setDraft(group?.name ?? ''); }, [group?.name]);

  if (!group) return null;

  const startEdit = () => { setDraft(group.name); setEditing(true); };
  const cancelEdit = () => { setDraft(group.name); setEditing(false); };
  const saveEdit = async () => {
    const next = draft.trim();
    if (!next || next === group.name) { cancelEdit(); return; }
    setSaving(true);
    try {
      await deviceAPI.updateGroup(group.id, { name: next });
      toast.success('机房名称已更新');
      setEditing(false);
      onRenamed();
    } catch {
      toast.error('更新失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="px-6 py-2.5 border-b border-zinc-100 bg-zinc-50/60 flex items-center gap-2">
      <Server className="w-4 h-4 text-zinc-400 flex-shrink-0" />
      <span className="text-xs text-zinc-400">当前机房</span>
      {editing ? (
        <>
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void saveEdit();
              if (e.key === 'Escape') cancelEdit();
            }}
            disabled={saving}
            maxLength={40}
            className="text-sm font-medium text-zinc-800 bg-white border border-zinc-200 rounded-md px-2 py-1 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-100 w-48"
          />
          <button
            onClick={() => void saveEdit()}
            disabled={saving}
            className="p-1 rounded-md text-blue-600 hover:bg-blue-50 disabled:opacity-50"
            title="保存"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={cancelEdit}
            disabled={saving}
            className="p-1 rounded-md text-zinc-400 hover:bg-zinc-100"
            title="取消"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </>
      ) : (
        <>
          <span className="text-sm font-medium text-zinc-800 truncate">{group.name}</span>
          <button
            onClick={startEdit}
            className="p-1 rounded-md text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100"
            title="重命名"
          >
            <Pencil className="w-3 h-3" />
          </button>
        </>
      )}
    </div>
  );
}

// ============================================================================
// Main page
// ============================================================================

type PanelMode =
  | { kind: 'edit'; device: DeviceIntegration }
  | { kind: 'add'; template: APIServiceSummary }
  | null;

export default function DeviceIntegrationPage() {
  const { toast } = useToast();
  const [devices, setDevices] = useState<DeviceIntegration[]>([]);
  const [templates, setTemplates] = useState<APIServiceSummary[]>([]);
  const [groups, setGroups] = useState<DeviceGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [panel, setPanel] = useState<PanelMode>(null);

  // Current product locks to a single room. Pick the first group as "the"
  // room; rename actions target it. Multi-room UI lights up automatically
  // when ``groups.length > 1`` (i.e. backend ``MULTI_GROUP_ENABLED`` is on).
  const currentGroup: DeviceGroup | undefined = groups[0];

  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const [devRes, tplRes, grpRes] = await Promise.all([
        deviceAPI.list(),
        providerAPI.listApiServices(),
        deviceAPI.listGroups(),
      ]);
      setDevices(devRes.data || []);
      setTemplates((tplRes.data || []).filter((s) => s.integration_type === 'device'));
      setGroups(grpRes.data || []);
    } catch {
      toast.error('加载失败');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [toast]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  // Count instances per storage_key
  const instanceCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    devices.forEach((d) => { counts[d.storage_key] = (counts[d.storage_key] || 0) + 1; });
    return counts;
  }, [devices]);

  const panelDeviceId = panel?.kind === 'edit' ? panel.device.id : null;

  const handleSave = async (data: { name: string; fields: Record<string, string>; enabled: boolean; verify_ssl: boolean }) => {
    if (panel?.kind === 'add') {
      await deviceAPI.create({
        name: data.name,
        storage_key: panel.template.id,
        group_id: currentGroup?.id,
        enabled: data.enabled,
        verify_ssl: data.verify_ssl,
        fields: data.fields,
      });
      setPanel(null);
    } else if (panel?.kind === 'edit') {
      await deviceAPI.update(panel.device.id, {
        name: data.name,
        enabled: data.enabled,
        verify_ssl: data.verify_ssl,
        fields: data.fields,
      });
    }
    await fetchData(true);
    if (panel?.kind === 'edit') {
      // Refresh the panel device
      const updated = await deviceAPI.get(panel.device.id);
      setPanel({ kind: 'edit', device: updated.data });
    }
  };

  const handleDelete = async () => {
    if (panel?.kind !== 'edit') return;
    await deviceAPI.delete(panel.device.id);
    setPanel(null);
    await fetchData(true);
  };

  const handleTest = async () => {
    if (panel?.kind !== 'edit') return { success: false, message: '' };
    const res = await deviceAPI.test(panel.device.id);
    await fetchData(true);
    if (panel?.kind === 'edit') {
      const updated = await deviceAPI.get(panel.device.id);
      setPanel({ kind: 'edit', device: updated.data });
    }
    return res.data;
  };

  const showPanel = panel !== null;

  return (
    <div className="h-full flex flex-col">
      <PageHeader
        title="设备接入"
        description="配置安全设备 API 连接，使 Flocks 能够直接调用和控制这些设备"
        icon={<Shield className="w-5 h-5" />}
        action={
          <button
            onClick={() => void fetchData(true)}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-zinc-200 text-zinc-600 hover:bg-zinc-50 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            刷新
          </button>
        }
      />

      <GroupBanner group={currentGroup} onRenamed={() => void fetchData(true)} />

      {loading ? (
        <div className="flex-1 flex items-center justify-center"><LoadingSpinner /></div>
      ) : (
        <div className="flex-1 flex overflow-hidden">
          {/* Left: device list */}
          <div className={`flex flex-col overflow-hidden transition-all duration-300 ${showPanel ? 'w-[calc(100%-480px)]' : 'w-full'}`}>
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-8">

              {/* ── 已接入设备 ── */}
              <section>
                <div className="flex items-center gap-2 mb-4">
                  <PlugZap className="w-4 h-4 text-blue-600" />
                  <h3 className="text-sm font-semibold text-zinc-800">已接入设备</h3>
                  <span className="text-xs text-zinc-400 bg-zinc-100 px-1.5 py-0.5 rounded-md">{devices.length}</span>
                  {devices.filter((d) => d.status === 'ok' || d.status === 'connected').length > 0 && (
                    <span className="text-xs text-green-600">
                      {devices.filter((d) => d.status === 'ok' || d.status === 'connected').length} 已连接
                    </span>
                  )}
                </div>

                {devices.length === 0 ? (
                  <div className="rounded-xl border-2 border-dashed border-zinc-200 bg-zinc-50/50 px-6 py-10 text-center">
                    <WifiOff className="w-8 h-8 text-zinc-300 mx-auto mb-2" />
                    <p className="text-sm text-zinc-500 font-medium">暂无已接入的设备</p>
                    <p className="text-xs text-zinc-400 mt-1">从下方"可接入设备"中选择并配置</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {devices.map((d) => (
                      <ActiveCard
                        key={d.id}
                        device={d}
                        selected={panelDeviceId === d.id}
                        onClick={() => setPanel({ kind: 'edit', device: d })}
                      />
                    ))}
                  </div>
                )}
              </section>

              {/* ── 可接入设备目录 ── */}
              {templates.length > 0 && (
                <section>
                  <div className="flex items-center gap-2 mb-4">
                    <Plug className="w-4 h-4 text-zinc-400" />
                    <h3 className="text-sm font-semibold text-zinc-500">可接入设备</h3>
                    <span className="text-xs text-zinc-400 bg-zinc-100 px-1.5 py-0.5 rounded-md">{templates.length}</span>
                    <span className="text-xs text-zinc-400">· 同一类型可多次接入</span>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {templates.map((tpl) => (
                      <TemplateCard
                        key={tpl.id}
                        service={tpl}
                        instanceCount={instanceCounts[tpl.id] ?? 0}
                        onAdd={() => setPanel({ kind: 'add', template: tpl })}
                      />
                    ))}
                  </div>
                </section>
              )}

              {templates.length === 0 && devices.length === 0 && (
                <div className="flex flex-col items-center justify-center py-20 text-zinc-400 gap-3">
                  <Loader2 className="w-8 h-8 opacity-40 animate-spin" />
                  <p className="text-sm">暂无设备数据，请重启后端服务后刷新</p>
                </div>
              )}
            </div>
          </div>

          {/* Right: config panel */}
          {showPanel && (
            <div className="w-[480px] flex-shrink-0 border-l border-zinc-200 overflow-hidden">
              <DeviceConfigPanel
                key={panel.kind === 'edit' ? panel.device.id : panel.template.id}
                device={panel.kind === 'edit' ? panel.device : undefined}
                template={panel.kind === 'add' ? panel.template : undefined}
                onSave={handleSave}
                onDelete={panel.kind === 'edit' ? handleDelete : undefined}
                onClose={() => setPanel(null)}
                onTest={panel.kind === 'edit' ? handleTest : undefined}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
