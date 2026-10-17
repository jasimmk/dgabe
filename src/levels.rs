//! Original storm-garden campaign layouts, expressed in tile coordinates.

use crate::simulation::{Enemy, EnemyKind, MAX_FUEL, Pickup, PickupKind, Rect, TILE_SIZE, Tile};

pub const CAMPAIGN_LEN: usize = 12;

pub struct Stage {
    pub name: &'static str,
    pub hint: &'static str,
    pub width: u16,
    pub height: u16,
    pub tiles: Vec<Tile>,
    pub spawn: Rect,
    pub exit: Rect,
    pub pickups: Vec<Pickup>,
    pub enemies: Vec<Enemy>,
    pub charge_per_cell: u16,
}

impl Stage {
    fn strip(&mut self, row: u16, columns: std::ops::Range<u16>, tile: Tile) {
        for column in columns {
            let index = usize::from(row) * usize::from(self.width) + usize::from(column);
            if let Some(cell) = self.tiles.get_mut(index) {
                *cell = tile;
            }
        }
    }

    fn item(&mut self, position: (u16, u16), kind: PickupKind) {
        self.pickups.push(Pickup {
            body: Rect::new(
                (
                    f32::from(position.0) * TILE_SIZE + 5.0,
                    f32::from(position.1) * TILE_SIZE + 5.0,
                ),
                (14.0, 14.0),
            ),
            kind,
            active: true,
        });
    }

    fn machine(&mut self, lane: (u16, std::ops::Range<u16>), kind: EnemyKind) {
        let (row, span) = lane;
        self.enemies.push(Enemy {
            body: Rect::new(
                (
                    f32::from(span.start) * TILE_SIZE,
                    f32::from(row) * TILE_SIZE - 20.0,
                ),
                (20.0, 20.0),
            ),
            kind,
            active: true,
            facing: -1,
            left: f32::from(span.start) * TILE_SIZE,
            right: f32::from(span.end) * TILE_SIZE,
            cooldown: 90,
        });
    }
}

