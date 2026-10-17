import { test } from "node:test";
import assert from "node:assert/strict";
import { COMMAND_LABELS, isMode, Mode, MODE_TABLE, modeCommand, MODES, nextMode } from "../../src/domain/mode.js";
import { isLevelLabel, levelTarget, LevelStep } from "../../src/domain/levels.js";
import { ArticlePlaylist, audioFiles, isSpokenCategory, rankPages } from "../../src/domain/articles.js";
import { nearestLocation } from "../../src/domain/recordings.js";
import { GeoPoint } from "../../src/domain/geo.js";

test("modes cycle", () => {
  assert.deepEqual(MODES, [Mode.LEVELS, Mode.COMMENTARY, Mode.BROWSER, Mode.MINIMAP]);
  assert.equal(nextMode(Mode.LEVELS), Mode.COMMENTARY);
  assert.equal(nextMode(Mode.BROWSER), Mode.MINIMAP);
  assert.equal(nextMode(Mode.MINIMAP), Mode.LEVELS);
  assert.equal(isMode("commentary"), true);
  assert.equal(isMode("nope"), false);
  assert.equal(isMode(null), false);
});

test("mode table: three mode buttons per mode, each command labelled", () => {
  for (const m of MODES) {
    assert.equal(MODE_TABLE[m].buttons.length, 3, m);
    for (const c of MODE_TABLE[m].buttons) if (c) assert.ok(COMMAND_LABELS[c], c);
  }
  assert.equal(modeCommand(Mode.LEVELS, 0), "levelUp");
  assert.equal(modeCommand(Mode.LEVELS, 1), null);
  assert.equal(modeCommand(Mode.COMMENTARY, 2), "articleNext");
  assert.equal(modeCommand(Mode.BROWSER, 1), "overlay");
  assert.equal(modeCommand(Mode.MINIMAP, 1), "minimapZoomIn");
  assert.equal(modeCommand("bogus", 0), null);
});

test("floor targets: up from the top or unknown goes to the bottom, down wraps to the top", () => {
  assert.equal(levelTarget(3, 1, LevelStep.UP), 0);
  assert.equal(levelTarget(3, 0, LevelStep.UP), 2);
  assert.equal(levelTarget(3, -1, LevelStep.UP), 2);
  assert.equal(levelTarget(3, 1, LevelStep.DOWN), 2);
  assert.equal(levelTarget(3, 2, LevelStep.DOWN), 0);
  assert.equal(levelTarget(3, -1, LevelStep.DOWN), 0);
});

test("floor labels", () => {
  for (const l of ["1", "-1", "B1", "2F", "EG", "UG2", "P"]) assert.equal(isLevelLabel(l), true, l);
  for (const l of ["3D", "Search", "Menu", "1234", ""]) assert.equal(isLevelLabel(l), false, l);
});

test("articles: length is weighed against distance", () => {
  const pages = [
    { pageid: 1, length: 100, coordinates: [{ dist: 10 }] },
    { pageid: 2, length: 5000, coordinates: [{ dist: 100 }] },
    { pageid: 3, length: 300 }, // no distance: counts as at the edge
  ];
  assert.deepEqual(rankPages(pages), [2, 1, 3]);
  assert.equal(pages[0].pageid, 1); // not sorted in place
});

test("article playlist wraps around", () => {
  const p = new ArticlePlaylist("en", [5, 6, 7]);
  assert.deepEqual([p.count, p.pageid, p.indexAfter(1), p.indexAfter(-1), p.indexAfter(4)], [3, 5, 1, 2, 1]);
});

test("spoken recordings: categories and audio files", () => {
  assert.equal(isSpokenCategory("Category:Spoken German Wikipedia"), true);
  assert.equal(isSpokenCategory("Category:Pronunciation of German (spoken)"), false);
  assert.deepEqual(
    audioFiles(
      [{ title: "Datei:A.ogg" }, { title: "File:B.jpg" }, { title: "File:C.MP3" }, { title: "File:D.wav" }],
      2,
    ),
    ["File:A.ogg", "File:C.MP3"],
  );
});

test("nearest recording location", () => {
  const locs = [
    [1, 52.52, 13.405],
    [2, 48.8566, 2.3522],
  ];
  const { loc, km } = nearestLocation(locs, new GeoPoint(52.5, 13.4));
  assert.equal(loc[0], 1);
  assert.ok(km > 2 && km < 3);
  assert.deepEqual(nearestLocation([], new GeoPoint(0, 0)), { loc: null, km: Infinity });
});
