# ScreenFling

Capture what you see. Send it to the right coding agent. Keep working.

This branch replaces the former Electron application with a single-process Rust + egui desktop application. The rewrite is being implemented and checked on this branch; do not use an intermediate commit as a production release.

Build tools: stable Rust, a C compiler, and CMake. SDL3 is built from source and linked into the executable. Linux additionally needs X11/Wayland development libraries and PipeWire headers.

```
cargo test
cargo run --release
```

Screenshots and notes are local. No upload service, account, telemetry, JavaScript runtime, or web view is used. The original implementation remains available in Git history.
