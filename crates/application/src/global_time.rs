//! Application-owned civil-time policy for installation-wide management.
//!
//! Timezone policy is observed for every read. It is never written to the
//! Global store, so a host timezone change takes effect on the next refresh.

use crate::sha256_content_digest;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_TZIF_BYTES: usize = 4 * 1024 * 1024;

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct GlobalCivilTimeContext {
    pub observed_at_unix_ms: u64,
    pub timezone: String,
    pub system_civil_date: String,
    pub tzdb_identity: String,
    #[serde(skip_serializing)]
    zone: TzifZone,
}

impl GlobalCivilTimeContext {
    /// Resolve the current instant against the system's configured timezone.
    pub fn system() -> Result<Self, GlobalTimeError> {
        let observed_at_unix_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| GlobalTimeError("system clock is before the Unix epoch".into()))?
            .as_millis()
            .try_into()
            .map_err(|_| GlobalTimeError("system clock exceeds the supported range".into()))?;
        let (timezone, bytes) = system_zone_file()?;
        Self::from_tzif(observed_at_unix_ms, timezone, &bytes)
    }

    /// Injectable constructor for deterministic callers and focused checks.
    pub fn from_tzif(
        observed_at_unix_ms: u64,
        timezone: impl Into<String>,
        bytes: &[u8],
    ) -> Result<Self, GlobalTimeError> {
        let timezone = timezone.into();
        if timezone.trim().is_empty() {
            return Err(GlobalTimeError("system timezone identity is empty".into()));
        }
        let zone = TzifZone::parse(bytes)?;
        let observed_seconds = i64::try_from(observed_at_unix_ms / 1_000)
            .map_err(|_| GlobalTimeError("observed instant exceeds the supported range".into()))?;
        let offset = zone.offset_at(observed_seconds).ok_or_else(|| {
            GlobalTimeError(
                "TZif data does not define local time after its final transition".into(),
            )
        })?;
        let local_seconds = observed_seconds
            .checked_add(i64::from(offset))
            .ok_or_else(|| GlobalTimeError("local system time overflow".into()))?;
        Ok(Self {
            observed_at_unix_ms,
            timezone,
            system_civil_date: format_civil_date(local_seconds.div_euclid(86_400)),
            tzdb_identity: sha256_content_digest(bytes),
            zone,
        })
    }

    /// Return a due date's civil day. Date-only values remain unchanged;
    /// timestamp values are converted from their explicit offset to the
    /// currently selected system timezone.
    pub fn civil_day_for(&self, value: &str) -> Option<String> {
        if value.len() == 10 {
            let date = parse_date(value)?;
            return Some(format_civil_date(days_from_civil(date.0, date.1, date.2)));
        }
        let utc_seconds = parse_rfc3339_seconds(value)?;
        let offset = self.zone.offset_at(utc_seconds)?;
        let local_seconds = utc_seconds.checked_add(i64::from(offset))?;
        Some(format_civil_date(local_seconds.div_euclid(86_400)))
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GlobalTimeError(pub String);

impl std::fmt::Display for GlobalTimeError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for GlobalTimeError {}

fn system_zone_file() -> Result<(String, Vec<u8>), GlobalTimeError> {
    if let Some(configured) = std::env::var_os("TZ") {
        let value = configured
            .to_str()
            .ok_or_else(|| GlobalTimeError("TZ is not valid UTF-8".into()))?;
        let value = value.strip_prefix(':').unwrap_or(value);
        if value.is_empty() {
            return Err(GlobalTimeError("TZ is empty".into()));
        }
        let path = Path::new(value);
        if path.is_absolute() {
            let canonical = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
            let identity =
                zone_name_from_path(&canonical).unwrap_or_else(|| "custom-tzif".to_owned());
            return read_zone_path(&canonical, identity);
        }
        return read_named_zone(value);
    }

    for path in [
        Path::new("/etc/localtime"),
        Path::new("/var/db/timezone/localtime"),
    ] {
        if !path.exists() {
            continue;
        }
        let canonical = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
        if let Some(name) = zone_name_from_path(&canonical) {
            if let Ok(zone) = read_named_zone(&name) {
                return Ok(zone);
            }
        }
        return read_zone_path(&canonical, "system-localtime".into());
    }

    if let Ok(value) = std::fs::read_to_string("/etc/timezone") {
        let name = value.trim();
        if !name.is_empty() {
            return read_named_zone(name);
        }
    }
    Err(GlobalTimeError(
        "the system timezone could not be resolved from TZ, localtime, or /etc/timezone".into(),
    ))
}

fn read_named_zone(name: &str) -> Result<(String, Vec<u8>), GlobalTimeError> {
    if name.starts_with('/') || name.split('/').any(|part| part == "..") {
        return Err(GlobalTimeError("invalid IANA timezone name".into()));
    }
    for root in zone_roots() {
        let path = root.join(name);
        if path.is_file() {
            return read_zone_path(&path, name.to_owned());
        }
    }
    Err(GlobalTimeError(format!(
        "IANA timezone {name:?} is not present in the system timezone database"
    )))
}

fn read_zone_path(path: &Path, name: String) -> Result<(String, Vec<u8>), GlobalTimeError> {
    let metadata = std::fs::metadata(path).map_err(|error| {
        GlobalTimeError(format!(
            "cannot inspect system timezone file {}: {error}",
            path.display()
        ))
    })?;
    if metadata.len() > MAX_TZIF_BYTES as u64 {
        return Err(GlobalTimeError(
            "system timezone file exceeds the size limit".into(),
        ));
    }
    let bytes = std::fs::read(path).map_err(|error| {
        GlobalTimeError(format!(
            "cannot read system timezone file {}: {error}",
            path.display()
        ))
    })?;
    if bytes.len() > MAX_TZIF_BYTES {
        return Err(GlobalTimeError(
            "system timezone file exceeds the size limit".into(),
        ));
    }
    Ok((name, bytes))
}

fn zone_roots() -> [PathBuf; 5] {
    [
        PathBuf::from("/usr/share/zoneinfo"),
        PathBuf::from("/usr/share/zoneinfo.default"),
        PathBuf::from("/usr/share/lib/zoneinfo"),
        PathBuf::from("/var/db/timezone/zoneinfo"),
        PathBuf::from("/usr/lib/zoneinfo"),
    ]
}

fn zone_name_from_path(path: &Path) -> Option<String> {
    for root in zone_roots() {
        let canonical_root = std::fs::canonicalize(&root).unwrap_or(root);
        if let Ok(relative) = path.strip_prefix(canonical_root) {
            let name = relative.to_str()?.replace(std::path::MAIN_SEPARATOR, "/");
            if !name.is_empty() {
                return Some(name);
            }
        }
    }
    None
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct TzifZone {
    transitions: Vec<(i64, i32)>,
    initial_offset: i32,
    future_rule: Option<PosixTimeZone>,
}

impl TzifZone {
    fn parse(bytes: &[u8]) -> Result<Self, GlobalTimeError> {
        if bytes.len() < 44 || &bytes[..4] != b"TZif" {
            return Err(GlobalTimeError(
                "system timezone file is not TZif data".into(),
            ));
        }
        if bytes.len() > MAX_TZIF_BYTES {
            return Err(GlobalTimeError(
                "system timezone file exceeds the size limit".into(),
            ));
        }
        let version = bytes[4];
        if !matches!(version, 0 | b'2' | b'3' | b'4') {
            return Err(GlobalTimeError("unsupported TZif version".into()));
        }
        let first = parse_tzif_block(bytes, 0, 4)?;
        let (block, future_rule) = if matches!(version, b'2' | b'3' | b'4') {
            if bytes.get(first.end + 4) != Some(&version) {
                return Err(GlobalTimeError(
                    "TZif extended block version does not match its header".into(),
                ));
            }
            let block = parse_tzif_block(bytes, first.end, 8)?;
            let footer = parse_tzif_footer(bytes, block.end)?;
            let rule = if footer.is_empty() {
                None
            } else {
                Some(PosixTimeZone::parse(footer, version >= b'3')?)
            };
            (block, rule)
        } else {
            (first, None)
        };
        if block.offsets.is_empty() {
            return Err(GlobalTimeError(
                "system timezone has no local-time types".into(),
            ));
        }
        if block.leap_count != 0 {
            return Err(GlobalTimeError(
                "system timezone uses leap-second timestamps that this reader cannot resolve".into(),
            ));
        }
        if block
            .transition_times
            .windows(2)
            .any(|pair| pair[0] >= pair[1])
        {
            return Err(GlobalTimeError(
                "TZif transitions are not strictly increasing".into(),
            ));
        }
        let transitions = block
            .transition_times
            .iter()
            .zip(&block.transition_types)
            .map(|(at, index)| {
                block
                    .offsets
                    .get(*index as usize)
                    .copied()
                    .map(|offset| (*at, offset))
                    .ok_or_else(|| GlobalTimeError("TZif transition type is out of range".into()))
            })
            .collect::<Result<Vec<_>, _>>()?;
        if let (Some(rule), Some((last_at, last_offset))) =
            (future_rule.as_ref(), transitions.last())
        {
            if rule.offset_at(*last_at) != *last_offset {
                return Err(GlobalTimeError(
                    "TZif POSIX footer disagrees with the final explicit transition".into(),
                ));
            }
        }
        Ok(Self {
            transitions,
            initial_offset: block.offsets[0],
            future_rule,
        })
    }

    fn offset_at(&self, instant: i64) -> Option<i32> {
        if self.transitions.is_empty() {
            return Some(
                self.future_rule
                    .as_ref()
                    .map_or(self.initial_offset, |rule| rule.offset_at(instant)),
            );
        }
        let last_transition = self.transitions.last()?.0;
        if instant > last_transition {
            return self
                .future_rule
                .as_ref()
                .map(|rule| rule.offset_at(instant));
        }
        Some(
            self.transitions
                .iter()
                .rev()
                .find(|(at, _)| *at <= instant)
                .map(|(_, offset)| *offset)
                .unwrap_or(self.initial_offset),
        )
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct PosixTimeZone {
    standard_offset: i32,
    daylight_offset: Option<i32>,
    start: Option<PosixTransitionRule>,
    end: Option<PosixTransitionRule>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum PosixTransitionDay {
    JulianNoLeap(u16),
    Julian(u16),
    MonthWeekday { month: u8, week: u8, weekday: u8 },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct PosixTransitionRule {
    day: PosixTransitionDay,
    transition_seconds: i32,
}

impl PosixTimeZone {
    fn parse(value: &[u8], allow_extended_transition_hours: bool) -> Result<Self, GlobalTimeError> {
        if !value.is_ascii() || value.contains(&0) {
            return Err(GlobalTimeError(
                "TZif POSIX footer must contain non-NUL ASCII".into(),
            ));
        }
        let mut parser = PosixParser {
            bytes: value,
            cursor: 0,
            allow_extended_transition_hours,
        };
        parser.name()?;
        let standard_offset = -parser.clock_value(false)?;
        if parser.is_done() {
            return Ok(Self {
                standard_offset,
                daylight_offset: None,
                start: None,
                end: None,
            });
        }

        parser.name()?;
        let daylight_offset = if parser.peek() == Some(b',') {
            standard_offset
                .checked_add(3_600)
                .ok_or_else(|| GlobalTimeError("POSIX daylight offset overflow".into()))?
        } else {
            -parser.clock_value(false)?
        };
        if !(-86_400..=86_400).contains(&standard_offset)
            || !(-86_400..=86_400).contains(&daylight_offset)
        {
            return Err(GlobalTimeError(
                "TZif POSIX offset is outside the supported range".into(),
            ));
        }
        parser.expect(b',')?;
        let start = parser.transition_rule()?;
        parser.expect(b',')?;
        let end = parser.transition_rule()?;
        if !parser.is_done() {
            return Err(GlobalTimeError(
                "unexpected data in TZif POSIX footer".into(),
            ));
        }
        Ok(Self {
            standard_offset,
            daylight_offset: Some(daylight_offset),
            start: Some(start),
            end: Some(end),
        })
    }

    fn offset_at(&self, instant: i64) -> i32 {
        let (Some(daylight_offset), Some(start), Some(end)) =
            (self.daylight_offset, self.start, self.end)
        else {
            return self.standard_offset;
        };
        // RFC 9636 section 3.3.1 defines this case as all-year daylight time.
        if daylight_offset < self.standard_offset {
            return daylight_offset;
        }

        let utc_day = instant.div_euclid(86_400);
        let year = civil_from_days(utc_day).0;
        let mut transitions = Vec::with_capacity(10);
        for candidate_year in year.saturating_sub(2)..=year.saturating_add(2) {
            if let Some(at) = start.at_utc(candidate_year, self.standard_offset) {
                transitions.push((at, daylight_offset));
            }
            if let Some(at) = end.at_utc(candidate_year, daylight_offset) {
                transitions.push((at, self.standard_offset));
            }
        }
        transitions.sort_unstable_by_key(|(at, _)| *at);
        transitions
            .iter()
            .rev()
            .find(|(at, _)| *at <= instant)
            .map(|(_, offset)| *offset)
            .unwrap_or(self.standard_offset)
    }
}

impl PosixTransitionRule {
    fn at_utc(self, year: i64, offset_before: i32) -> Option<i64> {
        let day = match self.day {
            PosixTransitionDay::JulianNoLeap(day) => {
                let leap_adjustment = i64::from(is_leap_year(year) && day >= 60);
                days_from_civil(year, 1, 1).checked_add(i64::from(day) - 1 + leap_adjustment)?
            }
            PosixTransitionDay::Julian(day) => {
                days_from_civil(year, 1, 1).checked_add(i64::from(day))?
            }
            PosixTransitionDay::MonthWeekday {
                month,
                week,
                weekday,
            } => {
                let first_day = days_from_civil(year, month, 1);
                let first_weekday = (first_day + 4).rem_euclid(7) as u8;
                let month_day = if week == 5 {
                    let last = days_in_month(year, month)?;
                    let last_day = days_from_civil(year, month, last);
                    let last_weekday = (last_day + 4).rem_euclid(7) as u8;
                    last - (last_weekday + 7 - weekday) % 7
                } else {
                    1 + (weekday + 7 - first_weekday) % 7 + (week - 1) * 7
                };
                days_from_civil(year, month, month_day)
            }
        };
        let local = day
            .checked_mul(86_400)?
            .checked_add(i64::from(self.transition_seconds))?;
        local.checked_sub(i64::from(offset_before))
    }
}

struct PosixParser<'a> {
    bytes: &'a [u8],
    cursor: usize,
    allow_extended_transition_hours: bool,
}

impl PosixParser<'_> {
    fn peek(&self) -> Option<u8> {
        self.bytes.get(self.cursor).copied()
    }

    fn is_done(&self) -> bool {
        self.cursor == self.bytes.len()
    }

    fn expect(&mut self, expected: u8) -> Result<(), GlobalTimeError> {
        if self.peek() != Some(expected) {
            return Err(GlobalTimeError(
                "invalid TZif POSIX footer syntax".into(),
            ));
        }
        self.cursor += 1;
        Ok(())
    }

    fn name(&mut self) -> Result<(), GlobalTimeError> {
        let start;
        let end;
        if self.peek() == Some(b'<') {
            self.cursor += 1;
            start = self.cursor;
            while self.peek().is_some_and(|byte| byte != b'>') {
                let byte = self.peek().unwrap();
                if !byte.is_ascii_graphic() || byte == b',' || byte == b'<' {
                    return Err(GlobalTimeError(
                        "invalid quoted name in TZif POSIX footer".into(),
                    ));
                }
                self.cursor += 1;
            }
            end = self.cursor;
            self.expect(b'>')?;
        } else {
            start = self.cursor;
            while self.peek().is_some_and(|byte| byte.is_ascii_alphabetic()) {
                self.cursor += 1;
            }
            end = self.cursor;
        }
        if end.saturating_sub(start) < 3 {
            return Err(GlobalTimeError(
                "TZif POSIX timezone names must have at least three characters".into(),
            ));
        }
        Ok(())
    }

    /// Parse a POSIX offset or transition clock as signed seconds. POSIX
    /// offsets use west-positive syntax; transition clocks are interpreted
    /// relative to the wall-clock basis supplied by the caller.
    fn clock_value(&mut self, transition: bool) -> Result<i32, GlobalTimeError> {
        let (sign, explicit_sign) = match self.peek() {
            Some(b'+') => {
                self.cursor += 1;
                (1_i32, true)
            }
            Some(b'-') => {
                self.cursor += 1;
                (-1_i32, true)
            }
            _ => (1_i32, false),
        };
        let hours = self.number(3)?;
        let maximum = if transition && self.allow_extended_transition_hours {
            167
        } else {
            24
        };
        if hours > maximum {
            return Err(GlobalTimeError(
                "TZif POSIX clock hour is outside the supported range".into(),
            ));
        }
        let minutes = if self.peek() == Some(b':') {
            self.cursor += 1;
            self.number(2)?
        } else {
            0
        };
        let seconds = if self.peek() == Some(b':') {
            self.cursor += 1;
            self.number(2)?
        } else {
            0
        };
        if minutes > 59
            || seconds > 59
            || (!transition || !self.allow_extended_transition_hours)
                && hours == 24
                && (minutes != 0 || seconds != 0)
            || (transition && !self.allow_extended_transition_hours && explicit_sign)
        {
            return Err(GlobalTimeError(
                "invalid TZif POSIX clock value".into(),
            ));
        }
        let magnitude = hours * 3_600 + minutes * 60 + seconds;
        i32::try_from(magnitude * sign)
            .map_err(|_| GlobalTimeError("TZif POSIX clock value overflow".into()))
    }

    fn number(&mut self, max_digits: usize) -> Result<i32, GlobalTimeError> {
        let start = self.cursor;
        let mut value = 0_i32;
        while self.cursor - start < max_digits {
            let Some(byte) = self.peek() else { break };
            if !byte.is_ascii_digit() {
                break;
            }
            value = value
                .checked_mul(10)
                .and_then(|current| current.checked_add(i32::from(byte - b'0')))
                .ok_or_else(|| GlobalTimeError("TZif POSIX number overflow".into()))?;
            self.cursor += 1;
        }
        if self.cursor == start {
            return Err(GlobalTimeError(
                "expected a number in TZif POSIX footer".into(),
            ));
        }
        Ok(value)
    }

    fn transition_rule(&mut self) -> Result<PosixTransitionRule, GlobalTimeError> {
        let day = match self.peek() {
            Some(b'J') => {
                self.cursor += 1;
                let day = self.number(3)?;
                if !(1..=365).contains(&day) {
                    return Err(GlobalTimeError("invalid Julian TZ rule day".into()));
                }
                PosixTransitionDay::JulianNoLeap(day as u16)
            }
            Some(b'M') => {
                self.cursor += 1;
                let month = self.number(2)?;
                self.expect(b'.')?;
                let week = self.number(1)?;
                self.expect(b'.')?;
                let weekday = self.number(1)?;
                if !(1..=12).contains(&month)
                    || !(1..=5).contains(&week)
                    || !(0..=6).contains(&weekday)
                {
                    return Err(GlobalTimeError("invalid month-weekday TZ rule".into()));
                }
                PosixTransitionDay::MonthWeekday {
                    month: month as u8,
                    week: week as u8,
                    weekday: weekday as u8,
                }
            }
            Some(byte) if byte.is_ascii_digit() => {
                let day = self.number(3)?;
                if !(0..=365).contains(&day) {
                    return Err(GlobalTimeError("invalid Julian TZ rule day".into()));
                }
                PosixTransitionDay::Julian(day as u16)
            }
            _ => return Err(GlobalTimeError("invalid TZif POSIX transition rule".into())),
        };
        let transition_seconds = if self.peek() == Some(b'/') {
            self.cursor += 1;
            self.clock_value(true)?
        } else {
            7_200
        };
        Ok(PosixTransitionRule {
            day,
            transition_seconds,
        })
    }
}

struct TzifBlock {
    end: usize,
    transition_times: Vec<i64>,
    transition_types: Vec<u8>,
    offsets: Vec<i32>,
    leap_count: u32,
}

fn parse_tzif_footer(bytes: &[u8], start: usize) -> Result<&[u8], GlobalTimeError> {
    if bytes.get(start) != Some(&b'\n') {
        return Err(GlobalTimeError("TZif footer is missing its opening newline".into()));
    }
    let footer_start = start + 1;
    let footer_end = bytes
        .get(footer_start..)
        .and_then(|rest| rest.iter().position(|byte| *byte == b'\n'))
        .map(|offset| footer_start + offset)
        .ok_or_else(|| GlobalTimeError("TZif footer is missing its closing newline".into()))?;
    if footer_end + 1 != bytes.len() {
        return Err(GlobalTimeError("unexpected data after TZif footer".into()));
    }
    Ok(&bytes[footer_start..footer_end])
}

fn parse_tzif_block(
    bytes: &[u8],
    start: usize,
    time_size: usize,
) -> Result<TzifBlock, GlobalTimeError> {
    if bytes.len() < start.saturating_add(44) || &bytes[start..start + 4] != b"TZif" {
        return Err(GlobalTimeError("invalid TZif block".into()));
    }
    let counts = (0..6)
        .map(|index| read_u32(bytes, start + 20 + index * 4))
        .collect::<Result<Vec<_>, _>>()?;
    let [gmt_count, standard_count, leap_count, time_count, type_count, char_count] = [
        counts[0], counts[1], counts[2], counts[3], counts[4], counts[5],
    ];
    // Bound the count-derived allocations before allocating. System zoneinfo
    // files are small, but a malformed or replaced file must fail closed.
    if type_count == 0 || type_count > 256 || time_count as usize > MAX_TZIF_BYTES {
        return Err(GlobalTimeError(
            "TZif count is outside the supported range".into(),
        ));
    }
    let transition_bytes = (time_count as usize)
        .checked_mul(time_size)
        .and_then(|size| size.checked_add(time_count as usize))
        .ok_or_else(|| GlobalTimeError("TZif block size overflow".into()))?;
    let fixed_bytes = (type_count as usize)
        .checked_mul(6)
        .and_then(|size| size.checked_add(char_count as usize))
        .and_then(|size| {
            (leap_count as usize)
                .checked_mul(time_size + 4)
                .and_then(|leaps| size.checked_add(leaps))
        })
        .and_then(|size| size.checked_add(standard_count as usize))
        .and_then(|size| size.checked_add(gmt_count as usize))
        .ok_or_else(|| GlobalTimeError("TZif block size overflow".into()))?;
    let end = start
        .checked_add(44)
        .and_then(|size| size.checked_add(transition_bytes))
        .and_then(|size| size.checked_add(fixed_bytes))
        .ok_or_else(|| GlobalTimeError("TZif block size overflow".into()))?;
    if end > bytes.len() || end - start > MAX_TZIF_BYTES {
        return Err(GlobalTimeError("truncated or oversized TZif data".into()));
    }
    let mut cursor = start + 44;
    let mut transition_times = Vec::with_capacity(time_count as usize);
    for _ in 0..time_count {
        let value = if time_size == 8 {
            read_i64(bytes, cursor)?
        } else {
            i64::from(read_i32(bytes, cursor)?)
        };
        transition_times.push(value);
        cursor += time_size;
    }
    let transition_types = bytes
        .get(cursor..cursor + time_count as usize)
        .ok_or_else(|| GlobalTimeError("truncated TZif transition index table".into()))?
        .to_vec();
    cursor += time_count as usize;
    let mut offsets = Vec::with_capacity(type_count as usize);
    for _ in 0..type_count {
        offsets.push(read_i32(bytes, cursor)?);
        cursor += 6;
    }
    cursor = cursor
        .checked_add(char_count as usize)
        .and_then(|value| value.checked_add(leap_count as usize * (time_size + 4)))
        .and_then(|value| value.checked_add(standard_count as usize))
        .and_then(|value| value.checked_add(gmt_count as usize))
        .ok_or_else(|| GlobalTimeError("TZif block size overflow".into()))?;
    if cursor > bytes.len() {
        return Err(GlobalTimeError("truncated TZif data".into()));
    }
    Ok(TzifBlock {
        end: cursor,
        transition_times,
        transition_types,
        offsets,
        leap_count,
    })
}

fn read_u32(bytes: &[u8], offset: usize) -> Result<u32, GlobalTimeError> {
    let value = bytes
        .get(offset..offset.saturating_add(4))
        .ok_or_else(|| GlobalTimeError("truncated TZif integer".into()))?;
    Ok(u32::from_be_bytes(value.try_into().unwrap()))
}

fn read_i32(bytes: &[u8], offset: usize) -> Result<i32, GlobalTimeError> {
    Ok(read_u32(bytes, offset)? as i32)
}

fn read_i64(bytes: &[u8], offset: usize) -> Result<i64, GlobalTimeError> {
    let value = bytes
        .get(offset..offset.saturating_add(8))
        .ok_or_else(|| GlobalTimeError("truncated TZif integer".into()))?;
    Ok(i64::from_be_bytes(value.try_into().unwrap()))
}

fn parse_rfc3339_seconds(value: &str) -> Option<i64> {
    let bytes = value.as_bytes();
    if bytes.len() < 20
        || bytes
            .get(10)
            .is_none_or(|value| !matches!(value, b'T' | b't'))
    {
        return None;
    }
    // `value` is user data. A byte index can land inside a multibyte UTF-8
    // character, so use a checked slice instead of panicking on malformed
    // timestamps.
    let date = value.get(..10)?;
    let (year, month, day) = parse_date(date)?;
    let hour = parse_two(bytes, 11)?;
    let minute = parse_two(bytes, 14)?;
    let second = parse_two(bytes, 17)?;
    if bytes.get(13) != Some(&b':')
        || bytes.get(16) != Some(&b':')
        || hour > 23
        || minute > 59
        || second > 60
    {
        return None;
    }
    let mut suffix = 19;
    if bytes.get(suffix) == Some(&b'.') {
        suffix += 1;
        let start = suffix;
        while bytes.get(suffix).is_some_and(u8::is_ascii_digit) {
            suffix += 1;
        }
        if suffix == start {
            return None;
        }
    }
    let offset_seconds = match bytes.get(suffix).copied()? {
        b'Z' | b'z' if suffix + 1 == bytes.len() => 0,
        sign @ (b'+' | b'-') if suffix + 6 == bytes.len() && bytes[suffix + 3] == b':' => {
            let offset_hour = parse_two(bytes, suffix + 1)?;
            let offset_minute = parse_two(bytes, suffix + 4)?;
            if offset_hour > 23 || offset_minute > 59 {
                return None;
            }
            let magnitude = i64::from(offset_hour) * 3600 + i64::from(offset_minute) * 60;
            if sign == b'+' {
                magnitude
            } else {
                -magnitude
            }
        }
        _ => return None,
    };
    let local = days_from_civil(year, month, day)
        .checked_mul(86_400)?
        .checked_add(i64::from(hour) * 3600 + i64::from(minute) * 60 + i64::from(second))?;
    local.checked_sub(offset_seconds)
}

fn parse_date(value: &str) -> Option<(i64, u8, u8)> {
    let bytes = value.as_bytes();
    if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-' {
        return None;
    }
    let year = value.get(0..4)?.parse::<i64>().ok()?;
    let month = value.get(5..7)?.parse::<u8>().ok()?;
    let day = value.get(8..10)?.parse::<u8>().ok()?;
    let month_days = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) => 29,
        2 => 28,
        _ => return None,
    };
    (day >= 1 && day <= month_days).then_some((year, month, day))
}

fn is_leap_year(year: i64) -> bool {
    year % 4 == 0 && (year % 100 != 0 || year % 400 == 0)
}

fn days_in_month(year: i64, month: u8) -> Option<u8> {
    Some(match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if is_leap_year(year) => 29,
        2 => 28,
        _ => return None,
    })
}

