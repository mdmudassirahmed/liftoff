// Security guardrail compliance summary card.
//
// Compact, confidence-forward card shown in the IaC preview sidebar. It gives a
// one-glance read (confidence + counts) and opens the full enterprise report
// (GuardrailsReportModal) for detail, instead of cramming everything into 72px width.
//
// Read-only and additive: rendered only when a compliance report is present, so
// the modal behaves exactly as before this feature when absent.

import { useMemo, useState } from 'react';
import { Icon } from '@iconify/react';
import { cn } from '@/lib/utils';
import type { ComplianceReport } from '@/types';
import { bucketize } from '@/lib/guardrailsClassify';
import { GuardrailsReportModal } from './GuardrailsReportModal';

interface GuardrailsCompliancePanelProps {
  report: ComplianceReport;
}

export function GuardrailsCompliancePanel({ report }: GuardrailsCompliancePanelProps) {
  const [open, setOpen] = useState(false);
  const b = useMemo(() => bucketize(report), [report]);
  const { controlsPassed, controlsTotal, controlsFailed, guidance, vulnerabilities, confidence } = b;
  const hasControls = controlsTotal > 0;

  const barColor =
    !hasControls
      ? 'bg-gray-300'
      : confidence >= 100
      ? 'bg-emerald-500'
      : confidence >= 60
      ? 'bg-amber-500'
      : 'bg-red-500';

  return (
    <div className="p-4 border-b border-gray-200">
      <div className="flex items-center gap-2 mb-2.5">
        <Icon icon="mdi:shield-check" className="w-4 h-4 text-emerald-600" />
        <h3 className="text-sm font-semibold text-emerald-700">Security Guardrails</h3>
      </div>

      {/* Confidence card */}
      <div className="rounded-lg border border-gray-200 bg-white p-3">
        {hasControls ? (
          <>
            <div className="flex items-baseline justify-between">
              <span className="text-2xl font-bold text-gray-800">{confidence}%</span>
              <span className="text-[11px] text-gray-500">
                {controlsPassed}/{controlsTotal} controls
              </span>
            </div>
            <div className="mt-2 h-1.5 bg-gray-200 rounded-full overflow-hidden">
              <div
                className={cn('h-full rounded-full transition-all duration-500', barColor)}
                style={{ width: `${confidence}%` }}
              />
            </div>
            <p className="mt-2 text-[11px] text-gray-500">
              {controlsFailed === 0 ? (
                <span className="text-emerald-700 font-medium">All enforceable controls met.</span>
              ) : (
                <span className="text-amber-700 font-medium">{controlsFailed} control to fix.</span>
              )}
            </p>
          </>
        ) : (
          <p className="text-[11px] text-gray-500">
            No template-enforceable controls apply. See guidance in the full report.
          </p>
        )}
      </div>

      {/* Mini stat chips */}
      <div className="flex flex-wrap gap-1.5 mt-2.5">
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-700 border border-blue-100">
          <Icon icon="mdi:clipboard-text" className="w-3 h-3" />
          {guidance.length} guidance
        </span>
        {vulnerabilities.length > 0 && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-purple-50 text-purple-700 border border-purple-100">
            <Icon icon="mdi:bug-outline" className="w-3 h-3" />
            {vulnerabilities.length} CVE
          </span>
        )}
        {report.exceptions && report.exceptions.length > 0 && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-100">
            <Icon icon="mdi:alert-outline" className="w-3 h-3" />
            {report.exceptions.length} exception
          </span>
        )}
      </div>

      {/* Launch the full report */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-white bg-brand-accent hover:bg-brand-accentDark transition-colors"
      >
        <Icon icon="mdi:file-chart-outline" className="w-4 h-4" />
        View compliance report
      </button>

      {open && <GuardrailsReportModal report={report} onClose={() => setOpen(false)} />}
    </div>
  );
}
