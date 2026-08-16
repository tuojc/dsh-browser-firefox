import type { ApprovalRequest } from '../security/approval.ts'

/** Show an approval only after its owning session has finished loading. */
export function approvalReadyForSession(
  request: ApprovalRequest | undefined,
  sessionId: string | null,
  sessionChanging: boolean,
): boolean {
  if (request === undefined || sessionChanging) return false
  return request.sessionId === undefined || request.sessionId === sessionId
}

/** Identify the session the panel must load before presenting an approval. */
export function approvalSessionToFocus(
  request: ApprovalRequest | undefined,
  sessionId: string | null,
  sessionChanging: boolean,
  connected: boolean,
): string | undefined {
  if (!connected || request?.sessionId === undefined || sessionChanging || request.sessionId === sessionId) {
    return undefined
  }
  return request.sessionId
}