fn parse_two(bytes: &[u8], start: usize) -> Option<u8> {
    let tens = bytes.get(start)?.checked_sub(b'0')?;
    let ones = bytes.get(start + 1)?.checked_sub(b'0')?;
    if tens > 9 || ones > 9 {
        return None;
    }
    Some(tens * 10 + ones)
}

fn days_from_civil(year: i64, month: u8, day: u8) -> i64 {
    let year = year - i64::from(month <= 2);
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let year_of_era = year - era * 400;
    let month = i64::from(month);
    let day_of_year = (153 * (month + if month > 2 { -3 } else { 9 }) + 2) / 5 + i64::from(day) - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

fn format_civil_date(days: i64) -> String {
    let (year, month, day) = civil_from_days(days);
    format!("{year:04}-{month:02}-{day:02}")
}

fn civil_from_days(days: i64) -> (i64, u8, u8) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let day_of_era = z - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let mut year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_prime = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_prime + 2) / 5 + 1;
    let month = month_prime + if month_prime < 10 { 3 } else { -9 };
    year += i64::from(month <= 2);
    (year, month as u8, day as u8)
}

#[cfg(test)]
mod tests {
    use super::*;

    const HOUR: i32 = 60 * 60;

    fn unix_seconds(year: i64, month: u8, day: u8, hour: u8, minute: u8, second: u8) -> i64 {
        days_from_civil(year, month, day) * 86_400
            + i64::from(hour) * 3_600
            + i64::from(minute) * 60
            + i64::from(second)
    }

