use sdl3::pixels::Color;
use sdl3::rect::Rect as ClipRect;
use sdl3::render::{Canvas, FRect};
use sdl3::video::Window;

use crate::lettering;
use crate::simulation::{EnemyKind, MAX_FUEL, Mode, PickupKind, Rect, TILE_SIZE, Tile, World};

const INK: Color = Color::RGB(7, 17, 31);
const MIDNIGHT: Color = Color::RGB(16, 27, 50);
const STORM: Color = Color::RGB(35, 58, 88);
const GLASS: Color = Color::RGB(43, 102, 112);
const TRELLIS: Color = Color::RGB(67, 135, 125);
const COPPER: Color = Color::RGB(189, 123, 87);
const LEAF: Color = Color::RGB(118, 186, 134);
const SEED: Color = Color::RGB(197, 239, 138);
const CURRENT: Color = Color::RGB(114, 224, 218);
const CORAL: Color = Color::RGB(242, 141, 125);
const ORCHID: Color = Color::RGB(182, 149, 222);
const PAPER: Color = Color::RGB(242, 237, 214);

struct Painter<'a> {
    canvas: &'a mut Canvas<Window>,
    error: Option<String>,
}

impl Painter<'_> {
    fn block(&mut self, bounds: (f32, f32, f32, f32), color: Color) {
        if self.error.is_some() {
            return;
        }
        self.canvas.set_draw_color(color);
        if let Err(error) = self
            .canvas
            .fill_rect(FRect::new(bounds.0, bounds.1, bounds.2, bounds.3))
        {
            self.error = Some(error.to_string());
        }
    }

    fn line(&mut self, start: (f32, f32), end: (f32, f32), color: Color) {
        if self.error.is_some() {
            return;
        }
        self.canvas.set_draw_color(color);
        if let Err(error) = self.canvas.draw_line(start, end) {
            self.error = Some(error.to_string());
        }
    }

    fn frame(&mut self, bounds: (f32, f32, f32, f32), color: Color) {
        let (x, y, width, height) = bounds;
        self.block((x, y, width, 2.0), color);
        self.block((x, y + height - 2.0, width, 2.0), color);
        self.block((x, y, 2.0, height), color);
        self.block((x + width - 2.0, y, 2.0, height), color);
    }

    fn text(&mut self, text: &str, position: (f32, f32), style: (u16, Color)) {
        let scale = f32::from(style.0);
        lettering::for_each_pixel(text, |x, y| {
            let x = f32::from(u16::try_from(x).unwrap_or(u16::MAX));
            let y = f32::from(u16::try_from(y).unwrap_or(u16::MAX));
            self.block(
                (position.0 + x * scale, position.1 + y * scale, scale, scale),
                style.1,
            );
        });
    }

    fn centered(&mut self, text: &str, y: f32, style: (u16, Color)) {
        let width = f32::from(u16::try_from(lettering::measure(text).0).unwrap_or(u16::MAX));
        self.text(text, ((960.0 - width * f32::from(style.0)) * 0.5, y), style);
    }

    fn leaf(&mut self, position: (f32, f32), color: Color) {
        self.block((position.0 + 4.0, position.1, 8.0, 4.0), color);
        self.block((position.0, position.1 + 4.0, 12.0, 4.0), color);
    }

    fn finish(self) -> Result<(), String> {
        self.error.map_or(Ok(()), Err)
    }
}

pub fn paint(
    canvas: &mut Canvas<Window>,
    world: &World,
    touch_controls: bool,
) -> Result<(), String> {
    canvas.set_draw_color(MIDNIGHT);
    canvas.clear();
    let camera = (world.player.body.x - 210.0)
        .clamp(0.0, (f32::from(world.width) * TILE_SIZE - 480.0).max(0.0))
        .floor();
    let mut painter = Painter {
        canvas,
        error: None,
    };
    painter.canvas.set_clip_rect(ClipRect::new(0, 64, 960, 480));
    scenery(&mut painter, camera, world);
    terrain(&mut painter, camera, world);
    objects(&mut painter, camera, world);
    protagonist(&mut painter, camera, world);
    painter.canvas.set_clip_rect(None);
    instruments(&mut painter, world);
    controls(&mut painter, touch_controls, world);
    overlay(&mut painter, world, touch_controls);
    painter.finish()
}

