#[path = "../src/levels.rs"]
mod levels;
#[path = "../src/simulation.rs"]
mod simulation;

use simulation::{Input, Mode, World};

fn advance(world: &mut World, input: Input) {
    world.step(input);
}

fn walk(world: &mut World, target: f32) {
    let attempts = world.lives;
    for _ in 0..900 {
        if (world.player.body.x - target).abs() < 3.5 {
            return;
        }
        if world.mode != Mode::Playing {
            break;
        }
        let input = Input {
            left: world.player.body.x > target,
            right: world.player.body.x < target,
            fire: true,
            ..Input::default()
        };
        let position = world.player.body;
        advance(world, input);
        assert_eq!(
            world.lives,
            attempts,
            "walk toward {target} lost a life in stage{} at {position:?}",
            world.level_index + 1
        );
    }
    assert!(
        (world.player.body.x - target).abs() < 3.5,
        "walk {} to {target}: {:?} x{} y{} lives{}",
        world.level_index,
        world.mode,
        world.player.body.x,
        world.player.body.y,
        world.lives
    );
}

fn land(world: &mut World) {
    let attempts = world.lives;
    for _ in 0..300 {
        let position = world.player.body;
        advance(
            world,
            Input {
                fire: true,
                ..Input::default()
            },
        );
        assert_eq!(
            world.lives,
            attempts,
            "landing lost a life in stage{} at {position:?}",
            world.level_index + 1
        );
        if world.player.grounded {
            return;
        }
    }
    panic!(
        "landing failed stage{} at {:?}",
        world.level_index, world.player
    );
}

fn jump(world: &mut World, target: f32) {
    advance(world, Input::default());
    advance(
        world,
        Input {
            jump: true,
            ..Input::default()
        },
    );
    walk(world, target);
    land(world);
}

fn fly(world: &mut World, target: f32) {
    let attempts = world.lives;
    for _ in 0..600 {
        if (world.player.body.x - target).abs() < 3.5 {
            land(world);
            return;
        }
        let input = Input {
            left: world.player.body.x > target,
            right: world.player.body.x < target,
            thrust: true,
            fire: true,
            ..Input::default()
        };
        advance(world, input);
        assert_eq!(
            world.lives,
            attempts,
            "flight toward {target} lost a life in stage{}",
            world.level_index + 1
        );
    }
    panic!(
        "flight failed stage{} at {:?}",
        world.level_index, world.player
    );
}

fn clear_ahead(world: &mut World) {
    let attempts = world.lives;
    for _ in 0..80 {
        let position = world.player.body;
        let dodge = world.player.grounded
            && world.shots.iter().any(|shot| {
                shot.hostile
                    && shot.active
                    && shot.vx < 0.0
                    && shot.body.x > position.x
                    && shot.body.x < position.x + 70.0
                    && shot.body.y < position.y + position.h
                    && shot.body.y + shot.body.h > position.y
            });
        advance(
            world,
            Input {
                fire: true,
                jump: dodge,
                ..Input::default()
            },
        );
        assert_eq!(
            world.lives,
            attempts,
            "clearing lost a life in stage{} at {position:?}",
            world.level_index + 1
        );
    }
    if !world.player.grounded {
        land(world);
    }
}