/// Builds a fresh stage; indices outside the campaign return `None`.
pub fn build(index: usize) -> Option<Stage> {
    let (name, hint, width) = match index {
        0 => (
            "Rainwake Nursery",
            "Find the sunseed. Carry it to the arch.",
            36,
        ),
        1 => (
            "Copper Canopy",
            "Jump storm beds. Pulse clears rogue tenders.",
            40,
        ),
        2 => (
            "Cloudroot Lift",
            "Clear the landing. Fly the missing bridge.",
            44,
        ),
        3 => (
            "Glasswind Gallery",
            "Climb for charge. Watch the upper sentry.",
            42,
        ),
        4 => (
            "Thunder Orchard",
            "Short cells: glide, land, then cross again.",
            48,
        ),
        5 => (
            "Eye of the Garden",
            "Refill on the trellis. Brave both crossings.",
            54,
        ),
        6 => (
            "Ashglass Foundry",
            "Climb the hot trays. Save lift for the gap.",
            60,
        ),
        7 => (
            "Lightning Aqueduct",
            "Three broken spans. Land to recharge.",
            66,
        ),
        8 => (
            "Blackthorn Relay",
            "Claim the high seed, then descend carefully.",
            66,
        ),
        9 => (
            "Cyclone Conservatory",
            "Take the roof route. Clear each landing.",
            70,
        ),
        10 => (
            "Starfall Engine",
            "Four crossings. Trade height for distance.",
            76,
        ),
        11 => (
            "Dawnseed Crown",
            "Earn the dawnseed. Bring it safely home.",
            84,
        ),
        _ => return None,
    };
    let height = 10;
    let mut stage = Stage {
        name,
        hint,
        width,
        height,
        tiles: vec![Tile::Empty; usize::from(width) * usize::from(height)],
        spawn: Rect::new((48.0, 194.0), (18.0, 22.0)),
        exit: Rect::new((f32::from(width - 3) * TILE_SIZE, 178.0), (30.0, 38.0)),
        pickups: Vec::with_capacity(24),
        enemies: Vec::with_capacity(6),
        charge_per_cell: match index {
            0..=2 => MAX_FUEL,
            3 => 260,
            4 => 150,
            5 => 110,
            6 | 7 => 100,
            8 | 9 => 95,
            10 => 90,
            11 => 85,
            _ => return None,
        },
    };
    stage.strip(9, 0..width, Tile::Wall);
    stage.strip(7, 6..10, Tile::Wall);
    stage.item((7, 6), PickupKind::Shard);
    stage.item((9, 6), PickupKind::Shard);
    stage.item((4, 8), PickupKind::Blaster);
    for column in (5..width - 3).step_by(5) {
        stage.item((column, 8), PickupKind::Shard);
    }
    match index {
        0 => {
            stage.strip(8, 14..16, Tile::Hazard);
            stage.strip(7, 21..25, Tile::Wall);
            stage.item((23, 6), PickupKind::Core);
            stage.machine((7, 24..25), EnemyKind::Crawler);
            stage.machine((9, 27..31), EnemyKind::Crawler);
        }
        1 => {
            stage.strip(8, 12..14, Tile::Hazard);
            stage.strip(8, 24..26, Tile::Hazard);
            stage.strip(7, 18..22, Tile::Wall);
            stage.strip(5, 22..26, Tile::Wall);
            stage.item((24, 4), PickupKind::Core);
            stage.machine((5, 25..26), EnemyKind::Crawler);
            stage.machine((9, 15..18), EnemyKind::Crawler);
            stage.machine((9, 29..33), EnemyKind::Sentry);
        }
        2 => {
            stage.item((10, 8), PickupKind::Fuel);
            stage.strip(8, 12..14, Tile::Hazard);
            stage.machine((9, 14..16), EnemyKind::Crawler);
            stage.strip(9, 16..24, Tile::Empty);
            stage.strip(7, 27..31, Tile::Wall);
            stage.item((29, 6), PickupKind::Core);
            stage.machine((7, 30..31), EnemyKind::Crawler);
            stage.item((30, 5), PickupKind::Fuel);
            stage.machine((9, 31..33), EnemyKind::Sentry);
            stage.machine((9, 36..40), EnemyKind::Crawler);
        }
        3 => {
            stage.strip(7, 13..17, Tile::Wall);
            stage.strip(5, 18..22, Tile::Wall);
            stage.strip(3, 23..28, Tile::Wall);
            stage.item((25, 2), PickupKind::Core);
            stage.item((14, 6), PickupKind::Fuel);
            stage.machine((5, 20..22), EnemyKind::Crawler);
            stage.machine((9, 18..22), EnemyKind::Crawler);
            stage.machine((3, 27..28), EnemyKind::Sentry);
            stage.strip(8, 30..33, Tile::Hazard);
            stage.machine((9, 34..38), EnemyKind::Sentry);
        }
        4 => {
            stage.machine((9, 8..10), EnemyKind::Sentry);
            stage.strip(8, 11..13, Tile::Hazard);
            stage.item((15, 8), PickupKind::Fuel);
            stage.machine((9, 16..18), EnemyKind::Crawler);
            stage.strip(8, 18..20, Tile::Hazard);
            stage.strip(9, 20..29, Tile::Empty);
            stage.strip(7, 30..34, Tile::Wall);
            stage.item((32, 6), PickupKind::Core);
            stage.machine((7, 30..32), EnemyKind::Crawler);
            stage.item((31, 8), PickupKind::Fuel);
            stage.strip(9, 40..44, Tile::Empty);
            stage.machine((9, 35..39), EnemyKind::Sentry);
            stage.machine((9, 45..47), EnemyKind::Crawler);
        }
        5 => {
            stage.item((11, 8), PickupKind::Fuel);
            stage.strip(8, 14..17, Tile::Hazard);
            stage.machine((9, 18..21), EnemyKind::Crawler);
            stage.item((22, 8), PickupKind::Fuel);
            stage.machine((9, 23..24), EnemyKind::Sentry);
            stage.strip(9, 25..34, Tile::Empty);
            stage.strip(7, 35..39, Tile::Wall);
            stage.item((36, 6), PickupKind::Fuel);
            stage.machine((7, 38..39), EnemyKind::Sentry);
            stage.strip(5, 39..43, Tile::Wall);
            stage.item((41, 4), PickupKind::Core);
            stage.machine((9, 20..22), EnemyKind::Crawler);
            stage.strip(9, 43..48, Tile::Empty);
            stage.machine((5, 42..43), EnemyKind::Sentry);
            stage.machine((9, 49..51), EnemyKind::Crawler);
        }
        6 => {
            stage.machine((9, 8..10), EnemyKind::Sentry);
            stage.item((11, 8), PickupKind::Fuel);
            stage.strip(8, 14..16, Tile::Hazard);
            stage.strip(4, 12..17, Tile::Wall);
            stage.machine((9, 16..18), EnemyKind::Crawler);
            stage.strip(9, 18..26, Tile::Empty);
            stage.strip(7, 27..31, Tile::Wall);
            stage.item((28, 6), PickupKind::Fuel);
            stage.machine((7, 30..31), EnemyKind::Sentry);
            stage.machine((9, 32..33), EnemyKind::Crawler);
            stage.strip(5, 33..37, Tile::Wall);
            stage.item((34, 4), PickupKind::Fuel);
            stage.item((35, 4), PickupKind::Core);
            stage.machine((5, 36..37), EnemyKind::Sentry);
            stage.strip(9, 40..47, Tile::Empty);
            stage.strip(8, 50..52, Tile::Hazard);
            stage.machine((9, 53..54), EnemyKind::Sentry);
            stage.machine((9, 55..57), EnemyKind::Crawler);
        }
        7 => {
            stage.machine((9, 8..10), EnemyKind::Sentry);
            stage.item((11, 8), PickupKind::Fuel);
            stage.strip(8, 14..16, Tile::Hazard);
            stage.machine((9, 16..18), EnemyKind::Crawler);
            stage.strip(9, 18..25, Tile::Empty);
            stage.strip(7, 26..31, Tile::Wall);
            stage.item((27, 6), PickupKind::Fuel);
            stage.machine((7, 30..31), EnemyKind::Sentry);
            stage.strip(9, 32..39, Tile::Empty);
            stage.strip(7, 40..45, Tile::Wall);
            stage.item((41, 6), PickupKind::Fuel);
            stage.machine((7, 44..45), EnemyKind::Sentry);
            stage.machine((9, 44..46), EnemyKind::Crawler);
            stage.strip(9, 46..52, Tile::Empty);
            stage.strip(7, 53..58, Tile::Wall);
            stage.item((54, 6), PickupKind::Fuel);
            stage.item((55, 6), PickupKind::Core);
            stage.machine((7, 57..58), EnemyKind::Sentry);
            stage.machine((9, 58..60), EnemyKind::Sentry);
            stage.machine((9, 60..62), EnemyKind::Crawler);
        }
        8 => {
            stage.machine((9, 8..10), EnemyKind::Sentry);
            stage.item((11, 8), PickupKind::Fuel);
            stage.strip(8, 14..17, Tile::Hazard);
            stage.machine((9, 17..19), EnemyKind::Crawler);
            stage.strip(9, 19..27, Tile::Empty);
            stage.strip(7, 28..32, Tile::Wall);
            stage.item((29, 6), PickupKind::Fuel);
            stage.machine((7, 31..32), EnemyKind::Sentry);
            stage.strip(5, 33..37, Tile::Wall);
            stage.strip(3, 37..41, Tile::Wall);
            stage.item((34, 4), PickupKind::Fuel);
            stage.item((38, 2), PickupKind::Fuel);
            stage.item((39, 2), PickupKind::Core);
            stage.machine((5, 36..37), EnemyKind::Sentry);
            stage.machine((3, 40..41), EnemyKind::Sentry);
            stage.machine((9, 33..35), EnemyKind::Crawler);
            stage.strip(9, 42..49, Tile::Empty);
            stage.item((50, 8), PickupKind::Fuel);
            stage.machine((9, 52..54), EnemyKind::Crawler);
            stage.strip(9, 54..60, Tile::Empty);
            stage.machine((9, 62..63), EnemyKind::Sentry);
            stage.machine((9, 64..65), EnemyKind::Sentry);
        }
        9 => {
            stage.machine((9, 33..35), EnemyKind::Crawler);
            stage.item((11, 8), PickupKind::Fuel);
            stage.machine((9, 8..10), EnemyKind::Sentry);
            stage.strip(8, 14..17, Tile::Hazard);
            stage.machine((9, 17..19), EnemyKind::Crawler);
            stage.strip(9, 19..27, Tile::Empty);
            stage.strip(7, 28..32, Tile::Wall);
            stage.item((29, 6), PickupKind::Fuel);
            stage.machine((7, 31..32), EnemyKind::Sentry);
            stage.strip(5, 33..37, Tile::Wall);
            stage.strip(3, 37..41, Tile::Wall);
            stage.strip(1, 41..45, Tile::Wall);
            stage.item((34, 4), PickupKind::Fuel);
            stage.item((38, 2), PickupKind::Fuel);
            stage.item((42, 0), PickupKind::Fuel);
            stage.item((43, 0), PickupKind::Core);
            stage.machine((5, 36..37), EnemyKind::Sentry);
            stage.machine((3, 40..41), EnemyKind::Sentry);
            stage.strip(9, 43..51, Tile::Empty);
            stage.strip(7, 52..56, Tile::Wall);
            stage.item((53, 6), PickupKind::Fuel);
            stage.machine((7, 55..56), EnemyKind::Sentry);
            stage.machine((9, 56..58), EnemyKind::Crawler);
            stage.strip(9, 58..65, Tile::Empty);
            stage.machine((9, 67..68), EnemyKind::Sentry);
            stage.machine((9, 68..69), EnemyKind::Crawler);
        }
        10 => {
            stage.machine((9, 16..17), EnemyKind::Sentry);
            stage.machine((9, 8..10), EnemyKind::Sentry);
            stage.item((11, 8), PickupKind::Fuel);
            stage.strip(8, 14..17, Tile::Hazard);
            stage.machine((9, 17..19), EnemyKind::Crawler);
            stage.strip(9, 19..26, Tile::Empty);
            stage.strip(7, 27..31, Tile::Wall);
            stage.item((28, 6), PickupKind::Fuel);
            stage.machine((7, 30..31), EnemyKind::Sentry);
            stage.strip(9, 33..41, Tile::Empty);
            stage.strip(7, 42..46, Tile::Wall);
            stage.item((43, 6), PickupKind::Fuel);
            stage.machine((7, 45..46), EnemyKind::Sentry);
            stage.strip(5, 46..50, Tile::Wall);
            stage.item((47, 4), PickupKind::Fuel);
            stage.machine((5, 49..50), EnemyKind::Sentry);
            stage.machine((9, 46..48), EnemyKind::Crawler);
            stage.strip(9, 50..57, Tile::Empty);
            stage.strip(7, 58..62, Tile::Wall);
            stage.item((59, 6), PickupKind::Fuel);
            stage.item((60, 6), PickupKind::Core);
            stage.machine((7, 61..62), EnemyKind::Sentry);
            stage.machine((9, 62..64), EnemyKind::Crawler);
            stage.strip(9, 64..70, Tile::Empty);
            stage.machine((9, 72..73), EnemyKind::Sentry);
            stage.machine((9, 73..75), EnemyKind::Crawler);
        }
        11 => {
            stage.machine((9, 16..17), EnemyKind::Sentry);
            stage.machine((9, 8..10), EnemyKind::Sentry);
            stage.item((11, 8), PickupKind::Fuel);
            stage.strip(8, 14..17, Tile::Hazard);
            stage.machine((9, 17..19), EnemyKind::Crawler);
            stage.strip(9, 19..27, Tile::Empty);
            stage.strip(7, 28..32, Tile::Wall);
            stage.item((29, 6), PickupKind::Fuel);
            stage.machine((7, 31..32), EnemyKind::Sentry);
            stage.strip(9, 34..42, Tile::Empty);
            stage.strip(7, 43..47, Tile::Wall);
            stage.item((44, 6), PickupKind::Fuel);
            stage.machine((7, 46..47), EnemyKind::Sentry);
            stage.strip(5, 47..51, Tile::Wall);
            stage.strip(3, 51..55, Tile::Wall);
            stage.strip(1, 55..59, Tile::Wall);
            stage.item((48, 4), PickupKind::Fuel);
            stage.item((52, 2), PickupKind::Fuel);
            stage.item((56, 0), PickupKind::Fuel);
            stage.item((57, 0), PickupKind::Core);
            stage.machine((5, 50..51), EnemyKind::Sentry);
            stage.machine((3, 54..55), EnemyKind::Sentry);
            stage.machine((9, 47..49), EnemyKind::Crawler);
            stage.strip(9, 57..65, Tile::Empty);
            stage.strip(7, 66..70, Tile::Wall);
            stage.item((67, 6), PickupKind::Fuel);
            stage.machine((7, 69..70), EnemyKind::Sentry);
            stage.machine((9, 70..72), EnemyKind::Crawler);
            stage.strip(9, 72..79, Tile::Empty);
            stage.machine((9, 81..82), EnemyKind::Sentry);
        }
        _ => return None,
    }
    stage.pickups.retain(|pickup| match pickup.kind {
        PickupKind::Shard => !stage.tiles.iter().enumerate().any(|(offset, tile)| {
            let row = offset / usize::from(width);
            let column = offset % usize::from(width);
            let Ok(row) = u16::try_from(row) else {
                return false;
            };
            let Ok(column) = u16::try_from(column) else {
                return false;
            };
            match tile {
                Tile::Hazard => pickup.body.overlaps(Rect::tile(column, row)),
                Tile::Empty | Tile::Wall => false,
            }
        }),
        PickupKind::Core | PickupKind::Blaster | PickupKind::Fuel => true,
    });
    Some(stage)
}