fn screen(body: Rect, camera: f32) -> (f32, f32, f32, f32) {
    (
        (body.x - camera).floor() * 2.0,
        body.y.floor() * 2.0 + 64.0,
        body.w * 2.0,
        body.h * 2.0,
    )
}

fn scenery(p: &mut Painter<'_>, camera: f32, world: &World) {
    p.block((0.0, 64.0, 960.0, 480.0), MIDNIGHT);
    p.block((0.0, 220.0, 960.0, 324.0), STORM);
    let drift = f32::from(u16::try_from(world.tick % 960).unwrap_or(0)) / 12.0;
    for index in -1_i16..7 {
        let x = f32::from(index) * 192.0 - (camera * 0.25 + drift) % 192.0;
        p.block((x, 134.0, 148.0, 14.0), STORM);
        p.block((x + 24.0, 122.0, 82.0, 16.0), STORM);
        p.block((x + 72.0, 318.0, 144.0, 18.0), GLASS);
        p.block((x + 102.0, 306.0, 64.0, 14.0), GLASS);
    }
    for index in -1_i16..7 {
        let x = f32::from(index) * 192.0 - (camera * 0.7) % 192.0;
        p.line((x, 544.0), (x, 180.0), GLASS);
        p.line((x, 180.0), (x + 96.0, 96.0), GLASS);
        p.line((x + 96.0, 96.0), (x + 192.0, 180.0), GLASS);
        p.line((x, 236.0), (x + 192.0, 236.0), GLASS);
        p.line((x, 400.0), (x + 192.0, 400.0), GLASS);
        p.line((x + 96.0, 96.0), (x + 96.0, 544.0), GLASS);
        p.leaf((x + 10.0, 408.0), TRELLIS);
        p.leaf((x + 20.0, 430.0), TRELLIS);
        p.line((x + 20.0, 400.0), (x + 20.0, 494.0), TRELLIS);
    }
    for index in 0_i16..30 {
        let x = (f32::from(index) * 73.0 - camera * 0.15).rem_euclid(960.0);
        let y = 80.0 + (f32::from(index) * 47.0 + drift * 3.0).rem_euclid(360.0);
        p.block((x, y, 2.0, 6.0), GLASS);
    }
}

fn terrain(p: &mut Painter<'_>, camera: f32, world: &World) {
    for row in 0..world.height {
        for column in 0..world.width {
            let (x, y, width, height) = screen(Rect::tile(column, row), camera);
            if x + width < 0.0 || x > 960.0 {
                continue;
            }
            match world.tile_at(column, row) {
                Tile::Empty => {}
                Tile::Wall => {
                    p.block((x, y, width, height), INK);
                    p.block((x + 2.0, y + 6.0, width - 4.0, 34.0), GLASS);
                    p.block((x, y + 2.0, width, 6.0), TRELLIS);
                    p.block((x + 2.0, y + 8.0, width - 4.0, 2.0), LEAF);
                    p.block((x + 4.0, y + 30.0, 40.0, 4.0), COPPER);
                    p.block((x + 6.0, y + 18.0, 4.0, 4.0), COPPER);
                    p.block((x + 38.0, y + 18.0, 4.0, 4.0), COPPER);
                    if column % 3 == 1
                        && world.tile_at(column, row.saturating_sub(1)) == Tile::Empty
                    {
                        p.leaf((x + 14.0, y - 8.0), LEAF);
                    }
                }
                Tile::Hazard => {
                    p.block((x, y + 38.0, 48.0, 10.0), INK);
                    p.block((x + 2.0, y + 42.0, 44.0, 4.0), COPPER);
                    for tooth in 0_i16..3 {
                        let tx = x + 4.0 + f32::from(tooth) * 16.0;
                        let flicker = if (world.tick / 6) % 2 == 0 { 0.0 } else { 4.0 };
                        p.block((tx + 4.0, y + 8.0 + flicker, 4.0, 30.0 - flicker), CURRENT);
                        p.block((tx, y + 26.0, 12.0, 4.0), PAPER);
                        p.block((tx + 2.0, y + 2.0 + flicker, 8.0, 6.0), CURRENT);
                    }
                }
            }
        }
    }
}

