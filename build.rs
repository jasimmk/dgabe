use std::error::Error;
use std::path::PathBuf;
use std::process::Command;

fn main() -> Result<(), Box<dyn Error>> {
    println!("cargo:rerun-if-changed=assets/icons/app.ico");
    println!("cargo:rerun-if-changed=Cargo.toml");
    if std::env::var("CARGO_CFG_TARGET_OS")? == "windows" {
        winresource::WindowsResource::new()
            .set_icon("assets/icons/app.ico")
            .set("ProductName", "Dangerous Gabe")
            .set("FileDescription", "Dangerous Gabe: The Storm Garden")
            .set("OriginalFilename", "dangerous-gabe.exe")
            .compile_for("dangerous-gabe")?;
    }
    let (sdk, library) = match std::env::var("CARGO_CFG_TARGET_OS")?.as_str() {
        "macos" => ("macosx", "libclang_rt.osx.a"),
        "ios" => {
            let simulator = std::env::var("CARGO_CFG_TARGET_ABI").is_ok_and(|abi| abi == "sim")
                || std::env::var("CARGO_CFG_TARGET_ARCH")? == "x86_64";
            if simulator {
                ("iphonesimulator", "libclang_rt.iossim.a")
            } else {
                ("iphoneos", "libclang_rt.ios.a")
            }
        }
        _ => return Ok(()),
    };
    println!("cargo:rerun-if-changed=build.rs");
    for variable in ["DEVELOPER_DIR", "TOOLCHAINS", "SDKROOT"] {
        println!("cargo:rerun-if-env-changed={variable}");
    }
    let output = Command::new("xcrun")
        .args(["--sdk", sdk, "clang", "--print-resource-dir"])
        .output()?;
    if !output.status.success() {
        return Err(format!(
            "Could not locate the {sdk} compiler runtime through xcrun: {}",
            String::from_utf8_lossy(&output.stderr)
        )
        .into());
    }
    let resources = PathBuf::from(String::from_utf8(output.stdout)?.trim());
    let archive = resources.join("lib/darwin").join(library);
    if !archive.is_file() {
        return Err(format!(
            "Missing {sdk} compiler runtime archive: {}",
            archive.display()
        )
        .into());
    }
    println!("cargo:rerun-if-changed={}", archive.display());
    println!(
        "cargo:rustc-link-arg-bin=dangerous-gabe={}",
        archive.display()
    );
    Ok(())
}