    fn unix_ms(year: i64, month: u8, day: u8, hour: u8, minute: u8, second: u8) -> u64 {
        (unix_seconds(year, month, day, hour, minute, second) as u64) * 1_000
    }

    fn tzif_v1(
        transitions: &[(i64, u8)],
        offsets: &[(i32, bool, u8)],
        abbreviations: &[u8],
    ) -> Vec<u8> {
        tzif_block(0, transitions, offsets, abbreviations, 4)
    }

    fn tzif_v2(
        version: u8,
        transitions: &[(i64, u8)],
        offsets: &[(i32, bool, u8)],
        abbreviations: &[u8],
        footer: &str,
    ) -> Vec<u8> {
        let mut bytes = tzif_block(version, transitions, offsets, abbreviations, 4);
        bytes.extend_from_slice(&tzif_block(
            version,
            transitions,
            offsets,
            abbreviations,
            8,
        ));
        bytes.push(b'\n');
        bytes.extend_from_slice(footer.as_bytes());
        bytes.push(b'\n');
        bytes
    }

    fn tzif_block(
        version: u8,
        transitions: &[(i64, u8)],
        offsets: &[(i32, bool, u8)],
        abbreviations: &[u8],
        time_size: usize,
    ) -> Vec<u8> {
        let mut bytes = b"TZif".to_vec();
        bytes.push(version);
        bytes.extend_from_slice(&[0; 15]);
        for count in [
            0_u32,
            0,
            0,
            transitions.len() as u32,
            offsets.len() as u32,
            abbreviations.len() as u32,
        ] {
            bytes.extend_from_slice(&count.to_be_bytes());
        }
        for (at, _) in transitions {
            if time_size == 8 {
                bytes.extend_from_slice(&at.to_be_bytes());
            } else {
                bytes.extend_from_slice(
                    &i32::try_from(*at)
                        .expect("test transition fits a TZif v1 timestamp")
                        .to_be_bytes(),
                );
            }
        }
        for (_, type_index) in transitions {
            bytes.push(*type_index);
        }
        for (offset, is_dst, abbreviation_index) in offsets {
            bytes.extend_from_slice(&offset.to_be_bytes());
            bytes.push(u8::from(*is_dst));
            bytes.push(*abbreviation_index);
        }
        bytes.extend_from_slice(abbreviations);
        bytes
    }

