use std::collections::BTreeSet;

use dangerous_gabe::levels;
use dangerous_gabe::simulation::{
    Enemy, EnemyKind, Input, MAX_FUEL, Mode, Pickup, PickupKind, Rect, TILE_SIZE, Tile, World,
};

fn arena(index: usize) -> World {
    let mut world = World::new();
    assert!(world.load_level(index));
    world.tiles.fill(Tile::Empty);
    for column in 0..world.width {
        let offset = usize::from(world.height - 1) * usize::from(world.width) + usize::from(column);
        world.tiles[offset] = Tile::Wall;
    }
    world.pickups.clear();
    world.enemies.clear();
    world.shots.clear();
    world.player.invulnerable = 0;
    world.step(Input::default());
    world
}

fn in_bounds(body: Rect, dimensions: (u16, u16)) -> bool {
    [body.x, body.y, body.w, body.h]
        .iter()
        .all(|value| value.is_finite())
        && body.x >= 0.0
        && body.y >= 0.0
        && body.w > 0.0
        && body.h > 0.0
        && body.x + body.w <= f32::from(dimensions.0) * TILE_SIZE
        && body.y + body.h <= f32::from(dimensions.1) * TILE_SIZE
}

fn blocked(world: &World, body: Rect) -> bool {
    (0..world.height).any(|row| {
        (0..world.width).any(|column| {
            world.tile_at(column, row) != Tile::Empty && body.overlaps(Rect::tile(column, row))
        })
    })
}

#[test]
fn campaign_has_twelve_distinct_complete_playable_definitions() {
    // Given: the shipped campaign, with no prepared world state.
    let mut names = BTreeSet::new();
    let mut layouts = Vec::new();

    // When: every declared stage is built through its public content boundary.
    for index in 0..levels::CAMPAIGN_LEN {
        let Some(stage) = levels::build(index) else {
            panic!("declared stage {index} must build");
        };
        let dimensions = (stage.width, stage.height);

        // Then: content fits its map and provides a safe start, objective and tools.
        assert!(names.insert(stage.name), "duplicate stage name at {index}");
        assert_eq!(
            stage.tiles.len(),
            usize::from(stage.width) * usize::from(stage.height)
        );
        assert!(
            in_bounds(stage.spawn, dimensions),
            "spawn outside stage{index}"
        );
        assert!(
            in_bounds(stage.exit, dimensions),
            "exit outside stage{index}"
        );
        assert!((1..=MAX_FUEL).contains(&stage.charge_per_cell));
        assert_eq!(
            stage
                .pickups
                .iter()
                .filter(|item| matches!(item.kind, PickupKind::Core))
                .count(),
            1
        );
        assert!(
            stage
                .pickups
                .iter()
                .any(|item| matches!(item.kind, PickupKind::Blaster))
        );
        assert!(
            stage
                .pickups
                .iter()
                .all(|item| in_bounds(item.body, dimensions))
        );
        assert!(
            stage
                .enemies
                .iter()
                .all(|enemy| in_bounds(enemy.body, dimensions)
                    && enemy.left >= 0.0
                    && enemy.right <= f32::from(stage.width) * TILE_SIZE
                    && enemy.left <= enemy.body.x
                    && enemy.body.x + enemy.body.w <= enemy.right
                    && !enemy.body.overlaps(stage.spawn))
        );
        for row in 0..stage.height {
            for column in 0..stage.width {
                let offset = usize::from(row) * usize::from(stage.width) + usize::from(column);
                if stage.tiles[offset] != Tile::Empty {
                    assert!(
                        !stage.spawn.overlaps(Rect::tile(column, row)),
                        "unsafe spawn stage{index}"
                    );
                }
            }
        }
        let layout = (stage.width, stage.tiles);
        assert!(
            !layouts.contains(&layout),
            "duplicate geometry at stage{index}"
        );
        layouts.push(layout);
    }
    assert!(names.len() >= 12);
}

