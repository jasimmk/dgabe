use dangerous_gabe::simulation::Mode;

pub(crate) struct Options {
    pub(crate) smoke: bool,
    pub(crate) frames: Option<u32>,
    pub(crate) screenshot: Option<String>,
    pub(crate) scene: Mode,
    pub(crate) touch: bool,
    pub(crate) level: usize,
    /// initial window size in points (default 960x640)
    pub(crate) window: (u32, u32),
    /// write every second frame as DIR/frame_NNNNN.bmp (fixed 60 Hz steps)
    pub(crate) record: Option<String>,
    /// scripted demo input (used for App Store preview capture)
    pub(crate) autoplay: bool,
}

impl Options {
    pub(crate) fn parse() -> Result<Self, String> {
        let mut options = Self {
            smoke: false,
            frames: None,
            screenshot: None,
            scene: Mode::Title,
            touch: cfg!(target_os = "ios"),
            level: 0,
            window: (960, 640),
            record: None,
            autoplay: false,
        };
        let mut args = std::env::args().skip(1);
        while let Some(arg) = args.next() {
            match arg.as_str() {
                "--smoke" => options.smoke = true,
                "--touch" => options.touch = true,
                "--autoplay" => options.autoplay = true,
                "--record" => {
                    options.record = Some(args.next().ok_or("--record needs a directory")?)
                }
                "--frames" => {
                    options.frames = Some(
                        args.next()
                            .ok_or("--frames needs a count")?
                            .parse()
                            .map_err(|_| "invalid frame count")?,
                    )
                }
                "--level" => {
                    options.level = args
                        .next()
                        .ok_or("--level needs a zero-based index")?
                        .parse()
                        .map_err(|_| "invalid level index")?
                }
                "--window" => {
                    let size = args.next().ok_or("--window needs WIDTHxHEIGHT")?;
                    let (w, h) = size.split_once('x').ok_or("--window needs WIDTHxHEIGHT")?;
                    let w: u32 = w.parse().map_err(|_| "invalid window width")?;
                    let h: u32 = h.parse().map_err(|_| "invalid window height")?;
                    if !(320..=8192).contains(&w) || !(200..=8192).contains(&h) {
                        return Err("window size must be between 320x200 and 8192x8192".into());
                    }
                    options.window = (w, h);
                }
                "--screenshot" => {
                    options.screenshot = Some(args.next().ok_or("--screenshot needs a BMP path")?)
                }
                "--scene" => {
                    options.scene = match args.next().as_deref() {
                        Some("title") => Mode::Title,
                        Some("play") => Mode::Playing,
                        Some("pause") => Mode::Paused,
                        Some("clear") => Mode::LevelComplete,
                        Some("win") => Mode::Victory,
                        Some("lose") => Mode::Defeat,
                        _ => return Err("scene must be title/play/pause/clear/win/lose".into()),
                    }
                }
                _ => {
                    return Err(format!(
                        "Unknown argument {arg}; use --smoke, --frames N, --scene NAME, --level N, --touch, --window WxH, --screenshot PATH.bmp, --record DIR, --autoplay"
                    ));
                }
            }
        }
        if options.frames == Some(0) {
            return Err("frame count must be positive".into());
        }
        if options.frames.is_none() {
            options.frames = if options.smoke {
                Some(180)
            } else if options.screenshot.is_some() {
                Some(1)
            } else {
                None
            };
        }
        Ok(options)
    }
}
