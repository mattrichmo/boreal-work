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
        let local_seconds = observed_seconds
            .checked_add(i64::from(zone.offset_at(observed_seconds)))
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
        let local_seconds = utc_seconds.checked_add(i64::from(self.zone.offset_at(utc_seconds)))?;
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
}

impl TzifZone {
    fn parse(bytes: &[u8]) -> Result<Self, GlobalTimeError> {
        if bytes.len() < 44 || &bytes[..4] != b"TZif" {
            return Err(GlobalTimeError(
                "system timezone file is not TZif data".into(),
            ));
        }
        let version = bytes[4];
        let first = parse_tzif_block(bytes, 0, 4)?;
        let block = if matches!(version, b'2' | b'3' | b'4') {
            parse_tzif_block(bytes, first.end, 8)?
        } else {
            first
        };
        if block.offsets.is_empty() {
            return Err(GlobalTimeError(
                "system timezone has no local-time types".into(),
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
        Ok(Self {
            transitions,
            initial_offset: block.offsets[0],
        })
    }

    fn offset_at(&self, instant: i64) -> i32 {
        self.transitions
            .iter()
            .rev()
            .find(|(at, _)| *at <= instant)
            .map(|(_, offset)| *offset)
            .unwrap_or(self.initial_offset)
    }
}

struct TzifBlock {
    end: usize,
    transition_times: Vec<i64>,
    transition_types: Vec<u8>,
    offsets: Vec<i32>,
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
    let (year, month, day) = parse_date(&value[..10])?;
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
    format!("{year:04}-{month:02}-{day:02}")
}