#[test]
fn invalid_stage_selection_retains_an_active_world() {
    // Given: an active world with changed inventory and a live projectile.
    let mut world = arena(levels::CAMPAIGN_LEN - 1);
    world.player.fuel = 9;
    world.player.has_blaster = true;
    world.step(Input {
        right: true,
        fire: true,
        ..Input::default()
    });
    let before = (
        world.level_index,
        world.player.body,
        world.player.fuel,
        world.tick,
        world.score,
        world.lives,
        world.tiles.clone(),
        format!("{:?}", world.shots),
    );

    // When: out-of-campaign selections are requested.
    for index in [levels::CAMPAIGN_LEN, usize::MAX] {
        assert!(!world.load_level(index));
    }

    // Then: live gameplay state is retained and content lookup also rejects them.
    assert_eq!(
        before,
        (
            world.level_index,
            world.player.body,
            world.player.fuel,
            world.tick,
            world.score,
            world.lives,
            world.tiles.clone(),
            format!("{:?}", world.shots)
        )
    );
    assert!(levels::build(levels::CAMPAIGN_LEN).is_none());
    assert!(levels::build(usize::MAX).is_none());
}

#[test]
fn equal_input_steps_have_equal_displacement_and_opposing_buttons_cancel() {
    // Given: two identical clear arenas and a fixed number of logical steps.
    let mut short = arena(0);
    let mut long = arena(0);
    let start = short.player.body.x;
    let tick = long.tick;

    // When: one world advances twice as many rightward steps.
    for _ in 0..10 {
        short.step(Input {
            right: true,
            ..Input::default()
        });
    }
    for _ in 0..20 {
        long.step(Input {
            right: true,
            ..Input::default()
        });
    }

    // Then: distance scales with step count, without consulting wall time.
    assert!((long.player.body.x - start - 2.0 * (short.player.body.x - start)).abs() < 0.01);
    assert!(short.player.body.x > start);
    assert_eq!(long.tick - tick, 20);
    let position = long.player.body.x;
    long.step(Input {
        left: true,
        right: true,
        ..Input::default()
    });
    assert!((long.player.body.x - position).abs() < 0.001);
}

#[test]
fn gravity_lands_on_the_floor_without_penetration() {
    // Given: Gabe suspended above a solid floor.
    let mut world = arena(0);
    world.player.body.y = 40.0;
    world.player.grounded = false;

    // When: gravity acts for long enough to settle.
    for _ in 0..120 {
        world.step(Input::default());
    }

    // Then: Gabe rests above the floor instead of crossing it.
    assert!(world.player.grounded);
    assert!(
        (world.player.body.y + world.player.body.h - f32::from(world.height - 1) * TILE_SIZE).abs()
            < 0.001
    );
    assert!(!blocked(&world, world.player.body));
}

#[test]
fn a_solid_wall_blocks_horizontal_motion() {
    // Given: a wall directly ahead on otherwise clear ground.
    let mut world = arena(0);
    let column = 5_u16;
    let offset = usize::from(world.height - 2) * usize::from(world.width) + usize::from(column);
    world.tiles[offset] = Tile::Wall;

    // When: rightward input is held against the wall.
    for _ in 0..60 {
        world.step(Input {
            right: true,
            ..Input::default()
        });
    }

    // Then: the player's leading edge remains outside it.
    assert!(
        (world.player.body.x + world.player.body.w - f32::from(column) * TILE_SIZE).abs() < 0.001
    );
    assert!(!blocked(&world, world.player.body));
}

#[test]
fn jumping_requires_ground_contact_and_a_new_press() {
    // Given: Gabe grounded in an empty arena.
    let mut world = arena(0);
    let floor = world.player.body.y;

    // When: jump remains held past a full ascent and landing.
    world.step(Input {
        jump: true,
        ..Input::default()
    });
    assert!(world.player.body.y < floor && world.player.vy < 0.0);
    for _ in 0..90 {
        world.step(Input {
            jump: true,
            ..Input::default()
        });
    }

    // Then: holding the button has not started repeated jumps.
    assert!(world.player.grounded);
    assert!((world.player.body.y - floor).abs() < 0.001);
}

#[test]
fn the_arch_stays_locked_without_the_sunseed() {
    // Given: Gabe overlaps an exit without its objective.
    let mut world = arena(0);
    world.exit = world.player.body;

    // When: a gameplay step processes that overlap.
    world.step(Input::default());

    // Then: the garden remains active and awards no clear bonus.
    assert_eq!(world.mode, Mode::Playing);
    assert_eq!(world.score, 0);
}

