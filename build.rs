use std::error::Error;
use std::path::PathBuf;
use std::process::Command;

fn main() -> Result<(), Box<dyn Error>> {
    if std::env::var("CARGO_CFG_TARGET_OS")? != "ios" {
        return Ok(());
    }
    let simulator = std::env::var("CARGO_CFG_TARGET_ABI").is_ok_and(|abi| abi == "sim")
        || std::env::var("CARGO_CFG_TARGET_ARCH")? == "x86_64";
    let sdk = if simulator {
        "iphonesimulator"
    } else {
        "iphoneos"
    };
    let output = Command::new("xcrun")
        .args(["--sdk", sdk, "clang", "--print-resource-dir"])
        .output()?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).into_owned().into());
    }
    let resources = PathBuf::from(String::from_utf8(output.stdout)?.trim());
    let library = if simulator {
        "libclang_rt.iossim.a"
    } else {
        "libclang_rt.ios.a"
    };
    println!(
        "cargo:rustc-link-arg-bin=dangerous-gabe={}",
        resources.join("lib/darwin").join(library).display()
    );
    Ok(())
}
