// Security Guardrail Compliance report (enterprise view).
//
// A large, centered overlay launched from the compact summary card in the IaC
// preview sidebar. Read-only and additive: it only ever renders when a
// ComplianceReport exists, so the rest of the app is unaffected.
//
// Layout: gradient header, a confidence hero (score + progress + stat tiles),
// and three tabs - Enforced controls, Operational guidance, All guardrails -
// each answering a different question without cramming detail into one list.

import { useEffect, useMemo, useState } from 'react';
import { Icon } from '@iconify/react';
import { cn } from '@/lib/utils';
import type { ComplianceReport, ComplianceGuardrail } from '@/types';
import {
  bucketize,
  layerKey,
  matchesLayer,
  severityLabel,
  shortType,
  SEVERITY_ORDER,
  SEVERITY_STYLES,
  SEVERITY_DOT,
  STATUS_META,
  type FlatGuardrail,
} from '@/lib/guardrailsClassify';

interface GuardrailsReportModalProps {
  report: ComplianceReport;
  onClose: () => void;
}

type Tab = 'controls' | 'guidance' | 'all';

// Ring colour follows confidence: strong green when fully enforced, amber otherwise.
function confidenceTone(pct: number, hasControls: boolean) {
  if (!hasControls) return { ring: 'text-gray-300', text: 'text-gray-500', label: 'No controls' };
  if (pct >= 100) return { ring: 'text-emerald-500', text: 'text-emerald-600', label: 'Fully enforced' };
  if (pct >= 60) return { ring: 'text-amber-500', text: 'text-amber-600', label: 'Mostly enforced' };
  return { ring: 'text-red-500', text: 'text-red-600', label: 'Needs attention' };
}

// Circular confidence gauge (pure SVG, no dependency).
function ConfidenceRing({ pct, hasControls }: { pct: number; hasControls: boolean }) {
  const tone = confidenceTone(pct, hasControls);
  const r = 42;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  return (
    <div className="relative w-28 h-28 shrink-0">
      <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" stroke="currentColor" strokeWidth="8" className="text-gray-200" />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circ}`}
          className={cn('transition-all duration-700', tone.ring)}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={cn('text-2xl font-bold', tone.text)}>{hasControls ? `${pct}%` : 'n/a'}</span>
        <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wide">Confidence</span>
      </div>
    </div>
  );
}

function StatTile({
  icon,
  label,
  value,
  accent,
}: {
  icon: string;
  label: string;
  value: number;
  accent: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2.5">
      <div className={cn('flex items-center justify-center w-8 h-8 rounded-md shrink-0', accent)}>
        <Icon icon={icon} className="w-4 h-4" />
      </div>
      <div className="min-w-0">
        <div className="text-lg font-semibold text-gray-800 leading-none">{value}</div>
        <div className="text-[11px] text-gray-500 mt-0.5">{label}</div>
      </div>
    </div>
  );
}

