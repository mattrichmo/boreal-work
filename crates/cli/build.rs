use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

fn main() {
    let manifest = PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").expect("manifest dir"));
    let root = manifest
        .parent()
        .and_then(Path::parent)
        .expect("workspace root");
    for path in [
        root.join("Cargo.toml"),
        root.join("Cargo.lock"),
        root.join("crates"),
        root.join("skills"),
        root.join("project/spec/workflows"),
        root.join("apps/tui/installer/wizard.cjs"),
        root.join("apps/tui/installer/wizard-body.cjs"),
    ] {
        println!("cargo:rerun-if-changed={}", path.display());
    }
    println!("cargo:rerun-if-env-changed=BOREAL_BUILD_REVISION");
    println!("cargo:rerun-if-env-changed=BOREAL_BUILD_SOURCE_ID");

    let revision = std::env::var("BOREAL_BUILD_REVISION")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| git_revision(root))
        .unwrap_or_else(|| "unknown".to_owned());
    let source_id = std::env::var("BOREAL_BUILD_SOURCE_ID")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| source_fingerprint(root))
        .unwrap_or_else(|| "unknown".to_owned());
    println!("cargo:rustc-env=BOREAL_BUILD_REVISION={revision}");
    println!("cargo:rustc-env=BOREAL_BUILD_SOURCE_ID={source_id}");
}

fn git_revision(root: &Path) -> Option<String> {
    let output = Command::new("git")
        .args(["rev-parse", "--verify", "HEAD"])
        .current_dir(root)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let revision = String::from_utf8(output.stdout).ok()?.trim().to_owned();
    (!revision.is_empty()).then_some(revision)
}

fn source_fingerprint(root: &Path) -> Option<String> {
    let mut files = Vec::new();
    collect_files(&root.join("crates"), root, &mut files).ok()?;
    collect_files(&root.join("skills"), root, &mut files).ok()?;
    collect_files(&root.join("project/spec/workflows"), root, &mut files).ok()?;
    for path in [
        "Cargo.toml",
        "Cargo.lock",
        "apps/tui/installer/wizard.cjs",
        "apps/tui/installer/wizard-body.cjs",
    ] {
        let path = root.join(path);
        if path.is_file() {
            files.push(path);
        }
    }
    files.sort();
    files.dedup();

    let mut input = Vec::new();
    for path in files {
        let relative = path.strip_prefix(root).ok()?.to_string_lossy();
        input.extend_from_slice(relative.replace('\\', "/").as_bytes());
        input.push(0);
        input.extend_from_slice(&fs::read(&path).ok()?);
        input.push(b'\n');
    }
    let digest = hash_sha256(&input)?;
    Some(format!("sha256:{digest}"))
}

fn collect_files(directory: &Path, root: &Path, output: &mut Vec<PathBuf>) -> std::io::Result<()> {
    if !directory.is_dir() {
        return Ok(());
    }
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let path = entry.path();
        let kind = entry.file_type()?;
        if kind.is_symlink() {
            continue;
        }
        if kind.is_dir() {
            collect_files(&path, root, output)?;
        } else if kind.is_file() {
            let relative = path.strip_prefix(root).unwrap_or(&path);
            if relative
                .components()
                .filter_map(|component| component.as_os_str().to_str())
                .any(|component| matches!(component, "tests" | "benches" | "examples"))
            {
                continue;
            }
            let extension = relative.extension().and_then(|value| value.to_str());
            let include = relative.file_name().and_then(|value| value.to_str())
                == Some("Cargo.toml")
                || matches!(
                    extension,
                    Some("rs" | "md" | "yaml" | "yml" | "json" | "toml")
                );
            if include {
                output.push(path);
            }
        }
    }
    Ok(())
}

fn hash_sha256(input: &[u8]) -> Option<String> {
    for (program, args) in [("sha256sum", vec!["-"]), ("shasum", vec!["-a", "256"])] {
        let mut child = match Command::new(program)
            .args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
        {
            Ok(child) => child,
            Err(_) => continue,
        };
        child.stdin.take()?.write_all(input).ok()?;
        let output = child.wait_with_output().ok()?;
        if output.status.success() {
            let value = String::from_utf8(output.stdout).ok()?;
            let digest = value.split_whitespace().next()?.to_owned();
            if digest.len() == 64 && digest.bytes().all(|byte| byte.is_ascii_hexdigit()) {
                return Some(digest.to_ascii_lowercase());
            }
        }
    }
    None
}
