use sdl3::audio::{AudioFormat, AudioSpec, AudioStreamOwner};

use crate::simulation::{Mode, World};

pub struct Sound {
    stream: AudioStreamOwner,
    score: u32,
    lives: u8,
    mode: Mode,
    airborne: bool,
    tick: u64,
}

impl Sound {
    pub fn new(sdl: &sdl3::Sdl) -> Result<Self, String> {
        let audio = sdl.audio().map_err(|error| error.to_string())?;
        let spec = AudioSpec::new(Some(24_000), Some(1), Some(AudioFormat::f32_sys()));
        let stream = audio
            .default_playback_device()
            .open_device_stream(Some(&spec))
            .map_err(|error| error.to_string())?;
        stream.resume().map_err(|error| error.to_string())?;
        Ok(Self {
            stream,
            score: 0,
            lives: 4,
            mode: Mode::Title,
            airborne: false,
            tick: 0,
        })
    }

    pub fn observe(
        &mut self,
        world: &World,
        input: crate::simulation::Input,
    ) -> Result<(), String> {
        let frequency = if world.lives < self.lives {
            Some(130.0)
        } else if world.mode != self.mode {
            Some(520.0)
        } else if world.score > self.score {
            Some(880.0)
        } else if input.jump && !world.player.grounded && !self.airborne {
            Some(340.0)
        } else if input.fire
            && world.player.has_blaster
            && world.tick > self.tick.saturating_add(12)
        {
            self.tick = world.tick;
            Some(220.0)
        } else {
            None
        };
        self.score = world.score;
        self.lives = world.lives;
        self.mode = world.mode;
        self.airborne = !world.player.grounded;
        if let Some(frequency) = frequency {
            if self
                .stream
                .queued_bytes()
                .map_err(|error| error.to_string())?
                < 24_000
            {
                let mut samples = [0.0_f32; 1920];
                let mut phase = 0.0_f32;
                let mut envelope = 0.16_f32;
                for sample in &mut samples {
                    *sample = phase.sin() * envelope;
                    phase += std::f32::consts::TAU * frequency / 24_000.0;
                    envelope *= 0.998;
                }
                self.stream
                    .put_data_f32(&samples)
                    .map_err(|error| error.to_string())?;
            }
        }
        Ok(())
    }
}
