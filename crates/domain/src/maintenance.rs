//! Irreversible external-effect lifecycle. Unknown is never guessed as failure.
use crate::ActorRole;
pub fn maintenance_role_allowed(role: ActorRole) -> bool {
    role == ActorRole::Operator
}
pub fn transition_allowed(from: &str, to: &str) -> bool {
    matches!(
        (from, to),
        ("registered", "running" | "rejected" | "readback_required")
            | (
                "running",
                "committed" | "rejected" | "readback_required" | "unknown"
            )
            | ("unknown", "readback_required" | "committed" | "rejected")
            | ("readback_required", "committed" | "rejected" | "unknown")
    )
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn terminal_jobs_cannot_run_again() {
        for terminal in ["committed", "rejected"] {
            for to in ["running", "unknown", "committed", "rejected"] {
                assert!(!transition_allowed(terminal, to));
            }
        }
        assert!(transition_allowed("unknown", "committed"));
        assert!(!transition_allowed("unknown", "running"));
    }
}