    fn new_york_tzif_v2() -> Vec<u8> {
        tzif_v2(
            b'2',
            &[
                (unix_seconds(2024, 3, 10, 7, 0, 0), 1),
                (unix_seconds(2024, 11, 3, 6, 0, 0), 0),
            ],
            &[(-5 * HOUR, false, 0), (-4 * HOUR, true, 4)],
            b"EST\0EDT\0",
            "EST5EDT,M3.2.0/2,M11.1.0/2",
        )
    }

    fn new_york_tzif() -> Vec<u8> {
        tzif_v1(
            &[
                (unix_seconds(2024, 3, 10, 7, 0, 0), 1),
                (unix_seconds(2024, 11, 3, 6, 0, 0), 0),
            ],
            &[(-5 * HOUR, false, 0), (-4 * HOUR, true, 4)],
            b"EST\0EDT\0",
        )
    }

    #[test]
    fn injected_instant_uses_the_resolved_zone_for_local_midnight() {
        let tzif = new_york_tzif();
        let before_midnight = GlobalCivilTimeContext::from_tzif(
            unix_ms(2024, 3, 10, 4, 59, 59),
            "America/New_York",
            &tzif,
        )
        .unwrap();
        let at_midnight = GlobalCivilTimeContext::from_tzif(
            unix_ms(2024, 3, 10, 5, 0, 0),
            "America/New_York",
            &tzif,
        )
        .unwrap();

        assert_eq!(
            before_midnight.observed_at_unix_ms,
            unix_ms(2024, 3, 10, 4, 59, 59)
        );
        assert_eq!(before_midnight.system_civil_date, "2024-03-09");
        assert_eq!(at_midnight.system_civil_date, "2024-03-10");
        assert_eq!(at_midnight.timezone, "America/New_York");
        assert_eq!(at_midnight.tzdb_identity, sha256_content_digest(&tzif));
    }

