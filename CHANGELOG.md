# Changelog

All notable changes to `dsh-plugin-keeper` are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/).

## [0.2.0] — 2026-11-07

### Changed

- Renamed the plugin and its repository: the title is now 插件管家 / “Plugin Keeper”, and the package, module id, GitHub repository and install spec are `dsh-plugin-keeper`.
- Internal identity follows the new name everywhere: panel id, loopback route prefix `/plugin-keeper`, request header `x-plugin-keeper`, client locale namespace `dshPluginKeeper`, and the default ledger directory `$DSH_HOME/plugin-keeper`.
- Plugins-page tab label and empty-state wording updated to match the keeper identity.
- Version bumped to 0.2.0 so DSH profiles pick the renamed bundle up as a distinct release.

### Verified

- Same pipeline, same gates: 104/104 tests pass on Node 24; `node --check index.js` and `node --check client.js` clean.

### Notes

- No behavioural change. Records are not migrated automatically: if you want to keep a ledger from a pre-rename install, copy that ledger directory into `$DSH_HOME/plugin-keeper` before opening the panel.

## [0.1.1] — 2026-11-06

### Added

- First public repository release.

### Changed

- Declared `engines.dsh: ">=0.2.2-rc.1"`; README gains repository link, GitHub install path and a 0.2.2 compatibility note.

### Verified

- 104/104 unit tests pass on Node 24; host tools (`tools.register`, `systemPrompt.section`, `webServer.register`, `workingDirectory`) unchanged in DSH 0.2.2-rc.1.
- Known soft degradation: `profileContext.dir` is no longer public in 0.2.2, so the L4 install-directory digest check falls back to "unknown profile directory" (no error, install flow unaffected; set `DSH_PROFILE_DIR` to restore the exact check).
