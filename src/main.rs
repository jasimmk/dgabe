use std::cell::RefCell;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use dangerous_gabe::{platform, presentation, simulation, sound};
use platform::{Controls, ShellEvent};
use sdl3::event::Event;
use sdl3::render::Canvas;
use sdl3::video::Window;
use sdl3_main::{AppResult, MainThreadData, MainThreadToken};
use simulation::{Input, Mode, World};

#[cfg(any(target_os = "windows", target_os = "linux", target_os = "macos"))]
mod app_icon;
mod options;
use options::Options;

struct App {
    canvas: Canvas<Window>,
    world: World,
    controls: Controls,
    audio: Option<sound::Sound>,
    options: Options,
    frames: u32,
    previous: Instant,
    accumulator: Duration,
    _sdl: sdl3::Sdl,
}

struct Bridge {
    app: MainThreadData<RefCell<App>>,
    events: Mutex<Vec<ShellEvent>>,
}

#[sdl3_main::app_impl]
impl Bridge {
    fn app_init() -> Option<Box<Self>> {
        match create_app() {
            Ok(app) => Some(Box::new(Self {
                app: MainThreadData::assert_new(RefCell::new(app)),
                events: Mutex::new(Vec::with_capacity(32)),
            })),
            Err(error) => {
                eprintln!("Dangerous Gabe startup failed: {error}");
                None
            }
        }
    }

    fn app_iterate(&self) -> AppResult {
        let Some(token) = MainThreadToken::get() else {
            return AppResult::Failure;
        };
        let mut app = self.app.get(token).borrow_mut();
        let mut pending = Vec::new();
        {
            let Ok(mut events) = self.events.lock() else {
                return AppResult::Failure;
            };
            std::mem::swap(&mut *events, &mut pending);
        }
        let result = app.frame(&mut pending);
        {
            let Ok(mut events) = self.events.lock() else {
                return AppResult::Failure;
            };
            if events.is_empty() {
                std::mem::swap(&mut *events, &mut pending);
            }
        }
        match result {
            Ok(true) => AppResult::Success,
            Ok(false) => AppResult::Continue,
            Err(error) => {
                eprintln!("Dangerous Gabe failed: {error}");
                AppResult::Failure
            }
        }
    }

    fn app_event(&self, event: Event) -> AppResult {
        if let Some(event) = ShellEvent::from_sdl(event) {
            let Ok(mut events) = self.events.lock() else {
                return AppResult::Failure;
            };
            events.push(event);
        }
        AppResult::Continue
    }
}