fn route(world: &mut World) {
    let index = world.level_index;
    let attempts = world.lives;
    match index {
        0 => {
            walk(world, 288.0);
            jump(world, 432.0);
            walk(world, 460.0);
            jump(world, 558.0);
            clear_ahead(world);
            walk(world, 610.0);
            land(world);
        }
        1 => {
            walk(world, 250.0);
            jump(world, 370.0);
            walk(world, 390.0);
            jump(world, 470.0);
            jump(world, 582.0);
            clear_ahead(world);
            walk(world, 650.0);
            land(world);
        }
        2 => {
            walk(world, 250.0);
            fly(world, 704.0);
            walk(world, 755.0);
            land(world);
        }
        3 => {
            walk(world, 270.0);
            jump(world, 350.0);
            fly(world, 610.0);
            fly(world, 836.0);
        }
        4 => {
            walk(world, 120.0);
            jump(world, 205.0);
            jump(world, 346.0);
            walk(world, 360.0);
            fly(world, 776.0);
            walk(world, 822.0);
            land(world);
            walk(world, 910.0);
            for _ in 0..40 {
                advance(
                    world,
                    Input {
                        fire: true,
                        ..Input::default()
                    },
                );
            }
            jump(world, 1060.0);
        }
        5 => {
            walk(world, 280.0);
            jump(world, 430.0);
            walk(world, 540.0);
            fly(world, 872.0);
            jump(world, 992.0);
            for _ in 0..40 {
                advance(
                    world,
                    Input {
                        fire: true,
                        ..Input::default()
                    },
                );
            }
            fly(world, 1190.0);
            land(world);
        }
        6 => {
            walk(world, 280.0);
            fly(world, 680.0);
            clear_ahead(world);
            jump(world, 820.0);
            walk(world, 848.0);
            clear_ahead(world);
            walk(world, 900.0);
            land(world);
            fly(world, 1140.0);
            clear_ahead(world);
            walk(world, 1150.0);
            jump(world, 1300.0);
        }
        7 => {
            walk(world, 280.0);
            fly(world, 656.0);
            clear_ahead(world);
            fly(world, 992.0);
            clear_ahead(world);
            fly(world, 1304.0);
            clear_ahead(world);
            walk(world, 1330.0);
            fly(world, 1490.0);
        }
        8 => {
            walk(world, 280.0);
            fly(world, 704.0);
            clear_ahead(world);
            jump(world, 820.0);
            clear_ahead(world);
            jump(world, 916.0);
            clear_ahead(world);
            walk(world, 940.0);
            fly(world, 1208.0);
            fly(world, 1440.0);
            clear_ahead(world);
        }
        9 => {
            walk(world, 280.0);
            fly(world, 704.0);
            clear_ahead(world);
            jump(world, 820.0);
            clear_ahead(world);
            jump(world, 916.0);
            clear_ahead(world);
            fly(world, 1012.0);
            walk(world, 1040.0);
            assert!(
                world.player.has_core,
                "roof approach failed {:?}",
                world.player
            );
            fly(world, 1280.0);
            clear_ahead(world);
            fly(world, 1560.0);
            clear_ahead(world);
        }
        10 => {
            walk(world, 280.0);
            fly(world, 680.0);
            clear_ahead(world);
            fly(world, 1040.0);
            clear_ahead(world);
            jump(world, 1132.0);
            clear_ahead(world);
            fly(world, 1424.0);
            clear_ahead(world);
            walk(world, 1450.0);
            fly(world, 1680.0);
            clear_ahead(world);
        }
        11 => {
            walk(world, 280.0);
            fly(world, 704.0);
            clear_ahead(world);
            fly(world, 1064.0);
            clear_ahead(world);
            jump(world, 1156.0);
            clear_ahead(world);
            jump(world, 1252.0);
            clear_ahead(world);
            fly(world, 1348.0);
            walk(world, 1370.0);
            fly(world, 1616.0);
            clear_ahead(world);
            fly(world, 1896.0);
            clear_ahead(world);
        }
        _ => panic!("invalid stage"),
    }
    assert!(
        world.player.has_core,
        "missing seed stage{index}, {:?}",
        world.player
    );
    for _ in 0..900 {
        advance(
            world,
            Input {
                right: true,
                fire: true,
                ..Input::default()
            },
        );
        if world.mode == Mode::LevelComplete {
            break;
        }
    }
    assert_eq!(
        world.mode,
        Mode::LevelComplete,
        "exit stage{index}, {:?}",
        world.player
    );
    assert_eq!(world.lives, attempts, "route lost attempt stage{index}");
    println!(
        "stage {} {} completed tick={} score={} lives={} fuel={}",
        index + 1,
        world.level_name,
        world.tick,
        world.score,
        world.lives,
        world.player.fuel
    );
    advance(
        world,
        Input {
            confirm: true,
            ..Input::default()
        },
    );
    advance(world, Input::default());
    if index + 1 < levels::CAMPAIGN_LEN {
        assert_eq!(world.mode, Mode::Playing);
        assert_eq!(world.level_index, index + 1);
        if index == 5 {
            println!("sixth arch continues into stage seven");
        }
    } else {
        assert_eq!(world.mode, Mode::Victory);
        assert_eq!(world.level_index, levels::CAMPAIGN_LEN - 1);
    }
}

