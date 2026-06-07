// Rejection view for catalog templates
//
// Displays detailed rejection information with categorized failures.

import React from 'react';

import type { FailureReason } from '../../../types/catalog.js';

interface RejectionViewProps {
  templateId: string;
  version: string;
  failureReasons: FailureReason[];
}

/**
 * Categorize failures by code type.
 */
function categorizeFailures(reasons: FailureReason[]): Record<string, FailureReason[]> {
  const categories: Record<string, FailureReason[]> = {};
  
  for (const reason of reasons) {
    if (!categories[reason.code]) {
      categories[reason.code] = [];
    }
    categories[reason.code].push(reason);
  }
  
  return categories;
}

/**
 * Format failure code into human-readable label.
 */
function formatCodeLabel(code: string): string {
  const labels: Record<string, string> = {
    UNKNOWN_CAPABILITY_BUNDLE: 'Unknown Capability Bundle',
    INVALID_FIELD_TYPE: 'Invalid Field Type',
    UNKNOWN_PLATFORM_PRIMITIVE: 'Unknown Platform Primitive',
    LEAST_PRIVILEGE_VIOLATION: 'Least Privilege Violation',
    SECRET_VALUE_PRESENT: 'Potential Secret Detected',
    DUPLICATE_TEMPLATE_ID: 'Duplicate Template ID',
    VERSION_CONFLICT: 'Version Conflict',
    UNKNOWN_MCP_SERVER: 'Unknown MCP Server',
    UNKNOWN_CREDENTIAL: 'Unknown Credential',
    APPROVAL_POLICY_DOWNGRADED: 'Approval Policy Downgrade',
  };
  
  return labels[code] || code.replace(/_/g, ' ');
}

/**
 * Get color theme based on failure code.
 */
function getFailureTheme(code: string): 'danger' | 'warning' | 'error' {
  switch (code) {
    case 'LEAST_PRIVILEGE_VIOLATION':
      return 'danger';
    case 'SECRET_VALUE_PRESENT':
      return 'warning';
    case 'DUPLICATE_TEMPLATE_ID':
    case 'VERSION_CONFLICT':
      return 'error';
    default:
      return 'error';
  }
}

/**
 * RejectionView - Display detailed rejection information.
 */
export function RejectionView({ templateId, version, failureReasons }: RejectionViewProps) {
  const categories = categorizeFailures(failureReasons);
  
  return (
    <div className="rejection-view">
      <h3>Template Rejected</h3>
      <p className="template-identifier">
        <strong>{templateId}</strong>@{version}
      </p>
      
      <div className="failure-summary">
        <span className="badge badge-error">{failureReasons.length} failure(s)</span>
      </div>
      
      {Object.entries(categories).map(([code, failures]) => (
        <FailureCategory
          key={code}
          code={code}
          failures={failures}
          theme={getFailureTheme(code)}
        />
      ))}
    </div>
  );
}

interface FailureCategoryProps {
  code: string;
  failures: FailureReason[];
  theme: 'danger' | 'warning' | 'error';
}

/**
 * FailureCategory - Display grouped failures by type.
 */
function FailureCategory({ code, failures, theme }: FailureCategoryProps) {
  const icon = getThemeIcon(theme);
  
  return (
    <div className={`failure-category category-${theme}`}>
      <div className="category-header">
        {icon}
        <h4>{formatCodeLabel(code)}</h4>
        <span className="count">{failures.length}</span>
      </div>
      
      <ul className="failure-list">
        {failures.map((failure, index) => (
          <li key={index} className="failure-item">
            {failure.field && <span className="field">{failure.field}</span>}
            {failure.detail && <span className="detail">{failure.detail}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Get icon based on theme.
 */
function getThemeIcon(theme: 'danger' | 'warning' | 'error'): React.ReactNode {
  const icons: Record<string, React.ReactNode> = {
    danger: <svg className="icon icon-danger" viewBox="0 0 24 24"><path d="M12 2L1 21h22L12 2zm0 3.5l8.5 15H3.5L12 5.5z"/></svg>,
    warning: <svg className="icon icon-warning" viewBox="0 0 24 24"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>,
    error: <svg className="icon icon-error" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>,
  };
  
  return icons[theme] || icons.error;
}

export default RejectionView;