impl App {
    fn frame(&mut self, events: &mut Vec<ShellEvent>) -> Result<bool, String> {
        let size = self.canvas.window().size();
        let geometry = (
            f32::from(u16::try_from(size.0).map_err(|_| "window too wide")?),
            f32::from(u16::try_from(size.1).map_err(|_| "window too tall")?),
        );
        for event in events.drain(..) {
            if matches!(event, ShellEvent::Suspend) && self.world.mode == Mode::Playing {
                self.world.mode = Mode::Paused;
            }
            if self.controls.handle(event, geometry, self.world.mode) {
                return Ok(true);
            }
        }
        let now = Instant::now();
        let tick = Duration::from_secs_f64(1.0 / f64::from(simulation::STEP_HZ));
        self.accumulator += if self.options.smoke || self.options.record.is_some() {
            tick
        } else {
            now.duration_since(self.previous)
                .min(Duration::from_millis(100))
        };
        self.previous = now;
        while self.accumulator >= tick {
            self.accumulator -= tick;
            let mut input = self.controls.input();
            if self.options.smoke {
                input = Input {
                    confirm: self.frames == 0,
                    right: self.frames < 150,
                    jump: self.frames % 45 == 20,
                    ..Input::default()
                };
            }
            if self.options.autoplay {
                let t = self.world.tick;
                input = Input {
                    confirm: self.world.mode != Mode::Playing && self.frames % 30 == 0,
                    right: t % 240 < 200,
                    jump: t % 38 < 6,
                    fire: t % 22 < 3,
                    thrust: t % 150 > 95 && t % 150 < 125,
                    ..Input::default()
                };
            }
            self.world.step(input);
            if let Some(audio) = &mut self.audio {
                if let Err(error) = audio.observe(&self.world, input) {
                    eprintln!("Audio disabled: {error}");
                    self.audio = None;
                }
            }
        }
        presentation::paint(&mut self.canvas, &self.world, self.controls.touch_visible)?;
        if let Some(dir) = &self.options.record {
            if self.frames % 2 == 0 {
                let path = format!("{dir}/frame_{:05}.bmp", self.frames / 2);
                self.canvas
                    .read_pixels(None)
                    .and_then(|surface| surface.save_bmp(&path))
                    .map_err(|error| error.to_string())?;
            }
        }
        self.frames = self.frames.saturating_add(1);
        let done = self
            .options
            .frames
            .is_some_and(|limit| self.frames >= limit);
        if done {
            if let Some(path) = &self.options.screenshot {
                self.canvas
                    .read_pixels(None)
                    .and_then(|surface| surface.save_bmp(path))
                    .map_err(|error| error.to_string())?;
                println!("Saved {path}");
            }
        }
        self.canvas.present();
        if done {
            println!(
                "SDL3 frames={} mode={:?} tick={} level={} score={} lives={}",
                self.frames,
                self.world.mode,
                self.world.tick,
                self.world.level_index,
                self.world.score,
                self.world.lives
            );
        }
        #[cfg(not(target_os = "ios"))]
        if !done {
            sdl3::timer::delay(8);
        }
        Ok(done)
    }
}

fn create_app() -> Result<App, String> {
    let options = Options::parse()?;
    let sdl = sdl3::init().map_err(|error| error.to_string())?;
    // iOS/iPadOS: SDL's view controller allows every orientation for a
    // resizable window unless this hint restricts it, and hides the status
    // bar only for borderless or fullscreen windows.
    #[cfg(target_os = "ios")]
    if !sdl3::hint::set("SDL_IOS_ORIENTATIONS", "LandscapeLeft LandscapeRight") {
        return Err("SDL rejected the landscape orientation hint".into());
    }
    let video = sdl.video().map_err(|error| error.to_string())?;
    let (width, height) = options.window;
    let mut builder = video.window("Dangerous Gabe: The Storm Garden", width, height);
    builder.resizable().high_pixel_density().position_centered();
    #[cfg(target_os = "ios")]
    builder.borderless();
    let window = builder.build().map_err(|error| error.to_string())?;
    let mut canvas = window.into_canvas();
    #[cfg(any(target_os = "windows", target_os = "linux", target_os = "macos"))]
    if let Err(error) = app_icon::install(canvas.window_mut(), video.current_video_driver()) {
        eprintln!("Window icon unavailable: {error}");
    }
    canvas
        .set_logical_size(
            960,
            640,
            sdl3::sys::render::SDL_LOGICAL_PRESENTATION_LETTERBOX,
        )
        .map_err(|error| error.to_string())?;
    if options.smoke {
        match platform::data_dir().and_then(|dir| platform::probe_data_dir(&dir).map(|()| dir)) {
            Ok(dir) => eprintln!("Save directory writable: {}", dir.display()),
            Err(error) => return Err(format!("save directory unusable: {error}")),
        }
    }
    let mut world = World::new();
    if !world.load_level(options.level) {
        return Err("level index outside campaign".into());
    }
    world.mode = options.scene;
    let audio = match sound::Sound::new(&sdl) {
        Ok(audio) => Some(audio),
        Err(error) => {
            eprintln!("Audio unavailable: {error}");
            None
        }
    };
    let mut controls = Controls::default();
    controls.touch_visible = options.touch;
    Ok(App {
        canvas,
        world,
        controls,
        audio,
        options,
        frames: 0,
        previous: Instant::now(),
        accumulator: Duration::ZERO,
        _sdl: sdl,
    })
}