fn objects(p: &mut Painter<'_>, camera: f32, world: &World) {
    let (x, y, w, h) = screen(world.exit, camera);
    p.block((x - 4.0, y - 6.0, w + 8.0, h + 6.0), INK);
    p.frame((x, y, w, h), COPPER);
    p.block((x + 4.0, y + 4.0, w - 8.0, h - 4.0), MIDNIGHT);
    p.block(
        (x + 12.0, y - 6.0, w - 24.0, 8.0),
        if world.player.has_core { SEED } else { GLASS },
    );
    if world.player.has_core {
        p.frame((x + 8.0, y + 10.0, w - 16.0, h - 14.0), CURRENT);
        p.leaf((x + w * 0.5 - 6.0, y + 24.0), SEED);
    } else {
        p.line((x + 6.0, y + 8.0), (x + w - 6.0, y + h - 8.0), GLASS);
        p.line((x + w - 6.0, y + 8.0), (x + 6.0, y + h - 8.0), GLASS);
    }
    for item in world.pickups.iter().filter(|item| item.active) {
        let (x, mut y, _, _) = screen(item.body, camera);
        y += if (world.tick / 20) % 2 == 0 {
            -2.0
        } else {
            2.0
        };
        match item.kind {
            PickupKind::Shard => seed(p, (x + 14.0, y + 14.0), false),
            PickupKind::Core => seed(p, (x + 14.0, y + 14.0), true),
            PickupKind::Blaster => {
                p.frame((x - 2.0, y - 2.0, 32.0, 32.0), COPPER);
                p.block((x + 4.0, y + 8.0, 22.0, 8.0), PAPER);
                p.block((x + 8.0, y + 16.0, 6.0, 10.0), COPPER);
                p.block((x + 24.0, y + 10.0, 6.0, 4.0), CURRENT);
            }
            PickupKind::Fuel => {
                p.frame((x + 2.0, y, 24.0, 28.0), COPPER);
                p.block((x + 6.0, y + 4.0, 6.0, 20.0), CURRENT);
                p.block((x + 16.0, y + 4.0, 6.0, 20.0), CURRENT);
                p.block((x + 10.0, y - 4.0, 8.0, 4.0), PAPER);
            }
        }
    }
    for enemy in world.enemies.iter().filter(|enemy| enemy.active) {
        let (x, y, w, _) = screen(enemy.body, camera);
        let stride = if (world.tick / 8) % 2 == 0 { 2.0 } else { 6.0 };
        match enemy.kind {
            EnemyKind::Crawler => {
                for foot in 0_i16..3 {
                    p.block(
                        (x + f32::from(foot) * 14.0, y + 30.0, 6.0, stride + 4.0),
                        COPPER,
                    );
                }
                p.block((x + 2.0, y + 12.0, w - 4.0, 20.0), INK);
                p.block((x + 6.0, y + 6.0, w - 12.0, 18.0), ORCHID);
                p.block((x + 12.0, y + 2.0, w - 24.0, 8.0), ORCHID);
            }
            EnemyKind::Sentry => {
                p.block((x - 10.0, y + stride, 16.0, 8.0), ORCHID);
                p.block((x + w - 6.0, y + stride, 16.0, 8.0), ORCHID);
                p.block((x + 4.0, y + 8.0, w - 8.0, 24.0), INK);
                p.frame((x + 6.0, y + 10.0, w - 12.0, 20.0), COPPER);
                p.block((x + w * 0.5 - 2.0, y + 30.0, 4.0, 8.0), ORCHID);
            }
        }
        let eye_x = if enemy.facing > 0 {
            x + w - 14.0
        } else {
            x + 8.0
        };
        p.block((eye_x, y + 14.0, 6.0, 6.0), CORAL);
    }
    for shot in world.shots.iter().filter(|shot| shot.active) {
        let (x, y, w, h) = screen(shot.body, camera);
        let color = if shot.hostile { CORAL } else { CURRENT };
        p.block((x - 4.0, y + 2.0, w + 8.0, (h - 4.0).max(2.0)), color);
        p.block((x, y, w, h), PAPER);
    }
}

