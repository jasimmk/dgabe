use super::{Controls, ShellEvent};
use crate::simulation::Mode;
use sdl3::keyboard::Keycode;

#[test]
fn short_key_taps_survive_until_tick() {
    let mut controls = Controls::default();
    for key in [
        Keycode::Space,
        Keycode::P,
        Keycode::R,
        Keycode::Return,
        Keycode::J,
    ] {
        controls.handle(ShellEvent::Key(key, true), (960.0, 640.0), Mode::Playing);
        controls.handle(ShellEvent::Key(key, false), (960.0, 640.0), Mode::Playing);
    }
    let input = controls.input();
    assert!(input.jump && input.pause && input.restart && input.confirm && input.fire);
    let consumed = controls.input();
    assert!(
        !consumed.jump
            && !consumed.pause
            && !consumed.restart
            && !consumed.confirm
            && !consumed.fire
    );
}

#[test]
fn title_space_confirms_and_control_fires() {
    let mut controls = Controls::default();
    controls.handle(
        ShellEvent::Key(Keycode::Space, true),
        (960.0, 640.0),
        Mode::Title,
    );
    controls.handle(
        ShellEvent::Key(Keycode::LCtrl, true),
        (960.0, 640.0),
        Mode::Title,
    );
    let input = controls.input();
    assert!(input.confirm && input.fire);
    assert!(!input.jump);
    assert!(!controls.input().confirm);
}

#[test]
fn letterboxed_touch_supports_movement_and_short_jump_together() {
    let mut controls = Controls::default();
    let geometry = (1920.0, 1080.0);
    controls.handle(
        ShellEvent::Finger(1, Some((0.15, 0.92)), true),
        geometry,
        Mode::Playing,
    );
    controls.handle(
        ShellEvent::Finger(2, Some((0.86, 0.92)), true),
        geometry,
        Mode::Playing,
    );
    controls.handle(ShellEvent::Finger(2, None, false), geometry, Mode::Playing);
    let input = controls.input();
    assert!(input.left && input.jump);
    assert!(!input.right);
}

#[test]
fn suspension_clears_held_controls_and_pending_edges() {
    let mut controls = Controls::default();
    controls.handle(
        ShellEvent::Key(Keycode::D, true),
        (960.0, 640.0),
        Mode::Playing,
    );
    controls.handle(
        ShellEvent::Key(Keycode::Space, true),
        (960.0, 640.0),
        Mode::Playing,
    );
    controls.handle(ShellEvent::Suspend, (960.0, 640.0), Mode::Playing);
    let input = controls.input();
    assert!(!input.right && !input.jump);
}

#[test]
fn paused_touch_retry_has_a_separate_action() {
    let mut controls = Controls::default();
    controls.handle(
        ShellEvent::Mouse(Some((480.0, 448.0)), true),
        (960.0, 640.0),
        Mode::Paused,
    );
    controls.handle(ShellEvent::Mouse(None, false), (960.0, 640.0), Mode::Paused);
    let input = controls.input();
    assert!(input.restart);
    assert!(!input.confirm && !input.pause);
}

#[test]
fn short_touch_fire_survives_release() {
    let mut controls = Controls::default();
    controls.handle(
        ShellEvent::Finger(1, Some((0.8, 0.9)), true),
        (960.0, 640.0),
        Mode::Playing,
    );
    controls.handle(
        ShellEvent::Finger(1, None, false),
        (960.0, 640.0),
        Mode::Playing,
    );
    assert!(controls.input().fire);
    assert!(!controls.input().fire);
}
