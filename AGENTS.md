# Contributor instructions

## Ownership

* Platforms: Cargo.toml, Cargo.lock, build.rs, src/lib.rs, src/main.rs, src/options.rs, src/platform.rs, src/platform/tests.rs, src/sound.rs, platform/, .cargo/, .github/, release orchestration/npm tooling, README.md and AGENTS.md. Coordinate tools/release/ helper ownership with Runtime and Presentation.
* Runtime: src/simulation.rs, src/levels.rs and tests/simulation.rs.
* Presentation: src/presentation.rs, src/lettering.rs, tests/cli.rs and tests/support/.
* Leader: integration review and any unassigned files.

The checkout is shared. Do not revert another member's edits. Agree on public interfaces before changing a module owned by another member. Team reports and task changes use Team tools.

## Documentation layout

Keep exactly two authored Markdown documents: [README.md](README.md) for the complete project guide and this AGENTS.md for discoverable contributor/agent instructions. Update the relevant README section rather than creating duplicate guides or pointer stubs. Preserve screenshots and other evidence assets in docs/images/ and evidence/.

Read [the player guide](README.md#play-through-twelve-stages), [platform builds](README.md#build-for-your-platform), [architecture](README.md#architecture), [visual design](README.md#visual-design), [roadmap](README.md#roadmap) and [dated validation records](README.md#validation-appendix) as relevant to the task. Current implementation and historical observations must remain distinguishable.

## Implementation requirements

Use SDL3 through its safe Rust wrapper. No SDL2, external game engine, custom unsafe bridge, or platform API in the simulation. Keep game rules deterministic at 60 Hz. Preserve meaningful errors; never discard fallible SDL calls silently. Default builds must not require proprietary game content or a neighboring checkout.

All source, campaign content, visual assets, fonts and audio must be independently created or have an explicit compatible license and recorded provenance. Do not introduce proprietary source or assets without such authorization. A feature inspired by general platform game conventions must receive its own implementation and content.

Do not claim a target works based on another platform's build. Record the exact build/run command, date, target, content revision and actual result in the README validation appendix. iPhone and iPad require device or simulator evidence, and signed distribution requires Apple provisioning. Do not commit signing identities, provisioning profiles or credentials.

## Validation

For release changes, read [release setup](README.md#release-all-platforms) and [release validation](README.md#release-tooling-validation). Use Node >=24.15 with `npm ci --ignore-scripts` and `npm test`. Preserve the plan -> all required packages -> one publish dependency chain, default-branch/source/version guards and metadata-only release commit. `npm run release:publish` performs external writes and is not a test command. Use temporary local Git fixtures for tests; never initialize or publish this checkout implicitly. Keep credentials out of files and logs, and preserve unsigned-device/simulator/optional-IPA distinctions. Do not add a changelog Markdown file or npm publication plugin.

Use cargo fmt, cargo check, cargo clippy and simulation tests when the task authorizes verification; [README checks](README.md#check-a-change) and the [CI matrix](README.md#ci-matrix) give the commands and targets. Preserve the callback binary's test=false. Run native tests with `cargo test --locked --lib --test simulation --test campaign_routes`; run the CLI target separately with dummy SDL display/audio drivers as documented. Do not use `cargo test --all-targets` to override the callback exclusion. Default CI uses vendored SDL3; optional system-SDL feature checks need their native dependencies. Exercise the real SDL surface when the task requires visual validation. Update the README roadmap and dated validation sections with observed statuses. Documentation-only work uses static link, anchor and inventory checks unless runtime validation is requested. No commits are made automatically.
