use std::collections::HashSet;

use sdl3::event::{Event, WindowEvent};
use sdl3::keyboard::Keycode;
use sdl3::mouse::MouseButton;

use crate::simulation::{Input, Mode};

pub enum ShellEvent {
    Quit,
    Suspend,
    Key(Keycode, bool),
    Finger(u64, Option<(f32, f32)>, bool),
    Mouse(Option<(f32, f32)>, bool),
}

impl ShellEvent {
    pub fn from_sdl(event: Event) -> Option<Self> {
        match event {
            Event::Quit { .. } | Event::AppTerminating { .. } => Some(Self::Quit),
            Event::KeyDown {
                keycode: Some(Keycode::Q),
                repeat: false,
                ..
            } => Some(Self::Quit),
            Event::KeyDown {
                keycode: Some(key),
                repeat: false,
                ..
            } => Some(Self::Key(key, true)),
            Event::KeyUp {
                keycode: Some(key), ..
            } => Some(Self::Key(key, false)),
            Event::AppWillEnterBackground { .. }
            | Event::Window {
                win_event: WindowEvent::FocusLost | WindowEvent::Minimized,
                ..
            } => Some(Self::Suspend),
            Event::FingerDown {
                finger_id, x, y, ..
            } => Some(Self::Finger(finger_id, Some((x, y)), true)),
            Event::FingerMotion {
                finger_id, x, y, ..
            } => Some(Self::Finger(finger_id, Some((x, y)), false)),
            Event::FingerUp { finger_id, .. } | Event::FingerCanceled { finger_id, .. } => {
                Some(Self::Finger(finger_id, None, false))
            }
            Event::MouseButtonDown {
                mouse_btn: MouseButton::Left,
                which,
                x,
                y,
                ..
            } if which != u32::MAX => Some(Self::Mouse(Some((x, y)), true)),
            Event::MouseButtonUp {
                mouse_btn: MouseButton::Left,
                which,
                ..
            } if which != u32::MAX => Some(Self::Mouse(None, false)),
            Event::MouseMotion {
                mousestate,
                which,
                x,
                y,
                ..
            } if which != u32::MAX && mousestate.left() => Some(Self::Mouse(Some((x, y)), false)),
            _ => None,
        }
    }
}

#[derive(Default)]
pub struct Controls {
    keys: HashSet<Keycode>,
    fingers: Vec<(u64, (f32, f32))>,
    mouse: Option<(f32, f32)>,
    latched: Input,
    pub touch_visible: bool,
}

impl Controls {
    pub fn clear(&mut self) {
        self.keys.clear();
        self.fingers.clear();
        self.mouse = None;
        self.latched = Input::default();
    }

    pub fn handle(&mut self, event: ShellEvent, geometry: (f32, f32), mode: Mode) -> bool {
        match event {
            ShellEvent::Quit => return true,
            ShellEvent::Suspend => self.clear(),
            ShellEvent::Key(key, down) => {
                if down {
                    if self.keys.insert(key) {
                        match key {
                            Keycode::Space if mode != Mode::Playing => self.latched.confirm = true,
                            Keycode::Space | Keycode::W | Keycode::Up => self.latched.jump = true,
                            Keycode::Return => self.latched.confirm = true,
                            Keycode::P | Keycode::Escape => self.latched.pause = true,
                            Keycode::R => self.latched.restart = true,
                            Keycode::X | Keycode::J | Keycode::LCtrl | Keycode::RCtrl => {
                                self.latched.fire = true
                            }
                            _ => {}
                        }
                    }
                } else {
                    self.keys.remove(&key);
                }
            }
            ShellEvent::Finger(id, point, pressed) => {
                self.touch_visible = true;
                self.fingers.retain(|(finger, _)| *finger != id);
                if let Some((x, y)) = point {
                    let point = logical_point((x * geometry.0, y * geometry.1), geometry);
                    if pressed {
                        self.press(point, mode);
                    }
                    self.fingers.push((id, point));
                }
            }
            ShellEvent::Mouse(point, pressed) => {
                self.mouse = point.map(|point| logical_point(point, geometry));
                if pressed {
                    if let Some(point) = self.mouse {
                        self.press(point, mode);
                    }
                }
            }
        }
        false
    }

    fn press(&mut self, point: (f32, f32), mode: Mode) {
        if inside(point, (876.0, 0.0, 84.0, 72.0)) {
            self.latched.pause = true;
        } else if mode == Mode::Paused && inside(point, (240.0, 416.0, 480.0, 64.0)) {
            self.latched.restart = true;
        } else if mode != Mode::Playing
            && (0.0..960.0).contains(&point.0)
            && (0.0..640.0).contains(&point.1)
        {
            self.latched.confirm = true;
        } else if mode == Mode::Playing && inside(point, (832.0, 552.0, 112.0, 72.0)) {
            self.latched.jump = true;
        } else if mode == Mode::Playing && inside(point, (736.0, 552.0, 88.0, 72.0)) {
            self.latched.fire = true;
        }
    }

    pub fn input(&mut self) -> Input {
        let key = |choices: &[Keycode]| choices.iter().any(|key| self.keys.contains(key));
        let pad = |rect| {
            self.fingers.iter().any(|(_, point)| inside(*point, rect))
                || self.mouse.is_some_and(|point| inside(point, rect))
        };
        let input = Input {
            left: key(&[Keycode::A, Keycode::Left]) || pad((16.0, 552.0, 88.0, 72.0)),
            right: key(&[Keycode::D, Keycode::Right]) || pad((112.0, 552.0, 88.0, 72.0)),
            jump: self.latched.jump,
            fire: self.latched.fire
                || key(&[Keycode::X, Keycode::J, Keycode::LCtrl, Keycode::RCtrl])
                || pad((736.0, 552.0, 88.0, 72.0)),
            thrust: key(&[Keycode::LShift, Keycode::RShift, Keycode::Z, Keycode::K])
                || pad((640.0, 552.0, 88.0, 72.0)),
            pause: self.latched.pause,
            restart: self.latched.restart,
            confirm: self.latched.confirm,
        };
        self.latched = Input::default();
        input
    }
}

fn inside(point: (f32, f32), rect: (f32, f32, f32, f32)) -> bool {
    point.0 >= rect.0 && point.0 < rect.0 + rect.2 && point.1 >= rect.1 && point.1 < rect.1 + rect.3
}

fn logical_point(point: (f32, f32), size: (f32, f32)) -> (f32, f32) {
    let scale = (size.0 / 960.0).min(size.1 / 640.0).max(f32::EPSILON);
    (
        (point.0 - (size.0 - 960.0 * scale) * 0.5) / scale,
        (point.1 - (size.1 - 640.0 * scale) * 0.5) / scale,
    )
}

#[cfg(test)]
mod tests;
