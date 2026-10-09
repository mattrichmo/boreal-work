//! Structured external decisions and business-date values for project work.
//!
//! A wait is an outstanding work fact. It never supplies the decision it is
//! waiting for, and resolution never closes the associated task.

use crate::{ActorId, ProjectId, TimestampMs, WorkId};

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct CivilDate {
    pub year: u16,
    pub month: u8,
    pub day: u8,
}

impl CivilDate {
    pub fn new(year: u16, month: u8, day: u8) -> Result<Self, WaitError> {
        // Wire dates are canonical YYYY-MM-DD values. Do not admit values
        // which cannot round-trip through that fixed-width representation.
        let days = match month {
            1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
            4 | 6 | 9 | 11 => 30,
            2 if is_leap_year(year) => 29,
            2 => 28,
            _ => 0,
        };
        if year == 0 || year > 9999 || day == 0 || day > days {
            return Err(WaitError::InvalidDate);
        }
        Ok(Self { year, month, day })
    }

    pub fn parse(value: &str) -> Result<Self, WaitError> {
        let parts = value.split('-').collect::<Vec<_>>();
        if parts.len() != 3 || parts[0].len() != 4 || parts[1].len() != 2 || parts[2].len() != 2 {
            return Err(WaitError::InvalidDate);
        }
        let year = parts[0].parse().map_err(|_| WaitError::InvalidDate)?;
        let month = parts[1].parse().map_err(|_| WaitError::InvalidDate)?;
        let day = parts[2].parse().map_err(|_| WaitError::InvalidDate)?;
        Self::new(year, month, day)
    }

    pub fn as_iso_date(self) -> String {
        format!("{:04}-{:02}-{:02}", self.year, self.month, self.day)
    }
}

fn is_leap_year(year: u16) -> bool {
    year % 4 == 0 && (year % 100 != 0 || year % 400 == 0)
}

/// Date-only business intent remains a civil date in its resolved IANA zone;
/// it is not silently rewritten to a UTC midnight instant.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BusinessDate {
    pub date: CivilDate,
    pub timezone: String,
}