fn seed(p: &mut Painter<'_>, center: (f32, f32), core: bool) {
    let (x, y) = center;
    if core {
        p.frame((x - 18.0, y - 18.0, 36.0, 36.0), GLASS);
        p.leaf((x - 18.0, y - 14.0), SEED);
        p.leaf((x + 6.0, y + 8.0), SEED);
        p.block((x - 6.0, y - 18.0, 12.0, 36.0), SEED);
        p.block((x - 18.0, y - 6.0, 36.0, 12.0), SEED);
        p.block((x - 6.0, y - 6.0, 12.0, 12.0), COPPER);
    } else {
        p.block((x - 2.0, y - 10.0, 4.0, 4.0), SEED);
        p.block((x - 6.0, y - 6.0, 12.0, 14.0), SEED);
        p.block((x - 2.0, y + 8.0, 4.0, 4.0), LEAF);
        p.block((x - 2.0, y - 2.0, 4.0, 6.0), PAPER);
    }
}

fn protagonist(p: &mut Painter<'_>, camera: f32, world: &World) {
    let player = &world.player;
    if player.invulnerable > 0 && (world.tick / 5) % 2 == 1 {
        return;
    }
    let (x, y, w, h) = screen(player.body, camera);
    let forward = player.facing > 0;
    let pack_x = if forward { x - 6.0 } else { x + w - 6.0 };
    p.block((pack_x, y + 14.0, 12.0, 22.0), INK);
    p.block((pack_x + 2.0, y + 16.0, 8.0, 14.0), TRELLIS);
    p.block((pack_x + 4.0, y + 18.0, 4.0, 8.0), CURRENT);
    if !player.grounded && player.vy < 0.0 && player.fuel > 0 {
        let length = if (world.tick / 3) % 2 == 0 {
            14.0
        } else {
            22.0
        };
        p.block((pack_x + 4.0, y + 36.0, 4.0, length), CURRENT);
        p.block((pack_x + 2.0, y + 34.0, 8.0, 6.0), PAPER);
    }
    p.block((x + 4.0, y + 6.0, w - 8.0, h - 6.0), INK);
    p.block((x + 6.0, y + 18.0, w - 12.0, 20.0), CORAL);
    p.block((x + 8.0, y + 2.0, w - 16.0, 22.0), CORAL);
    p.block((x + 4.0, y + 8.0, w - 8.0, 12.0), CORAL);
    let visor = if forward { x + 14.0 } else { x + 4.0 };
    p.block((visor, y + 10.0, 18.0, 10.0), INK);
    p.block((visor + 4.0, y + 12.0, 10.0, 4.0), PAPER);
    p.block((x + 8.0, y + 32.0, 20.0, 4.0), COPPER);
    let step = if player.grounded && player.vx.abs() > 0.1 && (world.tick / 6) % 2 == 0 {
        4.0
    } else {
        0.0
    };
    p.block((x + 4.0 + step, y + h - 8.0, 10.0, 8.0), INK);
    p.block((x + 22.0 - step, y + h - 8.0, 10.0, 8.0), INK);
    if player.has_blaster {
        let hand = if forward { x + w - 4.0 } else { x - 8.0 };
        p.block((hand, y + 24.0, 12.0, 6.0), PAPER);
        p.block((hand, y + 30.0, 6.0, 4.0), COPPER);
    }
    if player.has_core {
        p.block((x + 14.0, y - 8.0, 8.0, 4.0), SEED);
    }
}

