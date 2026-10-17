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
        self.accumulator += if self.options.smoke {
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
            self.world.step(input);
            if let Some(audio) = &mut self.audio {
                if let Err(error) = audio.observe(&self.world, input) {
                    eprintln!("Audio disabled: {error}");
                    self.audio = None;
                }
            }
        }
        presentation::paint(&mut self.canvas, &self.world, self.controls.touch_visible)?;
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
    let video = sdl.video().map_err(|error| error.to_string())?;
    let window = video
        .window("Dangerous Gabe: The Storm Garden", 960, 640)
        .resizable()
        .high_pixel_density()
        .position_centered()
        .build()
        .map_err(|error| error.to_string())?;
    let mut canvas = window.into_canvas();
    canvas
        .set_logical_size(
            960,
            640,
            sdl3::sys::render::SDL_LOGICAL_PRESENTATION_LETTERBOX,
        )
        .map_err(|error| error.to_string())?;
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
