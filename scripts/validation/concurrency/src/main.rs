use boreal_application::{
    project_status_from_store, AttemptRequest, SqliteAttemptAdapter, WorkApplication,
};
use boreal_domain::{
    AcceptanceProfile, ActorContext, ActorId, ActorRole, AttemptId, DispatchPolicy, Fence,
    HarnessId, OperationId, PersistedLifecycle, ProjectId, TimestampMs, WorkId, WorkItem, WorkKind,
};
use boreal_store::{SqliteStore, SCHEMA_VERSION, STATUS_CONTRACT_VERSION};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Barrier};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const PROBE_VERSION: &str = "p5-concurrency-probe/0.1";
const PROJECT_ID: &str = "p5-concurrency-project";
const BASE_TIME_MS: u64 = 1_000;
const LEASE_MS: u64 = 30 * 60 * 1_000;
const HARD_MS: u64 = 2 * 60 * 60 * 1_000;

const SCHEMA: &str = include_str!("../../../../project/spec/schema-v2.sql");

#[derive(Clone, Copy, Debug)]
struct Config {
    workers: usize,
    iterations: usize,
    tui: bool,
}

#[derive(Clone, Copy, Debug)]
struct Sample {
    queue_us: u128,
    hold_us: u128,
}

#[derive(Debug)]
struct WorkerResult {
    samples: Vec<Sample>,
    queue_samples: Vec<u128>,
}

#[derive(Debug)]
struct TuiResult {
    reads: usize,
    failures: usize,
    hold_us: Vec<u128>,
    last_error: Option<String>,
}

#[derive(Debug)]
struct Metrics {
    samples: Vec<Sample>,
    queue_samples: Vec<u128>,
    max_in_flight: usize,
    tui: Option<TuiResult>,
    started: Instant,
    finished: Instant,
}

fn main() {
    match run() {
        Ok(output) => println!("{output}"),
        Err(error) => {
            eprintln!("boreal-v2-concurrency-probe: {error}");
            std::process::exit(1);
        }
    }
}

fn run() -> Result<String, String> {
    let config = parse_args()?;
    if config.workers == 0 || config.iterations == 0 {
        return Err("workers and iterations must be positive".to_owned());
    }

    let db_root = fresh_db_root()?;
    let db_path = db_root.join("probe.sqlite3");
    let result = run_once(config, &db_path);
    let cleanup = fs::remove_dir_all(&db_root);
    if let Err(error) = cleanup {
        return Err(format!("failed to remove temporary database: {error}"));
    }
    result
}

fn run_once(config: Config, db_path: &Path) -> Result<String, String> {
    let seed_store = SqliteStore::open(db_path, SCHEMA).map_err(store_error)?;
    seed(&seed_store, config)?;
    drop(seed_store);

    let release = Arc::new(Barrier::new(config.workers + 1 + usize::from(config.tui)));
    let active = Arc::new(AtomicUsize::new(0));
    let max_in_flight = Arc::new(AtomicUsize::new(0));
    let stop_tui = Arc::new(AtomicBool::new(false));
    // Open connections before the release barrier. Connection/schema setup is
    // not part of the lifecycle contention measurement and opening dozens of
    // schemas simultaneously would measure setup lock contention instead.
    let mut worker_stores = Vec::with_capacity(config.workers);
    for _ in 0..config.workers {
        worker_stores.push(SqliteStore::open(db_path, SCHEMA).map_err(store_error)?);
    }
    let tui_thread = if config.tui {
        let store = SqliteStore::open(db_path, SCHEMA).map_err(store_error)?;
        let barrier = Arc::clone(&release);
        let stop = Arc::clone(&stop_tui);
        Some(thread::spawn(move || tui_worker(store, barrier, stop)))
    } else {
        None
    };

    let started = Instant::now();
    let mut handles = Vec::with_capacity(config.workers);
    for (worker, store) in worker_stores.into_iter().enumerate() {
        let barrier = Arc::clone(&release);
        let active = Arc::clone(&active);
        let max_in_flight = Arc::clone(&max_in_flight);
        handles.push(thread::spawn(move || {
            worker_run(worker, config, store, barrier, active, max_in_flight)
        }));
    }

    // All logical workers (and the optional TUI sampler) wait for this one
    // release. The process remains one OS process; workers are Rust threads.
    release.wait();

    let mut samples = Vec::new();
    let mut queue_samples = Vec::new();
    for handle in handles {
        let result = handle
            .join()
            .map_err(|_| "logical worker thread panicked".to_owned())??;
        samples.extend(result.samples);
        queue_samples.extend(result.queue_samples);
    }
    stop_tui.store(true, Ordering::Release);
    let tui = tui_thread
        .map(|handle| {
            handle
                .join()
                .map_err(|_| "TUI sampler thread panicked".to_owned())
        })
        .transpose()?;
    let finished = Instant::now();

    let metrics = Metrics {
        samples,
        queue_samples,
        max_in_flight: max_in_flight.load(Ordering::Acquire),
        tui,
        started,
        finished,
    };
    Ok(render_json(config, metrics))
}

