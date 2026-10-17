use std::fs::{self, File};
use std::io;
use std::path::PathBuf;
use std::process::{Child, Command, Output, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

pub type TestResult<T = ()> = Result<T, Box<dyn std::error::Error>>;

static NEXT_DIRECTORY: AtomicU64 = AtomicU64::new(0);

pub struct Sandbox(pub PathBuf);

impl Sandbox {
    pub fn new() -> TestResult<Self> {
        let nonce = SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos();
        let sequence = NEXT_DIRECTORY.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!(
            "dangerous-gabe-cli-{}-{nonce}-{sequence}",
            std::process::id()
        ));
        fs::create_dir(&path)?;
        Ok(Self(path))
    }

    pub fn run(&self, arguments: &[&str]) -> TestResult<Output> {
        let stdout_path = self.0.join("stdout.log");
        let stderr_path = self.0.join("stderr.log");
        let child = Command::new(env!("CARGO_BIN_EXE_dangerous-gabe"))
            .args(arguments)
            .current_dir(&self.0)
            .env("SDL_VIDEO_DRIVER", "dummy")
            .env("SDL_AUDIO_DRIVER", "dummy")
            .stdin(Stdio::null())
            .stdout(File::create(&stdout_path)?)
            .stderr(File::create(&stderr_path)?)
            .spawn()?;
        let mut child = ReapedChild(child);
        let deadline = Instant::now() + Duration::from_secs(20);
        let status = loop {
            let status = child.0.try_wait()?;
            if status.is_some() || Instant::now() >= deadline {
                break status;
            }
            std::thread::sleep(Duration::from_millis(10));
        };
        drop(child);
        let stdout = fs::read(stdout_path)?;
        let stderr = fs::read(stderr_path)?;
        let status = status.ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::TimedOut,
                format!(
                    "game exceeded 20 seconds for {arguments:?}\nstdout: {}\nstderr: {}",
                    String::from_utf8_lossy(&stdout),
                    String::from_utf8_lossy(&stderr)
                ),
            )
        })?;
        Ok(Output {
            status,
            stdout,
            stderr,
        })
    }
}

impl Drop for Sandbox {
    fn drop(&mut self) {
        if let Err(error) = fs::remove_dir_all(&self.0) {
            eprintln!(
                "Cannot remove CLI test directory {}: {error}",
                self.0.display()
            );
        }
    }
}

struct ReapedChild(Child);

impl Drop for ReapedChild {
    fn drop(&mut self) {
        match self.0.try_wait() {
            Ok(Some(_)) => return,
            Ok(None) => {}
            Err(error) => eprintln!("Cannot inspect CLI test child: {error}"),
        }
        if let Err(error) = self.0.kill() {
            eprintln!("Cannot kill CLI test child: {error}");
        }
        if let Err(error) = self.0.wait() {
            eprintln!("Cannot reap CLI test child: {error}");
        }
    }
}

pub fn summary(output: &Output) -> TestResult<&str> {
    let stdout = std::str::from_utf8(&output.stdout)?;
    let stderr = std::str::from_utf8(&output.stderr)?;
    assert!(
        output.status.success(),
        "status: {}\n{stdout}\n{stderr}",
        output.status
    );
    assert!(!stderr.contains("Audio unavailable:"), "{stderr}");
    assert!(!stderr.contains("Audio disabled:"), "{stderr}");
    stdout
        .lines()
        .find(|line| line.starts_with("SDL3 frames="))
        .ok_or_else(|| {
            io::Error::other(format!("Missing final SDL summary: {stdout}\n{stderr}")).into()
        })
}

pub fn assert_fields(summary: &str, fields: &[(&str, &str)]) {
    for (key, value) in fields {
        let token = format!("{key}={value}");
        assert!(
            summary.split_whitespace().any(|field| field == token),
            "Missing {token}: {summary}"
        );
    }
}