fn instruments(p: &mut Painter<'_>, world: &World) {
    p.block((0.0, 0.0, 960.0, 64.0), INK);
    p.block((0.0, 62.0, 960.0, 2.0), COPPER);
    p.text("STORM GARDEN", (20.0, 12.0), (2, PAPER));
    p.text(
        &format!("{:02} / {}", world.level_index + 1, world.level_name),
        (20.0, 38.0),
        (1, CURRENT),
    );
    p.text("SEEDS", (284.0, 12.0), (1, LEAF));
    p.text(&format!("{:06}", world.score), (284.0, 30.0), (2, PAPER));
    p.text("HEARTS", (404.0, 12.0), (1, LEAF));
    for index in 0..world.lives {
        let x = 404.0 + f32::from(index) * 22.0;
        p.block((x, 32.0, 6.0, 6.0), CORAL);
        p.block((x + 10.0, 32.0, 6.0, 6.0), CORAL);
        p.block((x, 38.0, 16.0, 6.0), CORAL);
        p.block((x + 4.0, 44.0, 8.0, 4.0), CORAL);
    }
    p.text("CHARGE", (522.0, 12.0), (1, CURRENT));
    for cell in 0_u16..14 {
        let color = if world.player.fuel > cell * (MAX_FUEL / 14) {
            CURRENT
        } else {
            STORM
        };
        p.block((522.0 + f32::from(cell) * 9.0, 32.0, 6.0, 14.0), color);
    }
    p.text(
        if world.player.has_core {
            "SUNSEED READY"
        } else {
            "FIND SUNSEED"
        },
        (672.0, 12.0),
        (1, SEED),
    );
    p.text(
        if world.player.has_blaster {
            "PULSE ONLINE"
        } else {
            "PULSE --"
        },
        (672.0, 36.0),
        (1, PAPER),
    );
    p.frame((888.0, 8.0, 56.0, 40.0), GLASS);
    p.block((906.0, 18.0, 6.0, 20.0), PAPER);
    p.block((920.0, 18.0, 6.0, 20.0), PAPER);
}

fn controls(p: &mut Painter<'_>, touch: bool, world: &World) {
    p.block((0.0, 544.0, 960.0, 96.0), INK);
    p.block((0.0, 544.0, 960.0, 2.0), COPPER);
    if touch {
        for (x, width, label, color) in [
            (16.0, 88.0, "<", PAPER),
            (112.0, 88.0, ">", PAPER),
            (640.0, 88.0, "FLY", CURRENT),
            (736.0, 88.0, "PULSE", PAPER),
            (832.0, 112.0, "JUMP", SEED),
        ] {
            p.block((x, 552.0, width, 72.0), MIDNIGHT);
            p.frame((x, 552.0, width, 72.0), color);
            let text_width =
                f32::from(u16::try_from(lettering::measure(label).0).unwrap_or(0)) * 2.0;
            p.text(label, (x + (width - text_width) * 0.5, 580.0), (2, color));
        }
        for cell in 0_u16..7 {
            let color = if world.player.fuel > cell * (MAX_FUEL / 7) {
                CURRENT
            } else {
                STORM
            };
            p.block((650.0 + f32::from(cell) * 10.0, 610.0, 6.0, 4.0), color);
        }
        p.text("GROW A WAY", (282.0, 574.0), (2, LEAF));
        p.text("THROUGH THE STORM", (264.0, 598.0), (1, CURRENT));
    } else {
        p.text("MOVE  A/D  ARROWS", (24.0, 562.0), (1, PAPER));
        p.text("JUMP  SPACE / W", (24.0, 584.0), (1, PAPER));
        p.text("PULSE  J / CTRL", (250.0, 562.0), (1, PAPER));
        p.text("FLIGHT  K / SHIFT", (250.0, 584.0), (1, CURRENT));
        p.text("ESC  SHELTER BREAK", (510.0, 562.0), (1, PAPER));
        p.text("R  RESTART GARDEN", (510.0, 584.0), (1, PAPER));
        p.text("FIND SEED > REACH ARCH", (24.0, 614.0), (1, SEED));
        p.text(world.level_hint, (300.0, 614.0), (1, LEAF));
    }
}