fn seed(store: &SqliteStore, config: Config) -> Result<(), String> {
    let project = ProjectId::new(PROJECT_ID);
    let app = WorkApplication::new(store);
    app.init_project(
        &project,
        "seed-agent",
        "agent",
        "probe",
        "P5 probe seed",
        &stamp(BASE_TIME_MS),
        "p5-seed-project",
    )
    .map_err(app_error)?;
    for worker in 0..config.workers {
        store
            .ensure_actor(
                &format!("worker-{worker}"),
                "agent",
                &format!("probe-worker-{worker}"),
                &format!("P5 logical worker {worker}"),
                &stamp(BASE_TIME_MS),
            )
            .map_err(store_error)?;
    }

    let root = WorkItem {
        id: WorkId::new("p5-root"),
        project_id: project.clone(),
        kind: WorkKind::Milestone,
        parent_id: None,
        title: "P5 concurrency probe".to_owned(),
        description: "Synthetic disposable benchmark root".to_owned(),
        lifecycle: PersistedLifecycle::Open,
        priority: 0,
        dispatch_policy: DispatchPolicy::Automatic,
        hard_holds: Vec::new(),
        acceptance_profile: AcceptanceProfile::focused(),
    };
    app.create_work_as(&root, "seed-agent", &stamp(BASE_TIME_MS), "p5-seed-root")
        .map_err(app_error)?;

    let sprint = WorkItem {
        id: WorkId::new("p5-sprint"),
        project_id: project.clone(),
        kind: WorkKind::Sprint,
        parent_id: Some(WorkId::new("p5-root")),
        title: "P5 concurrency validation".to_owned(),
        description: "Synthetic disposable benchmark sprint".to_owned(),
        lifecycle: PersistedLifecycle::Open,
        priority: 0,
        dispatch_policy: DispatchPolicy::Automatic,
        hard_holds: Vec::new(),
        acceptance_profile: AcceptanceProfile::focused(),
    };
    app.create_work_as(
        &sprint,
        "seed-agent",
        &stamp(BASE_TIME_MS),
        "p5-seed-sprint",
    )
    .map_err(app_error)?;

    for worker in 0..config.workers {
        for iteration in 0..config.iterations {
            let work = WorkItem {
                id: WorkId::new(format!("p5-work-{worker}-{iteration}")),
                project_id: project.clone(),
                kind: WorkKind::Task,
                parent_id: Some(WorkId::new("p5-sprint")),
                title: format!("Synthetic lifecycle {worker}/{iteration}"),
                description: "Fresh-database benchmark item".to_owned(),
                lifecycle: PersistedLifecycle::Open,
                priority: 0,
                dispatch_policy: DispatchPolicy::Automatic,
                hard_holds: Vec::new(),
                acceptance_profile: AcceptanceProfile::focused(),
            };
            app.create_work_as(
                &work,
                "seed-agent",
                &stamp(BASE_TIME_MS),
                format!("p5-seed-work-{worker}-{iteration}"),
            )
            .map_err(app_error)?;
        }
    }
    Ok(())
}

