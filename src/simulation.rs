//! Deterministic, SDL-independent storm-garden gameplay. One step is 1/60 second.

use crate::levels;

pub const TILE_SIZE: f32 = 24.0;
pub const STEP_HZ: u32 = 60;
pub const MAX_FUEL: u16 = 420;

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Rect {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}
impl Rect {
    pub const fn new(position: (f32, f32), size: (f32, f32)) -> Self {
        Self {
            x: position.0,
            y: position.1,
            w: size.0,
            h: size.1,
        }
    }
    pub fn tile(column: u16, row: u16) -> Self {
        Self::new(
            (f32::from(column) * TILE_SIZE, f32::from(row) * TILE_SIZE),
            (TILE_SIZE, TILE_SIZE),
        )
    }
    pub fn overlaps(self, other: Self) -> bool {
        self.x < other.x + other.w
            && self.x + self.w > other.x
            && self.y < other.y + other.h
            && self.y + self.h > other.y
    }
}

#[derive(Clone, Copy, Debug, Default)]
pub struct Input {
    pub left: bool,
    pub right: bool,
    pub jump: bool,
    pub fire: bool,
    pub thrust: bool,
    pub pause: bool,
    pub restart: bool,
    pub confirm: bool,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    Title,
    Playing,
    Paused,
    LevelComplete,
    Victory,
    Defeat,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Tile {
    Empty,
    Wall,
    Hazard,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PickupKind {
    Shard,
    Core,
    Blaster,
    Fuel,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EnemyKind {
    Crawler,
    Sentry,
}

#[derive(Clone, Debug)]
pub struct Player {
    pub body: Rect,
    pub vx: f32,
    pub vy: f32,
    pub facing: i8,
    pub grounded: bool,
    pub has_blaster: bool,
    pub fuel: u16,
    pub has_core: bool,
    pub invulnerable: u16,
}
#[derive(Clone, Debug)]
pub struct Pickup {
    pub body: Rect,
    pub kind: PickupKind,
    pub active: bool,
}
#[derive(Clone, Debug)]
pub struct Enemy {
    pub body: Rect,
    pub kind: EnemyKind,
    pub active: bool,
    pub facing: i8,
    pub left: f32,
    pub right: f32,
    pub cooldown: u16,
}
#[derive(Clone, Debug)]
pub struct Shot {
    pub body: Rect,
    pub vx: f32,
    pub active: bool,
    pub hostile: bool,
}

pub struct World {
    pub level_index: usize,
    pub level_name: &'static str,
    pub level_hint: &'static str,
    pub width: u16,
    pub height: u16,
    pub tiles: Vec<Tile>,
    pub player: Player,
    pub pickups: Vec<Pickup>,
    pub enemies: Vec<Enemy>,
    pub shots: Vec<Shot>,
    pub exit: Rect,
    pub score: u32,
    pub lives: u8,
    pub tick: u64,
    pub mode: Mode,
    previous: Input,
    reload: u16,
    transition: u16,
    stage_score: u32,
    charge_per_cell: u16,
}

impl Default for World {
    fn default() -> Self {
        Self::new()
    }
}
impl World {
    pub fn new() -> Self {
        let mut world = Self {
            level_index: 0,
            level_name: "",
            level_hint: "",
            width: 0,
            height: 0,
            tiles: Vec::new(),
            player: Player {
                body: Rect::default(),
                vx: 0.0,
                vy: 0.0,
                facing: 1,
                grounded: false,
                has_blaster: false,
                fuel: 0,
                has_core: false,
                invulnerable: 0,
            },
            pickups: Vec::new(),
            enemies: Vec::new(),
            shots: Vec::with_capacity(32),
            exit: Rect::default(),
            score: 0,
            lives: 4,
            tick: 0,
            mode: Mode::Title,
            previous: Input::default(),
            reload: 0,
            transition: 0,
            stage_score: 0,
            charge_per_cell: MAX_FUEL,
        };
        world.load_level(0);
        world.mode = Mode::Title;
        world
    }

    pub fn start_game(&mut self) {
        self.score = 0;
        self.lives = 4;
        self.tick = 0;
        self.stage_score = 0;
        self.load_level(0);
    }

    /// Selects a campaign stage for normal play, retaining score and attempts.
    /// Invalid indices leave the world untouched and return false.
    pub fn load_level(&mut self, index: usize) -> bool {
        let Some(stage) = levels::build(index) else {
            return false;
        };
        self.level_index = index;
        self.level_name = stage.name;
        self.level_hint = stage.hint;
        self.width = stage.width;
        self.height = stage.height;
        self.tiles = stage.tiles;
        self.exit = stage.exit;
        self.pickups = stage.pickups;
        self.enemies = stage.enemies;
        self.charge_per_cell = stage.charge_per_cell;
        self.shots.clear();
        self.player = Player {
            body: stage.spawn,
            vx: 0.0,
            vy: 0.0,
            facing: 1,
            grounded: false,
            has_blaster: false,
            fuel: 0,
            has_core: false,
            invulnerable: 75,
        };
        self.reload = 0;
        self.transition = 0;
        self.stage_score = self.score;
        self.mode = Mode::Playing;
        true
    }

    /// Retry this stage with its initial score and remaining attempts.
    pub fn restart_level(&mut self) {
        self.score = self.stage_score;
        self.load_level(self.level_index);
    }

    pub fn tile_at(&self, column: u16, row: u16) -> Tile {
        if column >= self.width || row >= self.height {
            return Tile::Empty;
        }
        self.tiles
            .get(usize::from(row) * usize::from(self.width) + usize::from(column))
            .copied()
            .unwrap_or(Tile::Empty)
    }

    pub fn step(&mut self, input: Input) {
        let confirm = input.confirm && !self.previous.confirm;
        let pause = input.pause && !self.previous.pause;
        let restart = input.restart && !self.previous.restart;
        let jump = input.jump && !self.previous.jump;
        self.previous = input;
        match self.mode {
            Mode::Title | Mode::Victory | Mode::Defeat => {
                if confirm {
                    self.start_game();
                }
                return;
            }
            Mode::Paused => {
                if pause || confirm {
                    self.mode = Mode::Playing;
                }
                if restart {
                    self.restart_level();
                }
                return;
            }
            Mode::LevelComplete => {
                self.transition = self.transition.saturating_sub(1);
                if confirm || self.transition == 0 {
                    if self.level_index + 1 == levels::CAMPAIGN_LEN {
                        self.mode = Mode::Victory;
                    } else {
                        self.load_level(self.level_index + 1);
                    }
                }
                return;
            }
            Mode::Playing => {}
        }
        if pause {
            self.mode = Mode::Paused;
            return;
        }
        if restart {
            self.restart_level();
            return;
        }
        self.tick = self.tick.wrapping_add(1);
        self.reload = self.reload.saturating_sub(1);
        self.player.invulnerable = self.player.invulnerable.saturating_sub(1);
        self.player.vx = (f32::from(u8::from(input.right)) - f32::from(u8::from(input.left))) * 3.4;
        if self.player.vx.abs() > 0.0 {
            self.player.facing = if self.player.vx > 0.0 { 1 } else { -1 };
        }
        if jump && self.player.grounded {
            self.player.vy = -9.2;
        }
        if input.thrust && self.player.fuel > 0 {
            self.player.vy = (self.player.vy - 0.68).max(-5.4);
            self.player.fuel = self.player.fuel.saturating_sub(1);
        } else {
            self.player.vy = (self.player.vy + 0.43).min(10.0);
        }
        self.move_player();
        self.collect();
        if input.fire && self.player.has_blaster && self.reload == 0 {
            let direction = f32::from(self.player.facing);
            self.shots.push(Shot {
                body: Rect::new(
                    (
                        self.player.body.x + 9.0 + direction * 12.0,
                        self.player.body.y + 10.0,
                    ),
                    (8.0, 4.0),
                ),
                vx: direction * 8.2,
                active: true,
                hostile: false,
            });
            self.reload = 16;
        }
        self.machines();
        self.projectiles();
        let hazard = self.touches(self.player.body, Tile::Hazard);
        let machine = self
            .enemies
            .iter()
            .any(|enemy| enemy.active && enemy.body.overlaps(self.player.body));
        let struck = self
            .shots
            .iter()
            .any(|shot| shot.active && shot.hostile && shot.body.overlaps(self.player.body));
        if self.player.body.y > f32::from(self.height) * TILE_SIZE + 40.0
            || ((hazard || machine || struck) && self.player.invulnerable == 0)
        {
            self.lives = self.lives.saturating_sub(1);
            if self.lives == 0 {
                self.mode = Mode::Defeat;
            } else {
                self.restart_level();
            }
            return;
        }
        if self.player.has_core && self.player.body.overlaps(self.exit) {
            self.score = self.score.saturating_add(750 + u32::from(self.player.fuel));
            self.mode = Mode::LevelComplete;
            self.transition = 90;
        }
    }

    fn move_player(&mut self) {
        self.player.body.x += self.player.vx;
        let far_edge = f32::from(self.width) * TILE_SIZE - self.player.body.w;
        self.player.body.x = self.player.body.x.clamp(0.0, far_edge);
        for row in 0..self.height {
            for column in 0..self.width {
                let wall = Rect::tile(column, row);
                if self.tile_at(column, row) == Tile::Wall && self.player.body.overlaps(wall) {
                    self.player.body.x = if self.player.vx > 0.0 {
                        wall.x - self.player.body.w
                    } else {
                        wall.x + wall.w
                    };
                }
            }
        }
        self.player.body.y += self.player.vy;
        self.player.grounded = false;
        for row in 0..self.height {
            for column in 0..self.width {
                let wall = Rect::tile(column, row);
                if self.tile_at(column, row) == Tile::Wall && self.player.body.overlaps(wall) {
                    if self.player.vy >= 0.0 {
                        self.player.body.y = wall.y - self.player.body.h;
                        self.player.grounded = true;
                    } else {
                        self.player.body.y = wall.y + wall.h;
                    }
                    self.player.vy = 0.0;
                }
            }
        }
        if self.player.body.y < 0.0 {
            self.player.body.y = 0.0;
            self.player.vy = 0.0;
        }
    }

    fn collect(&mut self) {
        for pickup in &mut self.pickups {
            if pickup.active && pickup.body.overlaps(self.player.body) {
                pickup.active = false;
                match pickup.kind {
                    PickupKind::Shard => self.score = self.score.saturating_add(80),
                    PickupKind::Core => {
                        self.player.has_core = true;
                        self.score = self.score.saturating_add(300);
                    }
                    PickupKind::Blaster => self.player.has_blaster = true,
                    PickupKind::Fuel => self.player.fuel = self.charge_per_cell,
                }
            }
        }
    }

    fn machines(&mut self) {
        for enemy in &mut self.enemies {
            if !enemy.active {
                continue;
            }
            match enemy.kind {
                EnemyKind::Crawler => {
                    enemy.body.x += f32::from(enemy.facing) * 0.85;
                    if enemy.body.x <= enemy.left {
                        enemy.body.x = enemy.left;
                        enemy.facing = 1;
                    }
                    if enemy.body.x + enemy.body.w >= enemy.right {
                        enemy.body.x = enemy.right - enemy.body.w;
                        enemy.facing = -1;
                    }
                }
                EnemyKind::Sentry => {
                    enemy.facing = if self.player.body.x < enemy.body.x {
                        -1
                    } else {
                        1
                    };
                    enemy.cooldown = enemy.cooldown.saturating_sub(1);
                    if enemy.cooldown == 0 && (self.player.body.x - enemy.body.x).abs() < 340.0 {
                        self.shots.push(Shot {
                            body: Rect::new((enemy.body.x + 8.0, enemy.body.y + 8.0), (7.0, 5.0)),
                            vx: f32::from(enemy.facing) * 3.0,
                            active: true,
                            hostile: true,
                        });
                        enemy.cooldown = 110;
                    }
                }
            }
        }
    }

    fn projectiles(&mut self) {
        for shot in &mut self.shots {
            shot.body.x += shot.vx;
        }
        let mut shots = std::mem::take(&mut self.shots);
        for shot in &mut shots {
            if self.touches(shot.body, Tile::Wall)
                || shot.body.x < 0.0
                || shot.body.x > f32::from(self.width) * TILE_SIZE
            {
                shot.active = false;
            }
            if shot.active && !shot.hostile {
                for enemy in &mut self.enemies {
                    if enemy.active && enemy.body.overlaps(shot.body) {
                        enemy.active = false;
                        shot.active = false;
                        self.score = self.score.saturating_add(120);
                        break;
                    }
                }
            }
        }
        shots.retain(|shot| shot.active);
        self.shots = shots;
    }

    fn touches(&self, body: Rect, material: Tile) -> bool {
        (0..self.height).any(|row| {
            (0..self.width).any(|column| {
                self.tile_at(column, row) == material && body.overlaps(Rect::tile(column, row))
            })
        })
    }
}
