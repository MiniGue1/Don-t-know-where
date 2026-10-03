import { test } from "node:test";
import assert from "node:assert/strict";
import { wikiFromTag, pickSitelink, imageFromEntity, imageFromTag, trimExtract, placeInfo } from "../js/wiki.js";
import { shortLabel, searchPlaces } from "../js/geocode.js";

const entity = {
  entities: {
    Q1: {
      sitelinks: { enwiki: { title: "Prague Castle" }, cswiki: { title: "Pražský hrad" }, dewiki: { title: "Prager Burg" } },
      claims: { P18: [{ mainsnak: { datavalue: { value: "Prague Castle.jpg" } } }] },
    },
  },
};

test("wikipedia tag and wikidata sitelinks", () => {
  assert.deepEqual(wikiFromTag("cs:Karlův most"), { lang: "cs", title: "Karlův most" });
  assert.equal(wikiFromTag("nonsense"), null);
  assert.deepEqual(pickSitelink(entity, "Q1", ["cs", "en"]), { lang: "cs", title: "Pražský hrad" });
  assert.deepEqual(pickSitelink(entity, "Q1", ["fr"]), { lang: "en", title: "Prague Castle" });
  assert.equal(imageFromEntity(entity, "Q1"), "Prague Castle.jpg");
});

test("only Wikimedia images are trusted", () => {
  assert.match(imageFromTag("File:Bridge.jpg"), /^https:\/\/commons\.wikimedia\.org\/wiki\/Special:FilePath\/Bridge\.jpg/);
  assert.equal(imageFromTag("http://evil.example/x.jpg"), null);
});

test("extract is trimmed to two sentences", () => {
  assert.equal(trimExtract("One. Two! Three? Four."), "One. Two!");
  assert.ok(trimExtract("a ".repeat(400), 2, 50).length <= 51);
});

test("placeInfo combines Wikidata and the Wikipedia summary", async () => {
  globalThis.localStorage = { getItem: () => null, setItem: () => {} };
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.includes("wikidata")) return { ok: true, json: async () => entity };
    return { ok: true, json: async () => ({ extract: "Pražský hrad je hradní komplex. Je velký. Opravdu.", content_urls: { mobile: { page: "https://cs.m.wikipedia.org/wiki/x" } } }) };
  };
  const info = await placeInfo({ id: "osm:node/1", wikidata: "Q1" }, "cs", fetchImpl);
  assert.equal(info.extract, "Pražský hrad je hradní komplex. Je velký.");
  assert.match(info.image, /Prague%20Castle\.jpg/);
  assert.match(calls[1], /cs\.wikipedia\.org\/api\/rest_v1\/page\/summary\/Pra%C5%BEsk%C3%BD_hrad/);
  assert.equal(await placeInfo({ id: "x" }, "cs", fetchImpl), null, "no tags → no lookup");
});

test("address search labels", async () => {
  assert.equal(shortLabel("Staroměstské náměstí, Staré Město, Praha, 110 00, Česko"), "Staroměstské náměstí, Staré Město, Praha");
  const hits = await searchPlaces("x", { fetchImpl: async () => ({ ok: true, json: async () => [{ lat: "50.1", lon: "14.2", display_name: "A, B, C, D" }] }) });
  assert.deepEqual(hits, [{ lat: 50.1, lng: 14.2, label: "A, B, C" }]);
});
