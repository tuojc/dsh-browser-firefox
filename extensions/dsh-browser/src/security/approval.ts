/** Shared panel/background contract for browser action approval. */

export type ApprovalKind = 'read' | 'action'
export type ApprovalDecision = 'deny' | 'allow-once' | 'trust-session' | 'trust-origin'

/** A policy decision awaiting a user response. */
export interface ApprovalPrompt {
  kind: ApprovalKind
  action: string
  summary: string
  origins: string[]
  /** True only when one stable origin can safely be added to the action allowlist. */
  canTrust: boolean
}

/** Correlated request delivered to every open side-panel view. */
export interface ApprovalRequest extends ApprovalPrompt {
  id: string
}

export function isApprovalDecision(value: unknown): value is ApprovalDecision {
  return value === 'deny' || value === 'allow-once' || value === 'trust-session' || value === 'trust-origin'
}