    #[test]
    fn timestamp_dates_follow_dst_offsets_while_date_only_values_stay_civil() {
        let context = GlobalCivilTimeContext::from_tzif(
            unix_ms(2024, 3, 10, 7, 30, 0),
            "America/New_York",
            &new_york_tzif(),
        )
        .unwrap();

        assert_eq!(context.system_civil_date, "2024-03-10");
        assert_eq!(
            context.zone.offset_at(unix_seconds(2024, 3, 10, 6, 59, 59)),
            Some(-5 * HOUR)
        );
        assert_eq!(
            context.zone.offset_at(unix_seconds(2024, 3, 10, 7, 0, 0)),
            Some(-4 * HOUR)
        );
        assert_eq!(
            context.zone.offset_at(unix_seconds(2024, 11, 3, 5, 59, 59)),
            Some(-4 * HOUR)
        );
        assert_eq!(
            context.zone.offset_at(unix_seconds(2024, 11, 3, 6, 0, 0)),
            Some(-5 * HOUR)
        );

        assert_eq!(
            context.civil_day_for("2024-03-10"),
            Some("2024-03-10".into())
        );
        assert_eq!(
            context.civil_day_for("2024-03-10T00:30:00Z"),
            Some("2024-03-09".into())
        );
        assert_eq!(
            context.civil_day_for("2024-03-10T07:00:00Z"),
            Some("2024-03-10".into())
        );
    }