#[test]
fn collecting_a_sunseed_unlocks_the_arch_and_awards_the_clear_once() {
    // Given: an isolated objective/exit overlap fixture, not a campaign route.
    let mut world = arena(0);
    world.exit = world.player.body;
    world.pickups.push(Pickup {
        body: world.player.body,
        kind: PickupKind::Core,
        active: true,
    });

    // When: normal collection and exit detection run.
    world.step(Input::default());
    for _ in 0..5 {
        world.step(Input::default());
    }

    // Then: the seed and clear bonus are awarded once while showing completion.
    assert_eq!(world.mode, Mode::LevelComplete);
    assert!(world.player.has_core);
    assert_eq!(world.score, 1050);
    assert!(!world.pickups[0].active);
}

#[test]
fn stage_cells_replace_charge_and_are_consumed_once() {
    // Given: every flight stage with a partial-stage allowance and excess old charge.
    for index in 0..levels::CAMPAIGN_LEN {
        let Some(stage) = levels::build(index) else {
            panic!("declared stage {index} must build");
        };
        if !stage
            .pickups
            .iter()
            .any(|item| matches!(item.kind, PickupKind::Fuel))
        {
            continue;
        }
        let mut world = arena(index);
        world.player.fuel = MAX_FUEL;
        world.pickups.push(Pickup {
            body: world.player.body,
            kind: PickupKind::Fuel,
            active: true,
        });

        // When: a stage-specific cell is collected without activating thrust.
        world.step(Input::default());

        // Then: it replaces charge rather than stacking or always filling the gauge.
        assert_eq!(world.player.fuel, stage.charge_per_cell);
        assert!(!world.pickups[0].active);
        world.player.fuel = 1;
        world.step(Input::default());
        assert_eq!(world.player.fuel, 1);
    }
}

#[test]
fn holding_thrust_exhausts_fuel_without_underflow_or_free_lift() {
    // Given: a small known reserve in a clear arena.
    let mut world = arena(0);
    world.player.fuel = 3;

    // When: thrust is held well beyond the reserve.
    for _ in 0..120 {
        world.step(Input {
            thrust: true,
            ..Input::default()
        });
    }

    // Then: charge is exhausted and gravity has returned Gabe to the floor.
    assert_eq!(world.player.fuel, 0);
    assert!(world.player.grounded);
}

#[test]
fn a_pulse_defeats_a_machine_and_awards_score_once() {
    // Given: an armed gardener faces a nearby crawler.
    let mut world = arena(0);
    world.player.has_blaster = true;
    world.enemies.push(Enemy {
        body: Rect::new((96.0, 196.0), (20.0, 20.0)),
        kind: EnemyKind::Crawler,
        active: true,
        facing: 1,
        left: 96.0,
        right: 144.0,
        cooldown: 100,
    });

    // When: repeated normal firing crosses the crawler's lane.
    for _ in 0..60 {
        world.step(Input {
            fire: true,
            ..Input::default()
        });
    }

    // Then: the defeated machine cannot award more score on later shots.
    assert!(!world.enemies[0].active);
    assert_eq!(world.score, 120);
}

#[test]
fn pulse_shots_cannot_pass_through_a_wall() {
    // Given: an armed gardener and a sentry separated by a solid tile.
    let mut world = arena(0);
    world.player.has_blaster = true;
    let offset = usize::from(world.height - 2) * usize::from(world.width) + 4;
    world.tiles[offset] = Tile::Wall;
    world.enemies.push(Enemy {
        body: Rect::new((144.0, 196.0), (20.0, 20.0)),
        kind: EnemyKind::Sentry,
        active: true,
        facing: -1,
        left: 144.0,
        right: 168.0,
        cooldown: u16::MAX,
    });

    // When: shots are fired repeatedly toward the obstruction.
    for _ in 0..60 {
        world.step(Input {
            fire: true,
            ..Input::default()
        });
    }

    // Then: the machine behind the wall remains alive and unscored.
    assert!(world.enemies[0].active);
    assert_eq!(world.score, 0);
}

