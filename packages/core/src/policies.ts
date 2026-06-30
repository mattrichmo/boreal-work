export interface RuntimePolicy {
  readonly requireEvidenceForVerification: boolean;
  readonly requirePassingVerificationForClose: boolean;
  readonly requireAgentSummaryForClose: boolean;
  readonly preventDependencyCycles: boolean;
  readonly allowReservationStealing: boolean;
  readonly maxActiveReservationsPerAgent: number;
}

export const DEFAULT_RUNTIME_POLICY: RuntimePolicy = {
  requireEvidenceForVerification: true,
  requirePassingVerificationForClose: true,
  requireAgentSummaryForClose: true,
  preventDependencyCycles: true,
  allowReservationStealing: false,
  maxActiveReservationsPerAgent: 3
};