    #[test]
    fn tzif_posix_footer_supplies_future_dst_transitions() {
        let zone = TzifZone::parse(&new_york_tzif_v2()).unwrap();
        assert_eq!(
            zone.offset_at(unix_seconds(2025, 3, 9, 6, 59, 59)),
            Some(-5 * HOUR)
        );
        assert_eq!(
            zone.offset_at(unix_seconds(2025, 3, 9, 7, 0, 0)),
            Some(-4 * HOUR)
        );
        assert_eq!(
            zone.offset_at(unix_seconds(2025, 11, 2, 5, 59, 59)),
            Some(-4 * HOUR)
        );
        assert_eq!(
            zone.offset_at(unix_seconds(2025, 11, 2, 6, 0, 0)),
            Some(-5 * HOUR)
        );

        let context = GlobalCivilTimeContext::from_tzif(
            unix_ms(2025, 3, 9, 7, 0, 0),
            "America/New_York",
            &new_york_tzif_v2(),
        )
        .unwrap();
        assert_eq!(context.system_civil_date, "2025-03-09");
        assert_eq!(
            context.civil_day_for("2025-03-09T04:30:00Z"),
            Some("2025-03-08".into())
        );
    }

    #[test]
    fn tzif_footer_defines_fixed_zones_without_explicit_transitions() {
        let bytes = tzif_v2(b'2', &[], &[(3_600, false, 0)], b"XST\0", "UTC0");
        let context = GlobalCivilTimeContext::from_tzif(
            unix_ms(2024, 1, 1, 0, 30, 0),
            "Etc/UTC",
            &bytes,
        )
        .unwrap();
        assert_eq!(context.system_civil_date, "2024-01-01");
        assert_eq!(context.zone.offset_at(unix_seconds(2050, 6, 1, 0, 0, 0)), Some(0));
    }

