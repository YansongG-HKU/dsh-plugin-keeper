# Changelog

All notable changes to `dsh-plugin-smith` are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/).

## [0.1.1] — 2026-11-06

### Added

- First public repository release.

### Changed

- Declared `engines.dsh: ">=0.2.2-rc.1"`; README gains repository link, GitHub install path and a 0.2.2 compatibility note.

### Verified

- 104/104 unit tests pass on Node 24; host tools (`tools.register`, `systemPrompt.section`, `webServer.register`, `workingDirectory`) unchanged in DSH 0.2.2-rc.1.
- Known soft degradation: `profileContext.dir` is no longer public in 0.2.2, so the L4 install-directory digest check falls back to "unknown profile directory" (no error, install flow unaffected; set `DSH_PROFILE_DIR` to restore the exact check).
