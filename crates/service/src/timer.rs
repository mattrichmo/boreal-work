use std::collections::BTreeMap;
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum TimerError {
    EmptyKey,
    ControlCharacter,
}

/// A process-local deadline registry for an application-owned durable reaper.
/// The application persists the lifecycle result; this registry only wakes
/// the service and guarantees that a deadline is delivered once per schedule.
#[derive(Clone, Debug, Default)]
pub struct TimerRegistry {
    state: Arc<(Mutex<BTreeMap<String, Instant>>, Condvar)>,
}

impl TimerRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn schedule(&self, key: impl Into<String>, deadline: Instant) -> Result<(), TimerError> {
        let key = key.into();
        validate_key(&key)?;
        let (lock, wake) = &*self.state;
        lock.lock()
            .expect("timer registry mutex poisoned")
            .insert(key, deadline);
        wake.notify_all();
        Ok(())
    }

    pub fn cancel(&self, key: &str) -> bool {
        let (lock, wake) = &*self.state;
        let removed = lock
            .lock()
            .expect("timer registry mutex poisoned")
            .remove(key)
            .is_some();
        if removed {
            wake.notify_all();
        }
        removed
    }

    pub fn next_deadline(&self) -> Option<Instant> {
        let (lock, _) = &*self.state;
        lock.lock()
            .expect("timer registry mutex poisoned")
            .values()
            .copied()
            .min()
    }

    pub fn due(&self, now: Instant) -> Vec<String> {
        let (lock, _) = &*self.state;
        let mut timers = lock.lock().expect("timer registry mutex poisoned");
        let due = timers
            .iter()
            .filter(|(_, deadline)| **deadline <= now)
            .map(|(key, _)| key.clone())
            .collect::<Vec<_>>();
        for key in &due {
            timers.remove(key);
        }
        due
    }

    pub fn len(&self) -> usize {
        let (lock, _) = &*self.state;
        lock.lock().expect("timer registry mutex poisoned").len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    pub(crate) fn wait(&self, timeout: Duration) {
        let (lock, wake) = &*self.state;
        let guard = lock.lock().expect("timer registry mutex poisoned");
        let _ = wake
            .wait_timeout(guard, timeout)
            .expect("timer registry mutex poisoned");
    }

    pub(crate) fn wake(&self) {
        let (_, wake) = &*self.state;
        wake.notify_all();
    }
}

fn validate_key(key: &str) -> Result<(), TimerError> {
    if key.trim().is_empty() {
        Err(TimerError::EmptyKey)
    } else if key.chars().any(char::is_control) {
        Err(TimerError::ControlCharacter)
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schedule_replaces_and_due_is_exactly_once() {
        let registry = TimerRegistry::new();
        let now = Instant::now();
        registry
            .schedule("attempt-a", now + Duration::from_secs(30))
            .unwrap();
        registry.schedule("attempt-a", now).unwrap();
        assert_eq!(registry.len(), 1);
        assert_eq!(registry.due(now), vec!["attempt-a"]);
        assert!(registry.due(now).is_empty());
    }

    #[test]
    fn cancel_wakes_and_removes_one_deadline() {
        let registry = TimerRegistry::new();
        registry
            .schedule("attempt-a", Instant::now() + Duration::from_secs(30))
            .unwrap();
        assert!(registry.cancel("attempt-a"));
        assert!(!registry.cancel("attempt-a"));
        assert_eq!(registry.next_deadline(), None);
    }
}