fn worker_run(
    worker: usize,
    config: Config,
    store: SqliteStore,
    barrier: Arc<Barrier>,
    active: Arc<AtomicUsize>,
    max_in_flight: Arc<AtomicUsize>,
) -> Result<WorkerResult, String> {
    let app = WorkApplication::new(&store);
    let adapter = SqliteAttemptAdapter::new(&store);
    let harness = HarnessId::new("p5-rust-thread-harness");
    let project = ProjectId::new(PROJECT_ID);
    let actor = format!("worker-{worker}");
    let release_at = Instant::now();
    barrier.wait();

    let mut samples = Vec::with_capacity(config.iterations * 4);
    let mut queue_samples = Vec::with_capacity(config.iterations);
    for iteration in 0..config.iterations {
        let work_id = format!("p5-work-{worker}-{iteration}");
        let attempt_id = format!("p5-attempt-{worker}-{iteration}");
        let base = format!("p5-{worker}-{iteration}");
        let first = timed_mutation(&active, &max_in_flight, release_at, || {
            app.claim(
                &project,
                &work_id,
                &actor,
                harness.as_str(),
                None,
                &attempt_id,
                &format!("{base}-claim"),
                &format!("sha256:{base}-claim"),
                None,
                &stamp(BASE_TIME_MS),
                &stamp(BASE_TIME_MS + LEASE_MS),
                &stamp(BASE_TIME_MS + HARD_MS),
            )
            .map(|_| ())
            .map_err(app_error)
        })?;
        queue_samples.push(first.queue_us);
        samples.push(first);

        let deadline = AttemptRequest::new(
            project.clone(),
            WorkId::new(&work_id),
            AttemptId::new(&attempt_id),
            ActorId::new(&actor),
            Some(harness.clone()),
            None,
            Fence::new(1),
            OperationId::new(format!("{base}-accept")),
            format!("sha256:{base}-accept"),
            TimestampMs(BASE_TIME_MS + 1),
        );
        samples.push(timed_mutation(&active, &max_in_flight, release_at, || {
            app.accept(&adapter, deadline.clone())
                .map(|_| ())
                .map_err(app_error)
        })?);

        let start = AttemptRequest::new(
            project.clone(),
            WorkId::new(&work_id),
            AttemptId::new(&attempt_id),
            ActorId::new(&actor),
            Some(harness.clone()),
            None,
            Fence::new(1),
            OperationId::new(format!("{base}-start")),
            format!("sha256:{base}-start"),
            TimestampMs(BASE_TIME_MS + 2),
        );
        samples.push(timed_mutation(&active, &max_in_flight, release_at, || {
            app.start(&adapter, start.clone())
                .map(|_| ())
                .map_err(app_error)
        })?);

        let release_request = AttemptRequest::new(
            project.clone(),
            WorkId::new(&work_id),
            AttemptId::new(&attempt_id),
            ActorId::new(&actor),
            Some(harness.clone()),
            None,
            Fence::new(1),
            OperationId::new(format!("{base}-release")),
            format!("sha256:{base}-release"),
            TimestampMs(BASE_TIME_MS + 3),
        );
        samples.push(timed_mutation(&active, &max_in_flight, release_at, || {
            app.release(
                &adapter,
                boreal_application::EndAttemptRequest {
                    attempt: release_request.clone(),
                    reason: Some("probe complete".to_owned()),
                },
            )
            .map(|_| ())
            .map_err(app_error)
        })?);
    }

    Ok(WorkerResult {
        samples,
        queue_samples,
    })
}

fn tui_worker(store: SqliteStore, barrier: Arc<Barrier>, stop: Arc<AtomicBool>) -> TuiResult {
    barrier.wait();
    let mut reads = 0;
    let mut failures = 0;
    let mut hold_us = Vec::new();
    let mut last_error = None;
    while !stop.load(Ordering::Acquire) {
        let started = Instant::now();
        let result = project_status_from_store(
            &store,
            &ProjectId::new(PROJECT_ID),
            &ActorContext {
                actor_id: ActorId::new("tui-monitor"),
                role: ActorRole::Operator,
            },
            TimestampMs(BASE_TIME_MS + 4),
            1_000,
            0,
        );
        hold_us.push(started.elapsed().as_micros());
        if result.is_ok() {
            reads += 1;
        } else {
            failures += 1;
            last_error = result.err();
        }
        thread::sleep(Duration::from_millis(1));
    }
    TuiResult {
        reads,
        failures,
        hold_us,
        last_error,
    }
}

fn timed_mutation<F, T>(
    active: &AtomicUsize,
    max_in_flight: &AtomicUsize,
    release_at: Instant,
    operation: F,
) -> Result<Sample, String>
where
    F: FnMut() -> Result<T, String>,
{
    let queue_us = Instant::now()
        .saturating_duration_since(release_at)
        .as_micros();
    let in_flight = active.fetch_add(1, Ordering::AcqRel) + 1;
    update_max(max_in_flight, in_flight);
    let started = Instant::now();
    let mut operation = operation;
    let mut result = Err("mutation did not run".to_owned());
    for retry in 0..=16 {
        match operation() {
            Ok(value) => {
                result = Ok(value);
                break;
            }
            Err(error) if is_busy(&error) && retry < 16 => {
                thread::sleep(Duration::from_millis(1_u64 << retry.min(5)));
            }
            Err(error) => {
                result = Err(error);
                break;
            }
        }
    }
    let hold_us = started.elapsed().as_micros();
    active.fetch_sub(1, Ordering::AcqRel);
    result.map(|_| Sample { queue_us, hold_us })
}

fn is_busy(error: &str) -> bool {
    error.contains("database is locked") || error.contains("database table is locked")
}

fn update_max(value: &AtomicUsize, candidate: usize) {
    let mut current = value.load(Ordering::Acquire);
    while candidate > current {
        match value.compare_exchange(current, candidate, Ordering::AcqRel, Ordering::Acquire) {
            Ok(_) => break,
            Err(observed) => current = observed,
        }
    }
}