    #[test]
    fn tzif_v3_footer_accepts_signed_transition_times() {
        let bytes = tzif_v2(
            b'3',
            &[],
            &[(0, false, 0), (HOUR, true, 4)],
            b"XST\0XDT\0",
            "XST0XDT-1,M3.2.0/-2,M11.1.0/-1",
        );
        let zone = TzifZone::parse(&bytes).unwrap();
        assert_eq!(
            zone.offset_at(unix_seconds(2025, 3, 8, 21, 59, 59)),
            Some(0)
        );
        assert_eq!(
            zone.offset_at(unix_seconds(2025, 3, 8, 22, 0, 0)),
            Some(HOUR)
        );
        assert_eq!(
            zone.offset_at(unix_seconds(2025, 11, 1, 21, 59, 59)),
            Some(HOUR)
        );
        assert_eq!(
            zone.offset_at(unix_seconds(2025, 11, 1, 22, 0, 0)),
            Some(0)
        );
    }

    #[test]
    fn missing_or_inconsistent_tzif_footer_never_freezes_a_future_offset() {
        let final_transition = unix_seconds(2024, 1, 2, 0, 0, 0);
        let empty_footer = tzif_v2(
            b'2',
            &[(final_transition, 0)],
            &[(0, false, 0)],
            b"UTC\0",
            "",
        );
        assert!(GlobalCivilTimeContext::from_tzif(
            unix_ms(2025, 1, 1, 0, 0, 0),
            "Etc/UTC",
            &empty_footer,
        )
        .is_err());
        let context = GlobalCivilTimeContext::from_tzif(
            unix_ms(2024, 1, 1, 0, 0, 0),
            "Etc/UTC",
            &empty_footer,
        )
        .unwrap();
        assert_eq!(
            context.civil_day_for("2025-01-01T00:00:00Z"),
            None
        );

        let inconsistent = tzif_v2(
            b'2',
            &[(final_transition, 1)],
            &[(0, false, 0), (HOUR, true, 4)],
            b"UTC\0DST\0",
            "UTC0",
        );
        assert!(TzifZone::parse(&inconsistent).is_err());
    }

