//! Read-only process detection diagnostic; no clipboard or desktop access.
fn main() -> Result<(), String> {
    let pid = std::env::args()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .ok_or("Usage: cargo run --release --example check-agents -- TERMINAL_PID")?;
    match screenfling::agents::detect(pid) {
        Some(guard) => println!(
            "{} (process {pid}); identity still current: {}",
            guard.label,
            guard.current()
        ),
        None => println!("No verified foreground agent destination in process {pid}."),
    }
    Ok(())
}
