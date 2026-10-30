// Run with: node --test tests/links.test.mjs   (no dependencies)
//
// Lifts the @links block out of index.html, runs it, and checks where every call-to-action button goes. The
// expected links below were produced by the LINKS code on main (0e664ba), before the audience copy existed, so a
// pass means the buttons are exactly what they were: ref, industry and location slugs, the deck's icp, and the
// utm_* tags, for the same visits. The audience copy reads its own params and must never change any of this.
//
// To run the same checks against another copy of the deck (for example main's index.html):
//   DECK_HTML=/path/to/index.html node --test tests/links.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const deckPath = process.env.DECK_HTML
  ? path.resolve(process.env.DECK_HTML)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "index.html");
const deck = readFileSync(deckPath, "utf8").replace(/\r\n/g, "\n");

function liftBlock(name) {
  const start = `/* @${name}:start */`;
  const end = `/* @${name}:end */`;
  const from = deck.indexOf(start);
  const to = deck.indexOf(end);
  assert.ok(from !== -1 && to > from, `index.html has a ${start} ... ${end} block`);
  return deck.slice(from + start.length, to);
}

const LINKS = new Function(`${liftBlock("links")}\nreturn LINKS;`)();

// The deck's call-to-action buttons, in page order.
const positions = [...deck.matchAll(/data-cta="([^"]+)"/g)].map((match) => match[1]);

const AUDIT = "https://clients.affinitydesign.ca/offers/strategy-audit";
const DECK_TAGS = (position) =>
  `utm_source=agents-getaffinitydesign&utm_medium=sales-deck&utm_campaign=deck-painting&utm_content=${position}`;

// What main's LINKS.href gives for each visit: the query after the audit address, with the position left to fill in.
const EXPECTED_QUERY = {
  none: { search: "", query: (p) => `icp=trades&${DECK_TAGS(p)}` },
  refOnly: { search: "?ref=paul", query: (p) => `ref=paul&icp=trades&${DECK_TAGS(p)}` },
  caseA: {
    search: "?ref=paul&industry=law&location=Toronto&icp=solo%20firms",
    query: (p) => `ref=paul&icp=trades&industry=law&location=toronto&${DECK_TAGS(p)}`,
  },
  icpOnly: {
    search: "?ref=paul&icp=solo%20firms",
    query: (p) => `ref=paul&icp=trades&industry=solo-firms&${DECK_TAGS(p)}`,
  },
  stLouis: {
    search: "?ref=paul&location=St.Louis",
    query: (p) => `ref=paul&icp=trades&location=st-louis&${DECK_TAGS(p)}`,
  },
  utmAndClickId: {
    search: "?ref=paul&industry=law&location=Toronto&icp=solo%20firms&utm_source=meta&utm_campaign=t1&fbclid=fb1",
    query: (p) =>
      `ref=paul&utm_source=meta&utm_campaign=t1&fbclid=fb1&icp=trades&industry=law&location=toronto&utm_medium=sales-deck&utm_content=${p}`,
  },
  paintersInOttawa: {
    search: "?ref=paul&industry=house%20painters&location=Ottawa",
    query: (p) => `ref=paul&icp=trades&industry=house-painters&location=ottawa&${DECK_TAGS(p)}`,
  },
  // The buttons slug whatever they are given (main's own behaviour); only the cover copy rejects these values.
  badValues: {
    search: "?ref=paul&icp=%3Cscript%3E&industry=evil.com/x&location=http%3A%2F%2Fevil.example",
    query: (p) => `ref=paul&icp=trades&industry=evil-com-x&location=http-evil-example&${DECK_TAGS(p)}`,
  },
};

test("the deck has its three call-to-action buttons", () => {
  assert.deepEqual(positions, ["offer-audit", "offer-waitlist", "close-cta"]);
});

for (const [name, { search, query }] of Object.entries(EXPECTED_QUERY)) {
  test(`every button link is what main produces: ${name}`, () => {
    const visit = LINKS.read(search, null);
    for (const position of positions) {
      assert.equal(LINKS.href(visit, position), `${AUDIT}?${query(position)}`, `${name} / ${position}`);
    }
  });
}

test("case a with ref=paul: all three links carry ref, industry and location slugs and the deck's icp", () => {
  const visit = LINKS.read(EXPECTED_QUERY.caseA.search, null);
  for (const position of positions) {
    const link = new URL(LINKS.href(visit, position));
    assert.equal(link.origin + link.pathname, AUDIT);
    assert.equal(link.searchParams.get("ref"), "paul");
    assert.equal(link.searchParams.get("industry"), "law");
    assert.equal(link.searchParams.get("location"), "toronto");
    assert.equal(link.searchParams.get("icp"), "trades", "the deck's own icp, not the rep's");
    assert.equal(link.searchParams.get("utm_content"), position);
  }
});

test("with an icp only, the buttons still read it as the industry slug (the audit's own rule); only the copy does not", () => {
  const visit = LINKS.read("?ref=paul&icp=solo%20firms", null);
  assert.equal(visit.industry.slug, "solo-firms");
});