// A single enforced-control row: clear pass/fail, expandable for detail.
function ControlRow({ item }: { item: FlatGuardrail }) {
  const [open, setOpen] = useState(false);
  const g = item.g;
  const pass = g.status === 'pass';
  return (
    <li className="rounded-lg border border-gray-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-start gap-3 px-3 py-2.5 text-left hover:bg-gray-50 rounded-lg"
      >
        <Icon
          icon={pass ? 'mdi:check-circle' : 'mdi:close-circle'}
          className={cn('w-5 h-5 mt-0.5 shrink-0', pass ? 'text-emerald-600' : 'text-red-600')}
        />
        <span className="flex-1 min-w-0">
          <span className="block text-sm text-gray-800">{g.recommendation || g.service}</span>
          <span className="text-[11px] font-mono text-gray-400">
            {shortType(item.resource_type)}
            {g.control_id ? ` · ${g.control_id}` : ''}
          </span>
        </span>
        <span
          className={cn(
            'shrink-0 mt-0.5 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold',
            pass ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
          )}
        >
          {pass ? 'Enforced' : 'To fix'}
        </span>
      </button>
      {open && (
        <div className="px-3 pb-3 pt-0 ml-8 space-y-1 text-xs text-gray-500">
          <div>
            <span className="font-medium text-gray-600">In template:</span>{' '}
            {pass ? 'Property set to the required secure value.' : 'Property not set to the required value yet.'}
          </div>
          {g.risk && (
            <div>
              <span className="font-medium text-gray-600">Mitigates:</span> {g.risk}
            </div>
          )}
          {g.benchmark && (
            <div>
              <span className="font-medium text-gray-600">Benchmark:</span> {g.benchmark}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

// Full-detail row for guidance and the "all" tab (severity + expandable metadata).
function GuardrailRow({ g }: { g: ComplianceGuardrail }) {
  const [open, setOpen] = useState(false);
  const status = STATUS_META[g.status] ?? STATUS_META.advisory;
  const sevStyle = SEVERITY_STYLES[g.severity] ?? SEVERITY_STYLES.none;
  return (
    <li className="rounded-lg border border-gray-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-start gap-3 px-3 py-2.5 text-left hover:bg-gray-50 rounded-lg"
      >
        <Icon icon={status.icon} className={cn('w-4 h-4 mt-1 shrink-0', status.className)} />
        <span className="flex-1 min-w-0">
          <span className="flex items-center gap-2 flex-wrap">
            <span
              className={cn(
                'inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold border',
                sevStyle
              )}
            >
              {severityLabel(g.severity)}
            </span>
            {g.control_id && <span className="text-[10px] font-mono text-gray-400">{g.control_id}</span>}
          </span>
          <span className="block text-sm text-gray-800 mt-1">{g.recommendation || g.service}</span>
        </span>
        <Icon
          icon={open ? 'mdi:chevron-up' : 'mdi:chevron-down'}
          className="w-4 h-4 mt-1 shrink-0 text-gray-400"
        />
      </button>
      {open && (
        <div className="px-3 pb-3 pt-0 ml-7 space-y-1 text-xs text-gray-500">
          <div>
            <span className="font-medium text-gray-600">Status:</span> {status.label}
          </div>
          {g.risk && (
            <div>
              <span className="font-medium text-gray-600">Risk:</span> {g.risk}
            </div>
          )}
          {g.benchmark && (
            <div>
              <span className="font-medium text-gray-600">Benchmark:</span> {g.benchmark}
            </div>
          )}
          {g.policy && (
            <div>
              <span className="font-medium text-gray-600">
                {g.benchmark?.startsWith('AWS') ? 'AWS Config rule:' : 'Azure Policy:'}
              </span>{' '}
              {g.policy}
            </div>
          )}
          <div>
            <span className="font-medium text-gray-600">Layer:</span> {g.layer || 'n/a'}
          </div>
        </div>
      )}
    </li>
  );
}

export function GuardrailsReportModal({ report, onClose }: GuardrailsReportModalProps) {
  const [tab, setTab] = useState<Tab>('controls');
  const [activeLayer, setActiveLayer] = useState<string>('All');

  const { summary } = report;
  const buckets = useMemo(() => bucketize(report), [report]);
  const {
    controls,
    guidance,
    vulnerabilities,
    controlsPassed,
    controlsTotal,
    controlsFailed,
    confidence,
  } = buckets;
  const hasControls = controlsTotal > 0;

  // Concrete control dispositions, so the report can name exactly what was addressed.
  const addressedControls = controls
    .filter((f) => f.g.status === 'pass')
    .map((f) => f.g.control_id)
    .filter(Boolean);
  const toFixControls = controls
    .filter((f) => f.g.status === 'warn')
    .map((f) => f.g.control_id)
    .filter(Boolean);

  // Close on Escape for keyboard users.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Layers present across resource + environment guardrails (for the All tab filter).
  const availableLayers = useMemo(() => {
    const set = new Set<string>();
    report.by_resource.forEach((grp) => grp.guardrails.forEach((g) => set.add(layerKey(g.layer))));
    report.environment.forEach((g) => set.add(layerKey(g.layer)));
    const preferred = ['Resource', 'Platform'];
    const rest = [...set].filter((l) => !preferred.includes(l)).sort();
    return ['All', ...preferred.filter((l) => set.has(l)), ...rest];
  }, [report]);

  const filteredResources = useMemo(
    () =>
      report.by_resource
        .map((grp) => ({
          ...grp,
          guardrails: grp.guardrails.filter((g) => matchesLayer(g, activeLayer)),
        }))
        .filter((grp) => grp.guardrails.length > 0),
    [report.by_resource, activeLayer]
  );

  const filteredEnvironment = useMemo(
    () => report.environment.filter((g) => matchesLayer(g, activeLayer)),
    [report.environment, activeLayer]
  );

  const tone = confidenceTone(confidence, hasControls);

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: 'controls', label: 'Enforced controls', count: controlsTotal },
    { id: 'guidance', label: 'Operational guidance', count: guidance.length },
    { id: 'all', label: 'All guardrails', count: summary.guardrails_total },
  ];

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-[min(1040px,96vw)] max-h-[92vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-brand-accent to-brand-accentDark">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-white/15">
              <Icon icon="mdi:shield-check" className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white leading-tight">
                Security Guardrail Compliance
              </h2>
              <p className="text-[11px] text-white/70">
                Microsoft cloud security benchmark · {report.format?.toUpperCase() || 'IAC'} template
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/20 transition-colors"
            title="Close"
          >
            <Icon icon="mdi:close" className="w-5 h-5 text-white" />
          </button>
        </div>

        {/* Hero: confidence + stat tiles */}
        <div className="px-6 py-5 border-b border-gray-200 bg-gray-50">
          <div className="flex flex-col lg:flex-row gap-5 lg:items-center">
            <div className="flex items-center gap-4">
              <ConfidenceRing pct={confidence} hasControls={hasControls} />
              <div className="min-w-0">
                <div className={cn('text-sm font-semibold', tone.text)}>{tone.label}</div>
                <p className="text-xs text-gray-600 mt-1 max-w-xs">
                  {hasControls ? (
                    <>
                      This template enforces{' '}
                      <span className="font-semibold text-gray-800">
                        {controlsPassed} of {controlsTotal}
                      </span>{' '}
                      checkable guardrail control{controlsTotal === 1 ? '' : 's'}.
                      {controlsFailed > 0 && (
                        <span className="text-amber-700 font-medium"> {controlsFailed} still to fix.</span>
                      )}
                    </>
                  ) : (
                    <>No template-enforceable controls apply to these resources. See guidance.</>
                  )}
                </p>
                {hasControls && (
                  <div className="mt-2 h-2 w-56 max-w-full bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className={cn(
                        'h-full rounded-full transition-all duration-700',
                        confidence >= 100
                          ? 'bg-emerald-500'
                          : confidence >= 60
                          ? 'bg-amber-500'
                          : 'bg-red-500'
                      )}
                      style={{ width: `${confidence}%` }}
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 flex-1">
              <StatTile
                icon="mdi:check-decagram"
                label="Controls enforced"
                value={controlsPassed}
                accent="bg-emerald-50 text-emerald-600"
              />
              <StatTile
                icon="mdi:wrench"
                label="Controls to fix"
                value={controlsFailed}
                accent={controlsFailed > 0 ? 'bg-amber-50 text-amber-600' : 'bg-gray-100 text-gray-400'}
              />
              <StatTile
                icon="mdi:clipboard-text"
                label="Guidance items"
                value={guidance.length}
                accent="bg-blue-50 text-blue-600"
              />
              <StatTile
                icon="mdi:bug-outline"
                label="CVE advisories"
                value={vulnerabilities.length}
                accent={vulnerabilities.length > 0 ? 'bg-purple-50 text-purple-600' : 'bg-gray-100 text-gray-400'}
              />
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 px-6 pt-3 border-b border-gray-200">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                'relative px-3 py-2 text-sm font-medium transition-colors',
                tab === t.id ? 'text-brand-accent' : 'text-gray-500 hover:text-gray-700'
              )}
            >
              {t.label}
              <span
                className={cn(
                  'ml-1.5 inline-flex items-center justify-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold',
                  tab === t.id ? 'bg-brand-accent/10 text-brand-accent' : 'bg-gray-100 text-gray-500'
                )}
              >
                {t.count}
              </span>
              {tab === t.id && (
                <span className="absolute left-0 right-0 -bottom-px h-0.5 bg-brand-accent rounded-full" />
              )}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {report.exceptions && report.exceptions.length > 0 && (
            <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
              <p className="text-xs text-amber-900 font-medium flex items-center gap-1">
                <Icon icon="mdi:alert-outline" className="w-4 h-4 text-amber-600" />
                {report.exceptions.length} accepted networking exception
                {report.exceptions.length === 1 ? '' : 's'}
              </p>
              <ul className="mt-1.5 space-y-1">
                {report.exceptions.map((e, i) => (
                  <li key={`exc:${i}`} className="text-[11px] text-amber-800 leading-snug">
                    <span className="font-mono font-medium">{e.name || shortType(e.resource_type)}</span>
                    {' keeps public network access enabled. '}
                    {e.justification ? `Reason: ${e.justification}` : 'No justification recorded.'}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {tab === 'controls' && (
            <>
              {hasControls && (
                <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5">
                  <p className="text-xs text-emerald-800 leading-relaxed">
                    <Icon icon="mdi:check-decagram" className="inline w-4 h-4 mr-1 -mt-0.5 text-emerald-600" />
                    These guardrail controls are enforced directly in the template and verified against the
                    generated code.
                  </p>
                  {addressedControls.length > 0 && (
                    <p className="text-[11px] text-emerald-700 mt-1.5">
                      <span className="font-semibold">Addressed:</span>{' '}
                      <span className="font-mono">{addressedControls.join(', ')}</span>
                    </p>
                  )}
                  {toFixControls.length > 0 && (
                    <p className="text-[11px] text-amber-700 mt-1">
                      <span className="font-semibold">To fix:</span>{' '}
                      <span className="font-mono">{toFixControls.join(', ')}</span>
                    </p>
                  )}
                </div>
              )}
              {hasControls ? (
                <ul className="space-y-2">
                  {controls.map((item, i) => (
                    <ControlRow
                      key={`ctl:${item.resource_type ?? 'env'}:${item.g.control_id}:${i}`}
                      item={item}
                    />
                  ))}
                </ul>
              ) : (
                <div className="text-center text-sm text-gray-500 py-10">
                  <Icon icon="mdi:shield-outline" className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                  No template-enforceable controls apply to these resources.
                </div>
              )}
            </>
          )}

          {tab === 'guidance' && (
            <>
              {guidance.length > 0 && (
                <div className="mb-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5">
                  <p className="text-xs text-blue-900 leading-relaxed">
                    <Icon icon="mdi:lightbulb-on-outline" className="inline w-4 h-4 mr-1 -mt-0.5 text-blue-600" />
                    These controls should ideally be implemented as part of platform, subscription, and
                    identity configuration (the landing zone), which sits outside a resource template's
                    scope. Severity reflects each control's importance in the guardrail baseline, not a gap in
                    this template.
                  </p>
                </div>
              )}
              {guidance.length > 0 ? (
                <ul className="space-y-2">
                  {guidance.map((item, i) => (
                    <GuardrailRow key={`gd:${item.g.control_id}:${i}`} g={item.g} />
                  ))}
                </ul>
              ) : (
                <div className="text-center text-sm text-gray-500 py-10">
                  <Icon icon="mdi:clipboard-check-outline" className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                  No operational guidance for these resources.
                </div>
              )}
            </>
          )}

          {tab === 'all' && (
            <>
              {/* Severity summary chips */}
              <div className="flex flex-wrap gap-1.5 mb-3">
                {SEVERITY_ORDER.filter((sev) => (summary.by_severity[sev] ?? 0) > 0).map((sev) => (
                  <span
                    key={sev}
                    className={cn(
                      'inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium border',
                      SEVERITY_STYLES[sev]
                    )}
                  >
                    <span className={cn('w-1.5 h-1.5 rounded-full', SEVERITY_DOT[sev])} />
                    {severityLabel(sev)} {summary.by_severity[sev]}
                  </span>
                ))}
              </div>

              {/* Layer filter */}
              {availableLayers.length > 2 && (
                <div className="flex flex-wrap gap-1.5 mb-4">
                  {availableLayers.map((layer) => (
                    <button
                      key={layer}
                      type="button"
                      onClick={() => setActiveLayer(layer)}
                      className={cn(
                        'px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors',
                        activeLayer === layer
                          ? 'bg-brand-accent text-white border-brand-accent'
                          : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                      )}
                    >
                      {layer}
                    </button>
                  ))}
                </div>
              )}

              <div className="space-y-4">
                {filteredResources.map((grp) => (
                  <div key={grp.resource_type}>
                    <h4 className="text-xs font-semibold text-gray-500 mb-1.5 font-mono break-all">
                      {grp.resource_type}
                    </h4>
                    <ul className="space-y-2">
                      {grp.guardrails.map((g) => (
                        <GuardrailRow key={`${grp.resource_type}:${g.control_id}`} g={g} />
                      ))}
                    </ul>
                  </div>
                ))}

                {filteredEnvironment.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold text-gray-500 mb-1.5 flex items-center gap-1">
                      <Icon icon="mdi:earth" className="w-3.5 h-3.5" />
                      Environment &amp; identity
                    </h4>
                    <ul className="space-y-2">
                      {filteredEnvironment.map((g) => (
                        <GuardrailRow key={`env:${g.control_id}`} g={g} />
                      ))}
                    </ul>
                  </div>
                )}

                {filteredResources.length === 0 && filteredEnvironment.length === 0 && (
                  <p className="text-sm text-gray-400 italic py-6 text-center">
                    No guardrails for this layer.
                  </p>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer note: explains the compliant-by-default model honestly */}
        <div className="px-6 py-3 border-t border-gray-200 bg-gray-50">
          <p className="text-[11px] text-gray-500 leading-relaxed">
            <Icon icon="mdi:information-outline" className="inline w-3.5 h-3.5 mr-1 -mt-0.5 text-gray-400" />
            Templates are generated compliant-by-default: the required secure properties are injected into
            the IaC. Enforced controls are verified deterministically against the generated code. Guidance
            and CVE items are operational or runtime concerns that a template cannot set, shown for
            awareness only.
          </p>
        </div>
      </div>
    </div>
  );
}