fn render_json(config: Config, metrics: Metrics) -> String {
    let elapsed_us = metrics
        .finished
        .duration_since(metrics.started)
        .as_micros()
        .max(1);
    let successful = metrics.samples.len();
    let workflow_count = config.workers * config.iterations;
    let tui_json = match metrics.tui {
        Some(tui) => format!(
            "{{\"enabled\":true,\"reads\":{},\"failures\":{},\"last_error\":{},\"p50_hold_ms\":{},\"p95_hold_ms\":{},\"max_hold_ms\":{}}}",
            tui.reads,
            tui.failures,
            json_string(tui.last_error.as_deref().unwrap_or("")),
            percentile_ms(&tui.hold_us, 50),
            percentile_ms(&tui.hold_us, 95),
            max_ms(&tui.hold_us),
        ),
        None => "{\"enabled\":false,\"reads\":0,\"failures\":0}".to_owned(),
    };
    format!(
        "{{\"probe_version\":\"{PROBE_VERSION}\",\"schema_version\":{SCHEMA_VERSION},\"status_contract_version\":\"{STATUS_CONTRACT_VERSION}\",\"logical_workers\":{},\"iterations_per_worker\":{},\"tui\":{},\"worker_model\":\"synthetic_logical_workers\",\"os_processes\":1,\"os_worker_threads\":{},\"lifecycle\":{{\"operations\":{},\"successful_operations\":{},\"workflows\":{},\"p50_queue_ms\":{},\"p95_queue_ms\":{},\"max_queue_ms\":{},\"max_in_flight_logical_workers\":{},\"p50_hold_ms\":{},\"p95_hold_ms\":{},\"max_hold_ms\":{},\"throughput_ops_per_sec\":{:.3},\"throughput_workflows_per_sec\":{:.3}}},\"duration_ms\":{:.3}}}",
        config.workers,
        config.iterations,
        tui_json,
        config.workers + usize::from(config.tui),
        successful,
        successful,
        workflow_count,
        percentile_ms(&metrics.queue_samples, 50),
        percentile_ms(&metrics.queue_samples, 95),
        max_ms(&metrics.queue_samples),
        metrics.max_in_flight,
        percentile_ms(&metrics.samples.iter().map(|sample| sample.hold_us).collect::<Vec<_>>(), 50),
        percentile_ms(&metrics.samples.iter().map(|sample| sample.hold_us).collect::<Vec<_>>(), 95),
        max_ms(&metrics.samples.iter().map(|sample| sample.hold_us).collect::<Vec<_>>()),
        successful as f64 / (elapsed_us as f64 / 1_000_000.0),
        workflow_count as f64 / (elapsed_us as f64 / 1_000_000.0),
        elapsed_us as f64 / 1_000.0,
    )
}

fn json_string(value: &str) -> String {
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}

fn percentile_ms(values_us: &[u128], percentile: usize) -> u128 {
    if values_us.is_empty() {
        return 0;
    }
    let mut sorted = values_us.to_vec();
    sorted.sort_unstable();
    let rank = ((sorted.len() - 1) * percentile).div_ceil(100);
    sorted[rank] / 1_000
}

fn max_ms(values_us: &[u128]) -> u128 {
    values_us.iter().copied().max().unwrap_or(0) / 1_000
}

fn parse_args() -> Result<Config, String> {
    let mut workers = None;
    let mut iterations = 5;
    let mut tui = false;
    let mut args = env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--workers" => workers = Some(parse_usize(&mut args, "workers")?),
            "--iterations" => iterations = parse_usize(&mut args, "iterations")?,
            "--tui" => {
                tui = match args.next().as_deref() {
                    Some("on") => true,
                    Some("off") => false,
                    _ => return Err("--tui must be on or off".to_owned()),
                }
            }
            "--help" => {
                println!(
                    "usage: boreal-v2-concurrency-probe --workers N [--iterations N] [--tui on|off]"
                );
                std::process::exit(0);
            }
            other => return Err(format!("unknown argument: {other}")),
        }
    }
    Ok(Config {
        workers: workers.ok_or_else(|| "--workers is required".to_owned())?,
        iterations,
        tui,
    })
}

fn parse_usize(args: &mut impl Iterator<Item = String>, name: &str) -> Result<usize, String> {
    args.next()
        .ok_or_else(|| format!("--{name} needs a value"))?
        .parse()
        .map_err(|_| format!("--{name} must be an integer"))
}

fn fresh_db_root() -> Result<PathBuf, String> {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_nanos();
    let root = env::temp_dir().join(format!("boreal-v2-p5-{nonce}-{}", std::process::id()));
    fs::create_dir(&root).map_err(|error| format!("cannot create temporary directory: {error}"))?;
    Ok(root)
}

fn stamp(value: u64) -> String {
    format!("unix-ms:{value}")
}

fn app_error(error: boreal_application::ApplicationError) -> String {
    error.to_string()
}

fn store_error(error: boreal_store::StoreError) -> String {
    error.to_string()
}
