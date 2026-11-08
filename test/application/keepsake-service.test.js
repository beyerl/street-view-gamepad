import { test } from "node:test";
import assert from "node:assert/strict";
import { KeepsakeService } from "../../src/application/keepsake-service.js";

function setup({ marks = [], capture = async () => "data:image/png;base64,AA" } = {}) {
  const sent = [];
  const downloads = [];
  const made = [];
  const svc = new KeepsakeService({
    tabs: { captureVisibleTab: capture, sendMessage: async (id, m) => void sent.push(m.message) },
    downloads: { download: async (o) => void downloads.push(o) },
    bookmarks: {
      search: async () => marks,
      getChildren: async (id) => marks.filter((b) => b.parentId === id),
      create: async (o) => (made.push(o), { id: "new", title: o.title }),
    },
    now: () => new Date(2026, 10, 8, 9, 5, 7).getTime(),
    warn: () => {},
  });
  return { svc, sent, downloads, made };
}
const tab = { id: 1, windowId: 2, url: "https://www.google.com/maps/@1,2,3a", title: "Tokyo" };

test("screenshot: saved in the Virtual Visit download folder, with a timestamp", async () => {
  const { svc, sent, downloads } = setup();
  await svc.screenshot(tab);
  assert.equal(downloads[0].filename, "Virtual Visit/Street View 2026-11-08 09-05-07.png");
  assert.deepEqual(sent, ["Screenshot saved"]);
});

test("screenshot: a failure is reported, not thrown", async () => {
  const { svc, sent, downloads } = setup({ capture: async () => Promise.reject(new Error("no")) });
  await svc.screenshot(tab);
  assert.equal(downloads.length, 0);
  assert.deepEqual(sent, ["Screenshot failed"]);
});

test("bookmark: creates the folder when it is missing", async () => {
  const { svc, made } = setup();
  await svc.bookmark(tab);
  assert.deepEqual(made, [{ title: "Virtual Visit" }, { parentId: "new", title: "Tokyo", url: tab.url }]);
});

test("bookmark: reuses a folder in any capitalisation and skips duplicates", async () => {
  const folder = { id: "f", title: "virtual visit" };
  const page = { id: "p", title: "virtual visit notes", url: "https://example.org/" };
  const first = setup({ marks: [page, folder] });
  await first.svc.bookmark(tab);
  assert.equal(first.made[0].parentId, "f");
  const again = setup({ marks: [folder, { id: "b", parentId: "f", title: "Tokyo", url: tab.url }] });
  await again.svc.bookmark(tab);
  assert.equal(again.made.length, 0);
  assert.deepEqual(again.sent, ["Already bookmarked"]);
});
