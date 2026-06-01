// DisplayStatusBadge.tsx - Reusable status badge component for all ACP states

import React from 'react'
import { DisplayStatus, getStatusLabel, getStatusColorClass, getStatusIcon } from '../../lib/displayStatus'

interface DisplayStatusBadgeProps {
  status: DisplayStatus
  showLabel?: boolean
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

export function DisplayStatusBadge({
  status,
  showLabel = true,
  size = 'md',
  className = '',
}: DisplayStatusBadgeProps): React.ReactNode {
  const label = getStatusLabel(status)
  const colorClass = getStatusColorClass(status)
  const icon = getStatusIcon(status)

  // Size classes
  const sizeClasses: Record<string, string> = {
    sm: 'px-2 py-0.5 text-xs',
    md: 'px-2.5 py-1 text-sm',
    lg: 'px-3 py-1.5 text-base',
  }

  const currentSizeClass = sizeClasses[size] || sizeClasses.md

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-medium ${colorClass} ${currentSizeClass} ${className}`}
      role="status"
      aria-label={label}
    >
      <StatusIcon icon={icon} size={size} />
      {showLabel && <span>{label}</span>}
    </span>
  )
}

interface StatusIconProps {
  icon: string
  size: 'sm' | 'md' | 'lg'
}

function StatusIcon({ icon, size }: StatusIconProps): React.ReactNode {
  // Map lucide-react icon names to simple SVG paths for this component
  const iconPaths: Record<string, string> = {
    'circle-alert': 'M12 9v2m0 4h.01M-5 3a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V5a2 2 0 00-2-2H-5z',
    'loader': 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15',
    'play': 'M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
    'check-circle': 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
    'x-circle': 'M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z',
    'ban': 'M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636',
    'clock': 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
    'shield-alert': 'M12 9v2m0 4h.01M12 3a9 9 0 100 18 9 9 0 000-18z M12 8v4m0 4h.01',
    'check-check': 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z M9 12l2 2 4-4',
    'eye-off': 'M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21',
  }

  const path = iconPaths[icon] || iconPaths['circle-alert']

  // Size adjustments
  const sizeAdjustments: Record<string, string> = {
    sm: 'w-3 h-3',
    md: 'w-4 h-4',
    lg: 'w-5 h-5',
  }

  const currentSizeAdjustment = sizeAdjustments[size] || sizeAdjustments.md

  return (
    <svg
      className={currentSizeAdjustment}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={path} />
    </svg>
  )
}

export default DisplayStatusBadge
