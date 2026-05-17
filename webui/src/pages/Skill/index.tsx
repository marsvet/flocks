import { useState, useEffect, useMemo } from 'react';
import {
  BookOpen,
  Search,
  Plus,
  RefreshCw,
  Sparkles,
  FolderOpen,
  CloudDownload,
  AlertTriangle,
  Loader2,
  Pencil,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import PageHeader from '@/components/common/PageHeader';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import EmptyState from '@/components/common/EmptyState';
import { useToast } from '@/components/common/Toast';
import { skillAPI, Skill } from '@/api/skill';
import SkillSheet from './SkillSheet';
import SkillInstallDialog from './SkillInstallDialog';

const PAGE_SIZE = 25;

export default function SkillPage() {
  const { t } = useTranslation('skill');
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [installingDeps, setInstallingDeps] = useState<Record<string, boolean>>({});
  const toast = useToast();

  const [sheetSkill, setSheetSkill] = useState<Skill | null>(null);
  const [showCreateSheet, setShowCreateSheet] = useState(false);
  const [showInstallDialog, setShowInstallDialog] = useState(false);
  const [page, setPage] = useState(1);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshDone, setRefreshDone] = useState(false);
  const [togglingSkills, setTogglingSkills] = useState<Record<string, boolean>>({});
  // Status filter combines "stat counter" and "view filter" into one chip
  // group.  Clicking a chip both shows its number and applies the filter.
  const [statusFilter, setStatusFilter] = useState<'all' | 'enabled' | 'disabled'>('all');

  const fetchSkills = async (
    { silent = false, invalidateOnError = false }: { silent?: boolean; invalidateOnError?: boolean } = {}
  ) => {
    try {
      if (!silent) {
        setLoading(true);
        setError(null);
      }
      const response = await skillAPI.status();
      setSkills(Array.isArray(response.data) ? response.data : []);
      setError(null);
      return true;
    } catch {
      try {
        const fallback = await skillAPI.list();
        setSkills(Array.isArray(fallback.data) ? fallback.data : []);
        setError(null);
        return true;
      } catch (listErr: unknown) {
        const message = listErr instanceof Error ? listErr.message : t('fetchListFailed');
        if (invalidateOnError || !silent) {
          setSkills([]);
          setError(message);
        }
        if (silent) {
          toast.error(t('refreshFailed'), message);
        }
        return false;
      }
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    fetchSkills();
  }, []);

  // Skills visible to this page: everything except the internal "system"
  // category.  Counter chips operate on this set so the totals reflect
  // what the user can actually see — search and statusFilter both narrow
  // it further into ``filteredSkills``.
  const visibleSkills = useMemo(
    () => skills.filter(s => s.category !== 'system'),
    [skills],
  );

  const enabledCount = useMemo(
    () => visibleSkills.filter(s => !s.disabled).length,
    [visibleSkills],
  );
  const disabledCount = visibleSkills.length - enabledCount;

  const filteredSkills = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return visibleSkills.filter(skill => {
      if (statusFilter === 'enabled' && skill.disabled) return false;
      if (statusFilter === 'disabled' && !skill.disabled) return false;
      if (!q) return true;
      return (
        skill.name.toLowerCase().includes(q) ||
        (skill.description || '').toLowerCase().includes(q)
      );
    });
  }, [visibleSkills, searchQuery, statusFilter]);

  // Reset to first page whenever search or status filter changes
  useEffect(() => { setPage(1); }, [searchQuery, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredSkills.length / PAGE_SIZE));

  // Keep `page` state in sync with the list size.  Without this, deleting
  // enough items to shrink `totalPages` below the current `page` only
  // clamps the *view* via `currentPage` below — the underlying state stays
  // stale, so adding new skills later causes a confusing "jump" back to
  // the old page.  We mirror the clamp into state here.
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [totalPages, page]);

  const currentPage = Math.min(page, totalPages);
  const pagedSkills = useMemo(
    () => filteredSkills.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [filteredSkills, currentPage],
  );

  const handleRefresh = async () => {
    if (refreshing) return;
    try {
      setRefreshing(true);
      await Promise.all([
        skillAPI.refresh().then(() => fetchSkills({ silent: true })),
        new Promise((r) => setTimeout(r, 600)),
      ]);
      setRefreshDone(true);
      setTimeout(() => setRefreshDone(false), 2000);
    } catch (err: unknown) {
      toast.error(t('refreshFailed'), err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing(false);
    }
  };

  const refreshSkillsAndFetch = async () => {
    try {
      await skillAPI.refresh();
    } catch {
      // Fall back to a plain fetch if refresh is temporarily unavailable.
    }
    return fetchSkills({ silent: true, invalidateOnError: true });
  };

  const handleSelectSkill = async (skill: Skill) => {
    try {
      const response = await skillAPI.get(skill.name);
      setSheetSkill(response.data);
    } catch (err: unknown) {
      toast.error(t('fetchDetailFailed'), err instanceof Error ? err.message : String(err));
    }
  };

  const handleToggle = async (skill: Skill, e: React.MouseEvent) => {
    e.stopPropagation();
    setTogglingSkills(prev => ({ ...prev, [skill.name]: true }));
    try {
      const res = await skillAPI.toggle(skill.name);
      // Update local state after the server confirms — keeps UI in sync
      // without an extra GET round-trip.
      setSkills(prev => prev.map(s =>
        s.name === skill.name ? { ...s, disabled: res.data.disabled } : s
      ));
    } catch (err: unknown) {
      toast.error(t('toggle.failed'), err instanceof Error ? err.message : String(err));
    } finally {
      setTogglingSkills(prev => ({ ...prev, [skill.name]: false }));
    }
  };

  const handleInstallDeps = async (skill: Skill, e: React.MouseEvent) => {
    e.stopPropagation();
    setInstallingDeps(prev => ({ ...prev, [skill.name]: true }));
    try {
      const res = await skillAPI.installDeps(skill.name);
      const allOk = res.data.results.every(r => r.success);
      if (allOk) {
        toast.success(t('eligibility.installSuccess'));
        await fetchSkills({ silent: true, invalidateOnError: true });
      } else {
        const errors = res.data.results
          .filter(r => !r.success)
          .map(r => r.error || 'unknown error')
          .join('; ');
        toast.error(t('eligibility.installFailed'), errors);
      }
    } catch (err: unknown) {
      toast.error(t('installDepsFailed'), err instanceof Error ? err.message : String(err));
    } finally {
      setInstallingDeps(prev => ({ ...prev, [skill.name]: false }));
    }
  };

  const handleInstalled = async () => {
    await refreshSkillsAndFetch();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <LoadingSpinner />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <p className="text-red-600 mb-4">{error}</p>
          <button onClick={() => fetchSkills()} className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700">
            {t('common:button.retry')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <PageHeader
        title={t('pageTitle')}
        description={t('pageDescription')}
        icon={<BookOpen className="w-8 h-8" />}
      />

      {/* Toolbar: 搜索 · 统计过滤 chips · 刷新/安装/创建 */}
      <div className="px-4 py-2 border-b border-gray-100 flex flex-wrap items-center gap-3">
        {/* 搜索 */}
        <div className="relative w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          <input
            type="text"
            placeholder={t('searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-300 focus:border-slate-400 text-sm bg-white"
          />
        </div>

        {/* 统计 + 过滤 segment chips */}
        <FilterChips
          value={statusFilter}
          onChange={setStatusFilter}
          total={visibleSkills.length}
          enabled={enabledCount}
          disabled={disabledCount}
        />

        {/* 右侧操作：刷新 + 安装 + 创建 */}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            title={refreshDone ? t('refreshed') : t('refresh')}
            className={`p-1.5 rounded-lg border transition-all ${
              refreshDone
                ? 'border-green-200 text-green-600'
                : 'border-gray-200 text-gray-400 hover:bg-gray-50 hover:text-gray-600 disabled:opacity-50'
            }`}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => setShowInstallDialog(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 text-gray-700 bg-white rounded-lg hover:bg-gray-50 transition-colors text-sm"
          >
            <CloudDownload className="w-4 h-4" />
            {t('installSkill')}
          </button>
          <button
            onClick={() => setShowCreateSheet(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm"
          >
            <Plus className="w-4 h-4" />
            {t('createSkill')}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {filteredSkills.length === 0 ? (
          (() => {
            // Three distinct empty states:
            //   * narrowed by search       — show "no results"
            //   * narrowed by status chip  — show "no skills in this view"
            //                                with a quick "show all" reset
            //   * truly empty inventory    — show CTA buttons
            const isNarrowed = !!searchQuery || statusFilter !== 'all';
            return (
              <EmptyState
                icon={<BookOpen className="w-16 h-16" />}
                title={isNarrowed ? t('emptyState.noResults') : t('emptyState.noSkills')}
                description={
                  isNarrowed
                    ? t('emptyState.tryOtherKeywords')
                    : t('emptyState.createFirst')
                }
                action={
                  isNarrowed ? (
                    statusFilter !== 'all' ? (
                      <button
                        onClick={() => setStatusFilter('all')}
                        className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 bg-white rounded-lg hover:bg-gray-50"
                      >
                        {t('filter.showAll')}
                      </button>
                    ) : undefined
                  ) : (
                    <div className="flex gap-2">
                      <button
                        onClick={() => setShowInstallDialog(true)}
                        className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 bg-white rounded-lg hover:bg-gray-50"
                      >
                        <CloudDownload className="w-5 h-5" />
                        {t('installSkill')}
                      </button>
                      <button
                        onClick={() => setShowCreateSheet(true)}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
                      >
                        <Plus className="w-5 h-5" />
                        {t('createSkill')}
                      </button>
                    </div>
                  )
                }
              />
            );
          })()
        ) : (
          <SkillTable
            skills={pagedSkills}
            selectedSkill={sheetSkill}
            installingDeps={installingDeps}
            togglingSkills={togglingSkills}
            onSelect={handleSelectSkill}
            onInstallDeps={handleInstallDeps}
            onToggle={handleToggle}
          />
        )}
      </div>

      {filteredSkills.length > PAGE_SIZE && (
        <PaginationBar
          total={filteredSkills.length}
          page={currentPage}
          totalPages={totalPages}
          onPageChange={setPage}
        />
      )}

      {sheetSkill && (
        <SkillSheet
          skill={sheetSkill}
          onClose={() => setSheetSkill(null)}
          onSaved={async () => {
            await fetchSkills({ silent: true, invalidateOnError: true });
            setSheetSkill(null);
          }}
          onDeleted={async () => {
            await fetchSkills({ silent: true, invalidateOnError: true });
            setSheetSkill(null);
          }}
        />
      )}

      {showCreateSheet && (
        <SkillSheet
          onClose={() => setShowCreateSheet(false)}
          onSaved={async () => {
            setShowCreateSheet(false);
            await refreshSkillsAndFetch();
          }}
        />
      )}

      {showInstallDialog && (
        <SkillInstallDialog
          onClose={() => setShowInstallDialog(false)}
          onInstalled={handleInstalled}
        />
      )}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isUserManaged(skill: Skill): boolean {
  return skill.source !== 'project';
}

// ─── SkillTable ───────────────────────────────────────────────────────────────

interface SkillTableProps {
  skills: Skill[];
  selectedSkill: Skill | null;
  installingDeps: Record<string, boolean>;
  togglingSkills: Record<string, boolean>;
  onSelect: (skill: Skill) => void;
  onInstallDeps: (skill: Skill, e: React.MouseEvent) => void;
  onToggle: (skill: Skill, e: React.MouseEvent) => void;
}

function SkillTable({ skills, selectedSkill, installingDeps, togglingSkills, onSelect, onInstallDeps, onToggle }: SkillTableProps) {
  const { t } = useTranslation('skill');

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <table className="min-w-full table-fixed text-xs">
        {/* 5-column layout: type 8% · name+desc+deps 50% · source 18%
            · enabled-toggle 12% · actions 12%.  We dropped the dedicated
            "Status" column because it only ever showed Ready / Missing,
            and "Missing" is more actionable inline beneath the name. */}
        <colgroup>
          <col style={{ width: '8%' }} />
          <col style={{ width: '50%' }} />
          <col style={{ width: '18%' }} />
          <col style={{ width: '12%' }} />
          <col style={{ width: '12%' }} />
        </colgroup>
        <thead className="bg-gray-50 text-gray-500 border-b border-gray-200">
          <tr>
            <th className="text-left px-4 py-2.5 font-medium">{t('table.type')}</th>
            <th className="text-left px-4 py-2.5 font-medium">{t('table.name')}</th>
            <th className="text-left px-4 py-2.5 font-medium">{t('table.source')}</th>
            <th
              className="text-left px-4 py-2.5 font-medium"
              title={t('toggle.enabledTip')}
            >
              {t('table.enabled')}
            </th>
            <th className="text-right px-4 py-2.5 font-medium">{t('table.actions')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {skills.map(skill => (
            <SkillRow
              key={skill.name}
              skill={skill}
              isSelected={selectedSkill?.name === skill.name}
              installingDeps={installingDeps[skill.name] ?? false}
              toggling={togglingSkills[skill.name] ?? false}
              onSelect={onSelect}
              onInstallDeps={onInstallDeps}
              onToggle={onToggle}
            />
          ))}
          {skills.length === 0 && (
            <tr>
              <td colSpan={5} className="px-4 py-12 text-center text-gray-400">
                {t('emptyState.noResults')}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ─── SkillRow ─────────────────────────────────────────────────────────────────

interface SkillRowProps {
  skill: Skill;
  isSelected: boolean;
  installingDeps: boolean;
  toggling: boolean;
  onSelect: (skill: Skill) => void;
  onInstallDeps: (skill: Skill, e: React.MouseEvent) => void;
  onToggle: (skill: Skill, e: React.MouseEvent) => void;
}

function SkillRow({ skill, isSelected, installingDeps, toggling, onSelect, onInstallDeps, onToggle }: SkillRowProps) {
  const { t } = useTranslation('skill');
  const isUser = isUserManaged(skill);
  const hasMissingDeps = skill.eligible === false && (skill.install_specs?.length ?? 0) > 0;
  const enabled = !skill.disabled;

  // Row is no longer clickable — the edit button in the "Actions" column
  // is the only way to open SkillSheet.  We keep a subtle hover so users
  // can still scan rows visually, but drop ``cursor-pointer`` to avoid
  // promising a click-affordance that isn't there.
  return (
    <tr
      className={`transition-colors ${
        skill.disabled ? 'opacity-50' : 'hover:bg-gray-50'
      } ${isSelected ? 'bg-slate-50' : ''}`}
    >
      {/* 类型列 */}
      <td className="px-4 py-3">
        <SourceTypeBadge isUser={isUser} />
      </td>

      {/* 名称 + 描述列（含内嵌的缺依赖警告） */}
      <td className="max-w-0 px-4 py-3">
        <div className="flex items-start gap-2.5 min-w-0">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 bg-gray-100 text-gray-400 mt-0.5">
            {isUser
              ? <FolderOpen className="w-3.5 h-3.5" />
              : <Sparkles className="w-3.5 h-3.5" />
            }
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-medium text-gray-900 truncate">{skill.name}</div>
            <div className="text-[11px] text-gray-400 truncate mt-0.5">
              {skill.description || t('sheet.noDescription')}
            </div>
            {/* The old "Status" column collapsed to this single inline
                warning — only rendered when the skill is actually
                missing dependencies, so the row stays quiet by default. */}
            {hasMissingDeps && (
              <div
                className="text-[11px] text-amber-600 truncate mt-0.5 flex items-center gap-1"
                title={(skill.missing ?? []).join(', ')}
              >
                <AlertTriangle className="w-3 h-3 shrink-0" />
                <span className="truncate">
                  {t('eligibility.missingDepsInline', {
                    list: (skill.missing ?? []).join(', '),
                  })}
                </span>
              </div>
            )}
          </div>
        </div>
      </td>

      {/* 来源列 */}
      <td className="max-w-0 px-4 py-3">
        <span className="text-[11px] text-gray-400 font-mono truncate block" title={skill.location}>
          {skill.source ?? '-'}
        </span>
      </td>

      {/* 启用开关列：控制 skill 是否注入 Agent System Prompt */}
      <td className="px-4 py-3">
        <ToggleSwitch
          enabled={enabled}
          loading={toggling}
          title={enabled ? t('toggle.enabledTip') : t('toggle.disabledTip')}
          onChange={(e) => onToggle(skill, e)}
        />
      </td>

      {/* 操作列：编辑（+ 缺依赖时的安装按钮）；删除操作在编辑面板内 */}
      <td className="px-4 py-3 text-right">
        <div className="flex items-center justify-end gap-1">
          {hasMissingDeps && (
            <button
              onClick={(e) => onInstallDeps(skill, e)}
              disabled={installingDeps}
              title={t('eligibility.installDeps')}
              className="inline-flex items-center gap-1 px-2 py-1 rounded border border-gray-200
                         bg-white text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              {installingDeps
                ? <Loader2 className="w-3 h-3 animate-spin" />
                : <CloudDownload className="w-3 h-3" />
              }
              {installingDeps ? t('eligibility.installing') : t('eligibility.installDeps')}
            </button>
          )}
          <button
            type="button"
            onClick={() => onSelect(skill)}
            title={t('table.edit')}
            aria-label={t('table.edit')}
            className="p-1.5 rounded-md border border-gray-200 text-gray-500
                       hover:border-slate-300 hover:text-slate-700 hover:bg-gray-50
                       transition-colors"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
        </div>
      </td>
    </tr>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ToggleSwitch({ enabled, loading, title, onChange }: {
  enabled: boolean;
  loading: boolean;
  title?: string;
  onChange: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      onClick={onChange}
      disabled={loading}
      title={title}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border-2 border-transparent
        transition-colors duration-150 focus:outline-none disabled:cursor-wait
        ${enabled ? 'bg-slate-700' : 'bg-gray-200'}`}
    >
      {loading
        ? <Loader2 className="absolute inset-0 m-auto w-3 h-3 text-white animate-spin" />
        : (
          <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow
            transform transition-transform duration-150
            ${enabled ? 'translate-x-4' : 'translate-x-0'}`}
          />
        )
      }
    </button>
  );
}

function SourceTypeBadge({ isUser }: { isUser: boolean }) {
  const { t } = useTranslation('skill');
  if (isUser) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-gray-200 bg-white text-gray-500 whitespace-nowrap">
        <FolderOpen className="w-3 h-3" />
        {t('table.custom')}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-gray-200 bg-gray-50 text-gray-500 whitespace-nowrap">
      <Sparkles className="w-3 h-3" />
      {t('table.builtin')}
    </span>
  );
}

// ─── FilterChips ──────────────────────────────────────────────────────────────
//
// One segmented control that serves both as the "how many" stat readout and
// as the view-filter.  Each chip shows `label · count` and is highlighted
// when active.  Clicking a chip toggles the filter to that segment.

type StatusFilterValue = 'all' | 'enabled' | 'disabled';

function FilterChips({
  value,
  onChange,
  total,
  enabled,
  disabled,
}: {
  value: StatusFilterValue;
  onChange: (v: StatusFilterValue) => void;
  total: number;
  enabled: number;
  disabled: number;
}) {
  const { t } = useTranslation('skill');
  const chips: Array<{ key: StatusFilterValue; label: string; count: number }> = [
    { key: 'all', label: t('filter.all'), count: total },
    { key: 'enabled', label: t('filter.enabled'), count: enabled },
    { key: 'disabled', label: t('filter.disabled'), count: disabled },
  ];
  return (
    <div
      role="tablist"
      aria-label={t('filter.aria')}
      className="inline-flex items-center rounded-lg border border-gray-200 bg-white p-0.5 text-xs"
    >
      {chips.map((chip, idx) => {
        const active = chip.key === value;
        return (
          <button
            key={chip.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(chip.key)}
            className={`px-2.5 py-1 rounded-md transition-colors whitespace-nowrap ${
              active
                ? 'bg-slate-700 text-white'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            } ${idx > 0 ? 'ml-0.5' : ''}`}
          >
            <span>{chip.label}</span>
            <span
              className={`ml-1.5 inline-block min-w-[1.25rem] px-1 rounded text-[10px] tabular-nums ${
                active ? 'bg-white/15' : 'bg-gray-100 text-gray-500'
              }`}
            >
              {chip.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ─── PaginationBar ────────────────────────────────────────────────────────────

function PaginationBar({ total, page, totalPages, onPageChange }: {
  total: number;
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  const { t } = useTranslation('skill');
  const start = (page - 1) * PAGE_SIZE + 1;
  const end = Math.min(total, page * PAGE_SIZE);
  return (
    <div className="px-4 py-2 border-t border-gray-200 bg-white flex items-center justify-between text-xs text-gray-500">
      <span>{t('pagination.info', { start, end, total })}</span>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1}
          className="p-1 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
        <span className="min-w-16 text-center">{page} / {totalPages}</span>
        <button
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
          className="p-1 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40"
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
