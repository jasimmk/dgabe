mod support;

use std::fs;
use support::{Sandbox, TestResult, assert_fields, summary};

#[test]
fn smoke_advances_gameplay_and_exits_when_frame_bound_is_reached() -> TestResult {
    // Given a real executable with isolated dummy video and audio drivers.
    let sandbox = Sandbox::new()?;
    // When the deterministic smoke sequence runs to its default frame bound.
    let output = sandbox.run(&["--smoke"])?;
    // Then gameplay advanced, the process exited successfully and pickups scored.
    let report = summary(&output)?;
    assert_fields(
        report,
        &[
            ("frames", "180"),
            ("mode", "Playing"),
            ("tick", "179"),
            ("level", "0"),
            ("score", "160"),
            ("lives", "3"),
        ],
    );
    Ok(())
}

#[test]
fn twelfth_stage_is_playable_when_selected_by_zero_based_index() -> TestResult {
    // Given the final campaign stage selected through the public CLI.
    let sandbox = Sandbox::new()?;
    // When three deterministic frames run with touch controls visible.
    let output = sandbox.run(&[
        "--scene", "play", "--level", "11", "--touch", "--smoke", "--frames", "3",
    ])?;
    // Then selection is retained and the final stage actually advances.
    let report = summary(&output)?;
    assert_fields(
        report,
        &[
            ("frames", "3"),
            ("mode", "Playing"),
            ("level", "11"),
            ("score", "0"),
            ("lives", "4"),
        ],
    );
    assert!(
        report
            .split_whitespace()
            .any(|field| matches!(field, "tick=1" | "tick=2" | "tick=3")),
        "Selected stage failed to advance within its three-frame bound: {report}"
    );
    Ok(())
}

fn assert_rendered_bmp(bytes: &[u8]) -> TestResult {
    assert!(bytes.len() >= 54, "Truncated BMP header");
    assert_eq!(&bytes[..2], b"BM");
    assert_eq!(
        u32::from_le_bytes(bytes[2..6].try_into()?),
        u32::try_from(bytes.len())?
    );
    assert!(u32::from_le_bytes(bytes[14..18].try_into()?) >= 40);
    let width = i32::from_le_bytes(bytes[18..22].try_into()?);
    let height = i32::from_le_bytes(bytes[22..26].try_into()?);
    assert_eq!((width, height.unsigned_abs()), (960, 640));
    let bits = u16::from_le_bytes(bytes[28..30].try_into()?);
    assert!(matches!(bits, 24 | 32), "Unexpected BMP depth: {bits}");
    let offset = usize::try_from(u32::from_le_bytes(bytes[10..14].try_into()?))?;
    let channels = usize::from(bits / 8);
    let pixels = bytes.get(offset..).ok_or("BMP pixel offset outside file")?;
    assert!(pixels.len() >= 960 * 640 * channels, "Truncated BMP pixels");
    let first_pixel = &pixels[..channels];
    assert!(
        pixels
            .chunks_exact(channels)
            .any(|pixel| pixel != first_pixel),
        "SDL screenshot contains only one color"
    );
    Ok(())
}

macro_rules! screenshot_case {
    ($name:ident, $scene:literal, $mode:literal, $touch:literal) => {
        #[test]
        fn $name() -> TestResult {
            // Given a requested scene and a writable isolated capture path.
            let sandbox = Sandbox::new()?;
            let mut arguments = vec!["--scene", $scene, "--screenshot", "scene.bmp"];
            if $touch {
                arguments.push("--touch");
            }
            // When the public executable exports its default one-frame screenshot.
            let output = sandbox.run(&arguments)?;
            // Then it reports the requested mode and writes a real nonblank BMP.
            assert_fields(
                summary(&output)?,
                &[("frames", "1"), ("mode", $mode), ("level", "0")],
            );
            assert_rendered_bmp(&fs::read(sandbox.0.join("scene.bmp"))?)?;
            Ok(())
        }
    };
}

screenshot_case!(title_exports_bmp_when_requested, "title", "Title", false);
screenshot_case!(
    pause_exports_touch_bmp_when_requested,
    "pause",
    "Paused",
    true
);
screenshot_case!(victory_exports_bmp_when_requested, "win", "Victory", false);
screenshot_case!(
    defeat_exports_touch_bmp_when_requested,
    "lose",
    "Defeat",
    true
);

macro_rules! invalid_case {
    ($name:ident, $arguments:expr, $error:literal) => {
        #[test]
        fn $name() -> TestResult {
            // Given invalid input to the executable's public CLI.
            let sandbox = Sandbox::new()?;
            // When the executable attempts to start with that input.
            let output = sandbox.run($arguments)?;
            // Then startup fails rather than silently starting the game or hanging.
            assert!(
                !output.status.success(),
                "Invalid arguments exited successfully"
            );
            let stderr = std::str::from_utf8(&output.stderr)?;
            assert!(stderr.contains($error), "Wrong startup failure: {stderr}");
            assert!(!String::from_utf8_lossy(&output.stdout).contains("SDL3 frames="));
            Ok(())
        }
    };
}

invalid_case!(
    invalid_scene_fails_when_parsed,
    &["--scene", "rain"],
    "scene must be"
);
invalid_case!(
    outside_campaign_level_fails_when_loaded,
    &["--level", "12", "--frames", "1"],
    "level index outside campaign"
);
invalid_case!(
    zero_frame_bound_fails_when_parsed,
    &["--frames", "0"],
    "frame count must be positive"
);
invalid_case!(
    unknown_option_fails_when_parsed,
    &["--not-an-option"],
    "Unknown argument"
);