#[test]
fn firing_without_the_sprayer_cannot_create_projectiles() {
    // Given: an unarmed gardener in a clear arena.
    let mut world = arena(0);

    // When: fire is held.
    for _ in 0..30 {
        world.step(Input {
            fire: true,
            ..Input::default()
        });
    }

    // Then: acquiring the sprayer remains a real requirement.
    assert!(world.shots.is_empty());
}

#[test]
fn a_hazard_death_resets_inventory_score_and_stage_content() {
    // Given: an exposed player with progress earned since entering the stage.
    let mut world = arena(0);
    world.score = 380;
    world.player.has_core = true;
    world.player.has_blaster = true;
    world.player.fuel = 9;
    let spawn = world.player.body;
    let lives = world.lives;
    let offset = usize::from(world.height - 2) * usize::from(world.width) + 2;
    world.tiles[offset] = Tile::Hazard;

    // When: the exposed body touches the hazard.
    world.step(Input::default());

    // Then: a life is spent and a fresh stage replaces the failed attempt.
    assert_eq!(world.lives, lives - 1);
    assert_eq!(world.score, 0);
    assert_eq!(world.player.body, spawn);
    assert!(!world.player.has_core && !world.player.has_blaster);
    assert_eq!(world.player.fuel, 0);
    assert!(world.player.invulnerable > 0);
    assert!(world.pickups.iter().all(|item| item.active));
    assert!(!world.enemies.is_empty() && world.enemies.iter().all(|enemy| enemy.active));
}

#[test]
fn spawn_grace_blocks_contact_damage_but_not_falling_out_of_the_world() {
    // Given: a protected gardener with a hazard underfoot.
    let mut world = arena(0);
    world.player.invulnerable = 10;
    let lives = world.lives;
    let offset = usize::from(world.height - 2) * usize::from(world.width) + 2;
    world.tiles[offset] = Tile::Hazard;

    // When: contact is followed by falling beyond the map boundary.
    world.step(Input::default());
    assert_eq!(world.lives, lives);
    world.player.body.y = f32::from(world.height) * TILE_SIZE + 50.0;
    world.step(Input::default());

    // Then: contact grace prevents only the contact loss, not the fall loss.
    assert_eq!(world.lives, lives - 1);
}

#[test]
fn pause_freezes_simulation_time_motion_charge_and_projectiles() {
    // Given: an armed, charged player pauses with a shot in flight.
    let mut world = arena(0);
    world.player.has_blaster = true;
    world.player.fuel = 20;
    world.step(Input {
        fire: true,
        ..Input::default()
    });
    world.step(Input {
        pause: true,
        ..Input::default()
    });
    let before = (
        world.tick,
        world.player.body,
        world.player.fuel,
        format!("{:?}", world.shots),
    );

    // When: movement, jump, fire and thrust remain active during the pause.
    for _ in 0..20 {
        world.step(Input {
            right: true,
            jump: true,
            fire: true,
            thrust: true,
            ..Input::default()
        });
    }

    // Then: the paused simulation has consumed none of that time or input.
    assert_eq!(world.mode, Mode::Paused);
    assert_eq!(
        before,
        (
            world.tick,
            world.player.body,
            world.player.fuel,
            format!("{:?}", world.shots)
        )
    );
}

#[test]
fn voluntary_retry_preserves_lives_and_restores_the_stage_entry_score() {
    // Given: a stage entered with a campaign score, followed by local progress.
    let mut world = World::new();
    world.score = 900;
    assert!(world.load_level(3));
    world.score = 1200;
    world.player.has_core = true;
    world.player.fuel = 4;
    world.player.body.x += 100.0;
    let lives = world.lives;

    // When: the player requests a voluntary retry.
    world.step(Input {
        restart: true,
        ..Input::default()
    });

    // Then: it resumes the same garden without spending a life or retaining local gains.
    assert_eq!(world.mode, Mode::Playing);
    assert_eq!(world.level_index, 3);
    assert_eq!(world.lives, lives);
    assert_eq!(world.score, 900);
    assert!(!world.player.has_core);
    assert_eq!(world.player.fuel, 0);
}
