use chrono::{DateTime, Datelike, Duration, Utc};
use chrono_english::{parse_date_string, Dialect};

/// A resolved time window extracted from a natural language query.
pub struct TemporalWindow {
    pub start: DateTime<Utc>,
    pub end: DateTime<Utc>,
    /// The temporal phrase that was extracted (e.g. "yesterday", "last week").
    pub reference: String,
}

fn start_of_day(dt: DateTime<Utc>) -> DateTime<Utc> {
    dt.date_naive().and_hms_opt(0, 0, 0).unwrap().and_utc()
}

fn end_of_day(dt: DateTime<Utc>) -> DateTime<Utc> {
    dt.date_naive().and_hms_opt(23, 59, 59).unwrap().and_utc()
}

/// Extract a temporal window from a natural language query string.
///
/// Recognizes phrases like "yesterday", "last week", "2 days ago", "last friday", etc.
/// Uses chrono-english for point phrases and expands them to full-day windows.
/// Returns None if no temporal reference is detected.
pub fn extract_temporal_window(query: &str, _user_tz: Option<&str>) -> Option<TemporalWindow> {
    let q = query.to_lowercase();
    let now = Utc::now();

    // --- Range phrases (manual handling, checked before point phrases) ---

    if q.contains("last week") {
        let days_since_monday = now.weekday().num_days_from_monday() as i64;
        let last_monday = now - Duration::days(days_since_monday + 7);
        let last_sunday = last_monday + Duration::days(6);
        return Some(TemporalWindow {
            start: start_of_day(last_monday),
            end: end_of_day(last_sunday),
            reference: "last week".to_string(),
        });
    }

    if q.contains("this week") {
        let days_since_monday = now.weekday().num_days_from_monday() as i64;
        let this_monday = now - Duration::days(days_since_monday);
        return Some(TemporalWindow {
            start: start_of_day(this_monday),
            end: now,
            reference: "this week".to_string(),
        });
    }

    if q.contains("last month") {
        let first_of_this_month = now.date_naive().with_day(1).unwrap();
        let last_day_prev = first_of_this_month.pred_opt().unwrap();
        let first_day_prev = last_day_prev.with_day(1).unwrap();
        return Some(TemporalWindow {
            start: first_day_prev.and_hms_opt(0, 0, 0).unwrap().and_utc(),
            end: last_day_prev.and_hms_opt(23, 59, 59).unwrap().and_utc(),
            reference: "last month".to_string(),
        });
    }

    if q.contains("this month") {
        let first_of_this_month = now.date_naive().with_day(1).unwrap();
        return Some(TemporalWindow {
            start: first_of_this_month.and_hms_opt(0, 0, 0).unwrap().and_utc(),
            end: now,
            reference: "this month".to_string(),
        });
    }

    // --- Point phrases → expand to day window ---

    if q.contains("today") {
        return Some(TemporalWindow {
            start: start_of_day(now),
            end: now,
            reference: "today".to_string(),
        });
    }

    if q.contains("yesterday") {
        let yesterday = now - Duration::days(1);
        return Some(TemporalWindow {
            start: start_of_day(yesterday),
            end: end_of_day(yesterday),
            reference: "yesterday".to_string(),
        });
    }

    // --- chrono-english for weekday phrases (e.g. "last friday") ---
    let local_now = chrono::Local::now();
    let weekdays = [
        "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
    ];
    for day in &weekdays {
        let phrase = format!("last {}", day);
        if q.contains(&phrase) {
            if let Ok(dt) = parse_date_string(&phrase, local_now, Dialect::Us) {
                let dt_utc: DateTime<Utc> = dt.with_timezone(&Utc);
                return Some(TemporalWindow {
                    start: start_of_day(dt_utc),
                    end: end_of_day(dt_utc),
                    reference: phrase,
                });
            }
        }
    }

    // --- "N days ago" — simple token scan, chrono-english for parsing ---
    let words: Vec<&str> = q.split_whitespace().collect();
    for i in 0..words.len().saturating_sub(2) {
        let is_days = words
            .get(i + 1)
            .map_or(false, |w| w.starts_with("day"));
        let is_ago = words.get(i + 2).map_or(false, |w| w.starts_with("ago"));
        if is_days && is_ago {
            if let Ok(n) = words[i].parse::<i64>() {
                let phrase = format!("{} days ago", n);
                let dt_utc = parse_date_string(&phrase, local_now, Dialect::Us)
                    .ok()
                    .map(|dt| dt.with_timezone(&Utc))
                    .unwrap_or_else(|| now - Duration::days(n));
                return Some(TemporalWindow {
                    start: start_of_day(dt_utc),
                    end: end_of_day(dt_utc),
                    reference: phrase,
                });
            }
        }
    }

    // --- Explicit YYYY-MM-DD date ---
    let mut i = 0;
    while i + 10 <= q.len() {
        let slice = &q[i..i + 10];
        if slice.chars().nth(4) == Some('-') && slice.chars().nth(7) == Some('-') {
            if let Ok(d) = chrono::NaiveDate::parse_from_str(slice, "%Y-%m-%d") {
                let dt_utc = d.and_hms_opt(0, 0, 0).unwrap().and_utc();
                return Some(TemporalWindow {
                    start: dt_utc,
                    end: end_of_day(dt_utc),
                    reference: slice.to_string(),
                });
            }
        }
        i += 1;
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_yesterday() {
        let w = extract_temporal_window("what happened yesterday?", None).unwrap();
        assert_eq!(w.reference, "yesterday");
        let expected = (Utc::now() - Duration::days(1)).date_naive();
        assert_eq!(w.start.date_naive(), expected);
        assert_eq!(w.end.date_naive(), expected);
    }

    #[test]
    fn test_last_week() {
        let w = extract_temporal_window("what happened last week?", None).unwrap();
        assert_eq!(w.reference, "last week");
        // Monday to Sunday = 6 days difference
        assert_eq!((w.end - w.start).num_days(), 6);
    }

    #[test]
    fn test_no_temporal() {
        let w = extract_temporal_window("deploy the server", None);
        assert!(w.is_none());
    }

    #[test]
    fn test_n_days_ago() {
        let w = extract_temporal_window("what did we discuss 2 days ago?", None).unwrap();
        let expected = (Utc::now() - Duration::days(2)).date_naive();
        assert_eq!(w.start.date_naive(), expected);
    }
}
