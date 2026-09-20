use std::{env, path::PathBuf, process::Command};

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    if env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        // Static SDL uses Clang's availability checks. Rust's -nodefaultlibs does
        // not pull in the compiler runtime automatically, unlike a C executable.
        let output = Command::new("xcrun")
            .args(["clang", "--print-resource-dir"])
            .output()
            .expect("Install Xcode Command Line Tools to build ScreenFling on macOS");
        assert!(
            output.status.success(),
            "Could not locate the Apple Clang runtime"
        );
        let resource = String::from_utf8(output.stdout).expect("Invalid Clang resource path");
        let directory = PathBuf::from(resource.trim()).join("lib/darwin");
        assert!(
            directory.join("libclang_rt.osx.a").is_file(),
            "Apple Clang's macOS runtime is missing"
        );
        println!("cargo:rustc-link-search=native={}", directory.display());
        println!("cargo:rustc-link-lib=static=clang_rt.osx");
    }
}