fn main() {
    println!(
        "runtime route check at {} steps/second",
        simulation::STEP_HZ
    );
    let mut bounds = World::new();
    for index in 0..levels::CAMPAIGN_LEN {
        assert!(bounds.load_level(index));
    }
    let before = (
        bounds.level_index,
        bounds.width,
        bounds.height,
        bounds.player.body,
        bounds.mode,
        bounds.score,
        bounds.lives,
        bounds.tick,
        bounds.tiles.len(),
        bounds.pickups.len(),
        bounds.enemies.len(),
        bounds.shots.len(),
    );
    for invalid in [levels::CAMPAIGN_LEN, usize::MAX] {
        assert!(!bounds.load_level(invalid));
        assert_eq!(
            before,
            (
                bounds.level_index,
                bounds.width,
                bounds.height,
                bounds.player.body,
                bounds.mode,
                bounds.score,
                bounds.lives,
                bounds.tick,
                bounds.tiles.len(),
                bounds.pickups.len(),
                bounds.enemies.len(),
                bounds.shots.len()
            )
        );
    }
    println!("indices 0..11 accepted; invalid selections preserve world state");
    for index in 0..levels::CAMPAIGN_LEN {
        let mut world = World::new();
        assert!(world.load_level(index));
        if let Some(stage) = levels::build(index) {
            let crawlers = stage
                .enemies
                .iter()
                .filter(|enemy| matches!(enemy.kind, simulation::EnemyKind::Crawler))
                .count();
            let sentries = stage.enemies.len() - crawlers;
            println!(
                "design stage{} width={} crawlers={} sentries={} cell_charge={}",
                index + 1,
                stage.width,
                crawlers,
                sentries,
                stage.charge_per_cell
            );
        }
        route(&mut world);
    }
    let mut campaign = World::new();
    advance(
        &mut campaign,
        Input {
            confirm: true,
            ..Input::default()
        },
    );
    for _ in 0..levels::CAMPAIGN_LEN {
        route(&mut campaign);
    }
    assert_eq!(campaign.mode, Mode::Victory);
    println!(
        "uninterrupted campaign reached Victory score={} attempts={}",
        campaign.score, campaign.lives
    );
    let mut controls = World::new();
    controls.start_game();
    advance(
        &mut controls,
        Input {
            pause: true,
            ..Input::default()
        },
    );
    assert_eq!(controls.mode, Mode::Paused);
    let frozen = controls.player.body;
    for _ in 0..20 {
        advance(
            &mut controls,
            Input {
                right: true,
                ..Input::default()
            },
        );
    }
    assert_eq!(controls.player.body, frozen);
    advance(
        &mut controls,
        Input {
            pause: true,
            ..Input::default()
        },
    );
    assert_eq!(controls.mode, Mode::Playing);
    walk(&mut controls, 260.0);
    advance(
        &mut controls,
        Input {
            restart: true,
            ..Input::default()
        },
    );
    assert!((controls.player.body.x - 48.0).abs() < 0.01);
    assert_eq!(controls.lives, 4);
    assert_eq!(controls.score, 0);
    assert!(controls.load_level(2));
    walk(&mut controls, 280.0);
    assert_eq!(controls.player.fuel, simulation::MAX_FUEL);
    for _ in 0..540 {
        advance(
            &mut controls,
            Input {
                thrust: true,
                ..Input::default()
            },
        );
    }
    assert_eq!(controls.player.fuel, 0);
    assert!(controls.player.grounded);
    println!("finite capacitor exhausted and grounded normally after540 held-flight steps");
    assert!(controls.load_level(2));
    for _ in 0..2400 {
        advance(
            &mut controls,
            Input {
                right: true,
                ..Input::default()
            },
        );
        if controls.mode == Mode::Defeat {
            break;
        }
    }
    assert_eq!(controls.mode, Mode::Defeat);
    assert_eq!(controls.lives, 0);
    advance(
        &mut controls,
        Input {
            confirm: true,
            ..Input::default()
        },
    );
    assert_eq!(controls.mode, Mode::Playing);
    assert_eq!(controls.lives, 4);
    println!("pause freeze/resume, stage retry, four-attempt defeat and new-game recovery passed");
}