fn overlay(p: &mut Painter<'_>, world: &World, touch: bool) {
    let (eyebrow, heading, description, action) = match world.mode {
        Mode::Playing => return,
        Mode::Title => (
            "AN ORIGINAL BOTANICAL ADVENTURE",
            "DANGEROUS GABE",
            "THE STORM GARDEN",
            "ENTER THE GARDEN",
        ),
        Mode::Paused => (
            "TAKE A BREATH",
            "SHELTER BREAK",
            "THE GARDEN WILL WAIT FOR YOU.",
            "RESUME",
        ),
        Mode::LevelComplete => (
            "SUNSEED DELIVERED",
            "GARDEN RESTORED",
            "ANOTHER GARDEN BREATHES.",
            if world.level_index + 1 == crate::levels::CAMPAIGN_LEN {
                "FINISH THE JOURNEY"
            } else {
                "ON TO THE NEXT GARDEN"
            },
        ),
        Mode::Victory => (
            "ALL GARDENS RESTORED",
            "THE SKY IS ALIVE",
            "THE STORM HAS A GARDENER.",
            "GROW AGAIN",
        ),
        Mode::Defeat => (
            "THE WIND WON THIS ROUND",
            "ROOTS REMAIN",
            "EVERY GARDENER STARTS AGAIN.",
            "TRY AGAIN",
        ),
    };
    p.block((86.0, 100.0, 800.0, 422.0), INK);
    p.block((80.0, 94.0, 800.0, 422.0), MIDNIGHT);
    p.frame((80.0, 94.0, 800.0, 422.0), COPPER);
    p.frame((90.0, 104.0, 780.0, 402.0), GLASS);
    if world.mode == Mode::Victory {
        p.centered(
            &format!("ALL {} GARDENS RESTORED", crate::levels::CAMPAIGN_LEN),
            124.0,
            (1, CURRENT),
        );
    } else {
        p.centered(eyebrow, 124.0, (1, CURRENT));
    }
    p.centered(heading, 164.0, (5, PAPER));
    p.centered(description, 222.0, (2, LEAF));
    seed(p, (480.0, 284.0), true);
    p.line((292.0, 284.0), (430.0, 284.0), GLASS);
    p.line((530.0, 284.0), (668.0, 284.0), GLASS);
    if world.mode == Mode::Paused && touch {
        p.block((240.0, 336.0, 480.0, 52.0), SEED);
        p.centered("RESUME", 355.0, (2, INK));
        p.frame((240.0, 416.0, 480.0, 64.0), CORAL);
        p.centered("RESTART GARDEN", 441.0, (2, CORAL));
        p.centered(
            "TAP RESTART OR PRESS R. TAP ELSEWHERE TO RESUME.",
            494.0,
            (1, PAPER),
        );
        return;
    }
    if world.mode == Mode::Title {
        p.centered("FIND THE SUNSEED. WAKE THE ARCH.", 326.0, (2, PAPER));
        p.centered(
            "JUMP THE STORM BEDS. KEEP YOUR CHARGE.",
            354.0,
            (1, CURRENT),
        );
    } else {
        p.centered(
            &format!(
                "GARDEN {:02}     SEEDS {:06}",
                world.level_index + 1,
                world.score
            ),
            330.0,
            (2, PAPER),
        );
        p.centered(
            if world.mode == Mode::Paused {
                "R: RESTART THIS GARDEN"
            } else {
                world.level_name
            },
            360.0,
            (1, CURRENT),
        );
    }
    p.block((234.0, 400.0, 492.0, 52.0), SEED);
    p.centered(action, 419.0, (2, INK));
    p.centered(
        if touch {
            "TAP TO CONTINUE"
        } else {
            "ENTER / SPACE TO CONTINUE"
        },
        476.0,
        (1, PAPER),
    );
}
