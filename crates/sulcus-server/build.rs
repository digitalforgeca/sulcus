use std::process::Command;

fn main() {
    // Try SULCUS_BUILD_REF env var first (set by Docker build-arg)
    if let Ok(build_ref) = std::env::var("SULCUS_BUILD_REF") {
        if build_ref != "unknown" && !build_ref.is_empty() {
            println!("cargo:rustc-env=SULCUS_BUILD_REF={}", build_ref);
            println!("cargo:rerun-if-env-changed=SULCUS_BUILD_REF");
            return;
        }
    }

    // Fallback: try reading .build-ref file (written before docker build)
    if let Ok(contents) = std::fs::read_to_string("../../.build-ref") {
        let trimmed = contents.trim();
        if !trimmed.is_empty() {
            println!("cargo:rustc-env=SULCUS_BUILD_REF={}", trimmed);
            return;
        }
    }

    // Last resort: try git directly (works locally, not in Docker)
    if let Ok(output) = Command::new("git").args(["rev-parse", "--short", "HEAD"]).output() {
        if output.status.success() {
            let hash = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !hash.is_empty() {
                println!("cargo:rustc-env=SULCUS_BUILD_REF={}", hash);
                return;
            }
        }
    }

    println!("cargo:rustc-env=SULCUS_BUILD_REF=dev");
    println!("cargo:rerun-if-env-changed=SULCUS_BUILD_REF");
}