    #[test]
    fn posix_julian_rules_skip_february_29_only_for_julian_no_leap_rules() {
        let zone = PosixTimeZone::parse(b"EST5EDT,J60/2,300/2", false).unwrap();
        let start = zone.start.unwrap().at_utc(2024, -5 * HOUR).unwrap();
        assert_eq!(start, unix_seconds(2024, 3, 1, 7, 0, 0));
        let leap_day_counted = PosixTimeZone::parse(b"EST5EDT,59/2,300/2", false).unwrap();
        let counted_start = leap_day_counted
            .start
            .unwrap()
            .at_utc(2024, -5 * HOUR)
            .unwrap();
        assert_eq!(counted_start, unix_seconds(2024, 2, 29, 7, 0, 0));
    }

    #[test]
    fn malformed_tzif_footer_and_unsorted_transitions_fail_closed() {
        let malformed_footer = tzif_v2(
            b'2',
            &[],
            &[(0, false, 0)],
            b"UTC\0",
            "EST5EDT,M3.2.0,M11.1.0,extra",
        );
        assert!(TzifZone::parse(&malformed_footer).is_err());

        let unsorted = tzif_v1(
            &[
                (unix_seconds(2024, 11, 3, 6, 0, 0), 0),
                (unix_seconds(2024, 3, 10, 7, 0, 0), 1),
            ],
            &[(-5 * HOUR, false, 0), (-4 * HOUR, true, 4)],
            b"EST\0EDT\0",
        );
        assert!(TzifZone::parse(&unsorted).is_err());
    }

    #[test]
    fn newly_resolved_zone_recomputes_the_civil_date_after_a_timezone_change() {
        let instant = unix_ms(2024, 1, 1, 0, 30, 0);
        let utc = tzif_v1(&[], &[(0, false, 0)], b"UTC\0");
        let pacific = tzif_v1(&[], &[(-8 * HOUR, false, 0)], b"PST\0");
        let first = GlobalCivilTimeContext::from_tzif(instant, "Etc/UTC", &utc).unwrap();
        let refreshed =
            GlobalCivilTimeContext::from_tzif(instant, "America/Los_Angeles", &pacific).unwrap();

        assert_eq!(first.system_civil_date, "2024-01-01");
        assert_eq!(refreshed.system_civil_date, "2023-12-31");
        assert_ne!(first.timezone, refreshed.timezone);
        assert_ne!(first.tzdb_identity, refreshed.tzdb_identity);
    }

    #[test]
    fn context_wire_shape_is_serialized_without_the_internal_zone_table() {
        let context = GlobalCivilTimeContext::from_tzif(
            unix_ms(2024, 3, 10, 7, 30, 0),
            "America/New_York",
            &new_york_tzif(),
        )
        .unwrap();
        let encoded = serde_json::to_value(&context).unwrap();

        assert_eq!(encoded["observed_at_unix_ms"], context.observed_at_unix_ms);
        assert_eq!(encoded["timezone"], "America/New_York");
        assert_eq!(encoded["system_civil_date"], "2024-03-10");
        assert_eq!(encoded["tzdb_identity"], context.tzdb_identity);
        assert!(encoded.get("zone").is_none());
    }

    #[test]
    fn malformed_timestamp_text_returns_none_without_panicking() {
        let context = GlobalCivilTimeContext::from_tzif(
            unix_ms(2024, 1, 1, 0, 0, 0),
            "Etc/UTC",
            &tzif_v1(&[], &[(0, false, 0)], b"UTC\0"),
        )
        .unwrap();

        assert_eq!(
            context.civil_day_for("2024-01-01T00:00:00Z"),
            Some("2024-01-01".into())
        );
        assert_eq!(context.civil_day_for("2024-01-0éT00:00:00Z"), None);
        assert_eq!(context.civil_day_for("2024-02-30"), None);
    }
}