impl BusinessDate {
    pub fn new(date: CivilDate, timezone: impl Into<String>) -> Result<Self, WaitError> {
        let timezone = timezone.into();
        if timezone.is_empty()
            || timezone.len() > 128
            || timezone.starts_with('/')
            || timezone.contains("..")
            || timezone
                .split('/')
                .any(|part| part.is_empty() || part == "." || part == "..")
            || timezone
                .chars()
                .any(|character| !(character.is_ascii_alphanumeric() || "_+-/".contains(character)))
        {
            return Err(WaitError::InvalidTimeZone);
        }
        Ok(Self { date, timezone })
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum BusinessMoment {
    Instant(TimestampMs),
    Date(BusinessDate),
}

impl BusinessMoment {
    /// A timestamp is due at its instant. A date-only obligation becomes due
    /// on that local civil date, including midnight at the start of the day.
    pub fn is_due(&self, now: TimestampMs, local_date: CivilDate) -> bool {
        match self {
            Self::Instant(at) => now >= *at,
            Self::Date(date) => local_date >= date.date,
        }
    }

    pub fn is_overdue(&self, now: TimestampMs, local_date: CivilDate) -> bool {
        match self {
            Self::Instant(at) => now > *at,
            Self::Date(date) => local_date > date.date,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum AccountableParty {
    PersonOrRole { reference: String },
    ExternalService { reference: String },
}

impl AccountableParty {
    pub fn validate(&self) -> Result<(), WaitError> {
        let reference = match self {
            Self::PersonOrRole { reference } | Self::ExternalService { reference } => reference,
        };
        if reference.trim().is_empty()
            || reference.len() > 255
            || reference.chars().any(char::is_control)
        {
            return Err(WaitError::InvalidAccountableParty);
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ExternalWaitState {
    Open,
    Resolved,
    Cancelled,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WaitResolution {
    pub actor_id: ActorId,
    pub resolved_at: TimestampMs,
    pub result: String,
    pub rationale: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExternalWait {
    pub wait_id: String,
    pub project_id: ProjectId,
    pub work_id: WorkId,
    pub category: String,
    pub reason: String,
    pub accountable: AccountableParty,
    pub expected_decision_or_output: String,
    pub follow_up: Option<BusinessMoment>,
    pub created_by: ActorId,
    pub created_at: TimestampMs,
    pub state: ExternalWaitState,
    pub resolution: Option<WaitResolution>,
    pub cancellation: Option<(ActorId, TimestampMs, String)>,
}

impl ExternalWait {
    pub fn validate(&self) -> Result<(), WaitError> {
        for (field, value, max) in [
            ("wait_id", self.wait_id.as_str(), 255),
            ("category", self.category.as_str(), 64),
            ("reason", self.reason.as_str(), 2_000),
            (
                "expected decision/output",
                self.expected_decision_or_output.as_str(),
                2_000,
            ),
        ] {
            if value.trim().is_empty() || value.len() > max || value.chars().any(char::is_control) {
                return Err(WaitError::InvalidField(field));
            }
        }
        self.accountable.validate()?;
        match (
            self.state,
            self.resolution.is_some(),
            self.cancellation.is_some(),
        ) {
            (ExternalWaitState::Open, false, false)
            | (ExternalWaitState::Resolved, true, false)
            | (ExternalWaitState::Cancelled, false, true) => Ok(()),
            _ => Err(WaitError::InvalidState),
        }
    }

    pub fn resolve(
        &mut self,
        actor_id: ActorId,
        resolved_at: TimestampMs,
        result: impl Into<String>,
        rationale: impl Into<String>,
    ) -> Result<(), WaitError> {
        if self.state != ExternalWaitState::Open {
            return Err(WaitError::AlreadyTerminal);
        }
        let result = result.into();
        let rationale = rationale.into();
        if result.trim().is_empty()
            || result.len() > 2_000
            || result.chars().any(char::is_control)
            || rationale.trim().is_empty()
            || rationale.len() > 2_000
            || rationale.chars().any(char::is_control)
        {
            return Err(WaitError::InvalidResolution);
        }
        self.state = ExternalWaitState::Resolved;
        self.resolution = Some(WaitResolution {
            actor_id,
            resolved_at,
            result,
            rationale,
        });
        Ok(())
    }

    pub fn cancel(
        &mut self,
        actor_id: ActorId,
        cancelled_at: TimestampMs,
        reason: impl Into<String>,
    ) -> Result<(), WaitError> {
        if self.state != ExternalWaitState::Open {
            return Err(WaitError::AlreadyTerminal);
        }
        let reason = reason.into();
        if reason.trim().is_empty() || reason.len() > 2_000 || reason.chars().any(char::is_control) {
            return Err(WaitError::InvalidResolution);
        }
        self.state = ExternalWaitState::Cancelled;
        self.cancellation = Some((actor_id, cancelled_at, reason));
        Ok(())
    }

    pub fn follow_up_due(&self, now: TimestampMs, local_date: CivilDate) -> bool {
        self.state == ExternalWaitState::Open
            && self
                .follow_up
                .as_ref()
                .is_some_and(|follow_up| follow_up.is_due(now, local_date))
    }

    /// Resolving a wait only releases the wait condition; callers must still
    /// evaluate task lifecycle and dependencies independently.
    pub const fn blocks_work(&self) -> bool {
        matches!(self.state, ExternalWaitState::Open)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum WaitError {
    InvalidDate,
    InvalidTimeZone,
    InvalidAccountableParty,
    InvalidField(&'static str),
    InvalidState,
    InvalidResolution,
    AlreadyTerminal,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wait() -> ExternalWait {
        ExternalWait {
            wait_id: "wait-1".into(),
            project_id: ProjectId::new("p"),
            work_id: WorkId::new("w"),
            category: "customer-decision".into(),
            reason: "Need approval of brief".into(),
            accountable: AccountableParty::PersonOrRole {
                reference: "reviewer".into(),
            },
            expected_decision_or_output: "Approved brief revision".into(),
            follow_up: Some(BusinessMoment::Date(
                BusinessDate::new(CivilDate::parse("2026-10-09").unwrap(), "America/Regina")
                    .unwrap(),
            )),
            created_by: ActorId::new("agent"),
            created_at: TimestampMs(100),
            state: ExternalWaitState::Open,
            resolution: None,
            cancellation: None,
        }
    }

    #[test]
    fn date_only_retains_civil_day_and_timezone_and_is_due_at_local_midnight() {
        assert_eq!(
            CivilDate::parse("2024-02-29").unwrap().as_iso_date(),
            "2024-02-29"
        );
        assert!(CivilDate::parse("2025-02-29").is_err());
        assert!(CivilDate::new(10_000, 1, 1).is_err());
        let due =
            BusinessDate::new(CivilDate::parse("2026-10-09").unwrap(), "America/Regina").unwrap();
        assert_eq!(due.timezone, "America/Regina");
        assert!(BusinessMoment::Date(due)
            .is_due(TimestampMs(0), CivilDate::parse("2026-10-09").unwrap()));
        assert!(!BusinessMoment::Date(
            BusinessDate::new(CivilDate::parse("2026-10-09").unwrap(), "America/Regina").unwrap()
        )
        .is_overdue(TimestampMs(0), CivilDate::parse("2026-10-09").unwrap()));
        assert!(BusinessMoment::Date(
            BusinessDate::new(CivilDate::parse("2026-10-09").unwrap(), "America/Regina").unwrap()
        )
        .is_overdue(TimestampMs(0), CivilDate::parse("2026-10-10").unwrap()));
        assert!(!BusinessMoment::Date(
            BusinessDate::new(CivilDate::parse("2026-10-09").unwrap(), "UTC").unwrap()
        )
        .is_due(TimestampMs(0), CivilDate::parse("2026-10-08").unwrap()));
    }

    #[test]
    fn instant_midnight_and_date_only_are_distinct_and_resolutions_are_attributable() {
        let instant = BusinessMoment::Instant(TimestampMs(1_000));
        assert!(!instant.is_due(TimestampMs(999), CivilDate::parse("1970-01-01").unwrap()));
        assert!(instant.is_due(TimestampMs(1_000), CivilDate::parse("1970-01-01").unwrap()));
        assert!(!instant.is_overdue(TimestampMs(1_000), CivilDate::parse("1970-01-01").unwrap()));
        assert!(instant.is_overdue(TimestampMs(1_001), CivilDate::parse("1970-01-01").unwrap()));
        let mut value = wait();
        assert!(value.validate().is_ok());
        assert!(!value.follow_up_due(TimestampMs(99), CivilDate::parse("2026-10-08").unwrap()));
        value
            .resolve(
                ActorId::new("operator"),
                TimestampMs(200),
                "brief accepted",
                "checked final copy",
            )
            .unwrap();
        assert_eq!(value.state, ExternalWaitState::Resolved);
        assert_eq!(
            value.resolution.as_ref().unwrap().actor_id.as_str(),
            "operator"
        );
        assert!(!value.blocks_work());
        assert!(value
            .resolve(ActorId::new("operator"), TimestampMs(201), "again", "again")
            .is_err());
    }

    #[test]
    fn invalid_zones_and_conflicting_terminal_facts_are_rejected() {
        assert!(BusinessDate::new(CivilDate::parse("2026-01-01").unwrap(), "../private").is_err());
        let mut value = wait();
        value.state = ExternalWaitState::Resolved;
        assert_eq!(value.validate(), Err(WaitError::InvalidState));

        let mut value = wait();
        value
            .cancel(
                ActorId::new("operator"),
                TimestampMs(250),
                "request was withdrawn",
            )
            .unwrap();
        assert_eq!(value.state, ExternalWaitState::Cancelled);
        assert_eq!(
            value.cancellation.as_ref().map(|(actor, _, _)| actor.as_str()),
            Some("operator")
        );
        assert!(!value.blocks_work());
        assert!(value
            .cancel(
                ActorId::new("operator"),
                TimestampMs(251),
                "duplicate cancellation"
            )
            .is_err());
    }
}
