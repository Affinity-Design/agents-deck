// Run with: node --test   (no dependencies; on Node 24 "node --test tests/" errors, so use plain node --test)
//
// Lifts the @links block out of index.html, as the comment at the top of that block describes, runs it, and checks where
// the call-to-action buttons go:
//   - the visitor's own icp is passed on as written (percent-encoded, a space is %20), and the deck's own icp ("trades")
//     goes out only when the visitor gave none;
//   - an icp is never turned into an industry: the industry comes from ?industry=, then ?business=, only;
//   - everything else is what it always was: the order (tracking params in arrival order, so ref stays first, then icp,
//     industry, location, utm_source, utm_medium, utm_campaign, utm_content), the slugs, the utm tags, the visit's
//     storage, and which deck version a visit picks. The literal links for visits without an icp were produced by the
//     LINKS code on main (0e664ba).
//
// DECK_HTML=/path/to/index.html runs the same checks against another copy of the deck (for example main's): the visits
// that are unchanged pass there, and the ones this fix changes fail.
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

const linksFrom = (source) => new Function(`${source}\nreturn LINKS;`)();
const LINKS = linksFrom(liftBlock("links"));

// The deck's call-to-action buttons, in page order.
const positions = [...deck.matchAll(/data-cta="([^"]+)"/g)].map((match) => match[1]);

const AUDIT = "https://clients.affinitydesign.ca/offers/strategy-audit";
const DECK_TAGS = (position) =>
  `utm_source=agents-getaffinitydesign&utm_medium=sales-deck&utm_campaign=deck-painting&utm_content=${position}`;

const hrefFor = (search, position, links = LINKS, store = null) => links.href(links.read(search, store), position);

// Every button must give `${AUDIT}?${query(position)}` for the visit.
function expectEveryButton(search, query, links = LINKS) {
  for (const position of positions) {
    assert.equal(hrefFor(search, position, links), `${AUDIT}?${query(position)}`, `${search || "(no params)"} / ${position}`);
  }
}

// The pairs as LINKS wrote them. (Not new URL(href).search: the URL parser rewrites ' as %27 in a query.)
const queryOf = (href) => href.split("?")[1].split("&").filter(Boolean);
const keysOf = (href) => queryOf(href).map((pair) => pair.split("=")[0]);
const SMILE = String.fromCodePoint(0x1f600);
const LONE_HIGH_SURROGATE = String.fromCharCode(0xd83d);

test("the deck has its three call-to-action buttons", () => {
  assert.deepEqual(positions, ["offer-audit", "offer-waitlist", "close-cta"]);
});

/* ── The four acceptance visits ────────────────────────────────────────── */

test("1) ?ref=paul&industry=law&location=Toronto&icp=solo%20firms sends the rep's icp, in the icp slot", () => {
  expectEveryButton(
    "?ref=paul&industry=law&location=Toronto&icp=solo%20firms",
    (p) => `ref=paul&icp=solo%20firms&industry=law&location=toronto&${DECK_TAGS(p)}`,
  );
});

test("2) ?icp=solo%20firms sends the rep's icp and no industry at all", () => {
  expectEveryButton("?icp=solo%20firms", (p) => `icp=solo%20firms&${DECK_TAGS(p)}`);
});

test("3) ?ref=paul is unchanged from main", () => {
  expectEveryButton("?ref=paul", (p) => `ref=paul&icp=trades&${DECK_TAGS(p)}`);
});

test("4) no params is unchanged from main", () => {
  expectEveryButton("", (p) => `icp=trades&${DECK_TAGS(p)}`);
});

test("the three buttons of visit 1 differ only in utm_content", () => {
  const search = "?ref=paul&industry=law&location=Toronto&icp=solo%20firms";
  const strip = (href) => href.replace(/utm_content=[^&]*$/, "");
  const links = positions.map((position) => hrefFor(search, position));
  assert.equal(new Set(links.map(strip)).size, 1);
  assert.deepEqual(links.map((href) => href.match(/utm_content=([^&]*)$/)[1]), positions);
});

/* ── Visits without an icp are byte-identical to main ──────────────────── */

const UNCHANGED_FROM_MAIN = {
  "industry and location": {
    search: "?ref=paul&industry=law&location=Toronto",
    query: (p) => `ref=paul&icp=trades&industry=law&location=toronto&${DECK_TAGS(p)}`,
  },
  "business and state aliases": {
    search: "?ref=paul&business=house%20painters&state=Ottawa",
    query: (p) => `ref=paul&icp=trades&industry=house-painters&location=ottawa&${DECK_TAGS(p)}`,
  },
  "tracking values with spaces still use + (only the icp is written with %20)": {
    search: "?ref=paul&utm_source=meta&utm_campaign=t1&fbclid=fb1&coupon=take%2010",
    query: () => "ref=paul&utm_source=meta&utm_campaign=t1&fbclid=fb1&coupon=take+10&icp=trades&utm_medium=sales-deck&utm_content=POSITION",
  },
  "several tracking params in arrival order, a painting industry and St.Louis": {
    search: "?aff=a1&ref=paul&offer_code=SPRING&industry=painting&location=St.Louis",
    query: (p) => `aff=a1&ref=paul&offer_code=SPRING&icp=trades&industry=painting&location=st-louis&${DECK_TAGS(p)}`,
  },
  "a visitor's own utm_source is never overwritten": {
    search: "?utm_source=meta&ref=paul",
    query: () => "utm_source=meta&ref=paul&icp=trades&utm_medium=sales-deck&utm_campaign=deck-painting&utm_content=POSITION",
  },
  "an industry or location that slugs to nothing is dropped": {
    search: "?industry=!!!&location=%20%20",
    query: (p) => `icp=trades&${DECK_TAGS(p)}`,
  },
};

for (const [name, { search, query }] of Object.entries(UNCHANGED_FROM_MAIN)) {
  test(`unchanged from main: ${name}`, () => {
    expectEveryButton(search, (p) => query(p).replace("POSITION", p));
  });
}

/* ── The visitor's icp ─────────────────────────────────────────────────── */

test("the ends of the icp are trimmed", () => {
  expectEveryButton("?icp=%20%20solo%20firms%20%20", (p) => `icp=solo%20firms&${DECK_TAGS(p)}`);
});

test("an icp of 120 characters is passed on whole; one of 121 or more is cut to 120", () => {
  expectEveryButton(`?icp=${"x".repeat(120)}`, (p) => `icp=${"x".repeat(120)}&${DECK_TAGS(p)}`);
  expectEveryButton(`?icp=${"x".repeat(121)}`, (p) => `icp=${"x".repeat(120)}&${DECK_TAGS(p)}`);
  expectEveryButton(`?icp=${"x".repeat(500)}`, (p) => `icp=${"x".repeat(120)}&${DECK_TAGS(p)}`);
  expectEveryButton(`?icp=${"x".repeat(119)}%20abc`, (p) => `icp=${"x".repeat(119)}&${DECK_TAGS(p)}`);
});

test("the cut counts characters: an emoji is kept whole or dropped whole, never halved", () => {
  const encodedSmile = encodeURIComponent(SMILE);
  expectEveryButton(`?icp=${"x".repeat(119)}${encodedSmile}`, (p) => `icp=${"x".repeat(119)}${encodedSmile}&${DECK_TAGS(p)}`);
  expectEveryButton(`?icp=${"x".repeat(120)}${encodedSmile}`, (p) => `icp=${"x".repeat(120)}&${DECK_TAGS(p)}`);
});

test("half an emoji left by the earlier 128-unit cut is dropped, and nothing throws", () => {
  // 1 + 64 emoji is 129 UTF-16 units: the first cut leaves 63 emoji and half of the 64th.
  const search = `?icp=x${encodeURIComponent(SMILE.repeat(64))}`;
  const expectedIcp = `x${SMILE.repeat(63)}`;
  for (const position of positions) {
    const href = hrefFor(search, position);
    const icp = queryOf(href).find((pair) => pair.startsWith("icp=")).slice(4);
    assert.equal(decodeURIComponent(icp), expectedIcp);
  }
});

test("a blank icp falls back to the deck's own", () => {
  for (const search of ["?icp=", "?icp=%20%20", "?icp=%00%07", "?icp=%20%0A%09%20", "?ref=paul&icp="]) {
    for (const position of positions) {
      const href = hrefFor(search, position);
      assert.ok(href.includes("icp=trades&"), `${search}: ${href}`);
      assert.doesNotMatch(href, /[?&]icp=(&|$)/, `${search}: no empty icp`);
    }
  }
  expectEveryButton("?ref=paul&icp=%20", (p) => `ref=paul&icp=trades&${DECK_TAGS(p)}`);
});

test("control characters are removed from the icp, not replaced", () => {
  expectEveryButton("?icp=solo%00%07%20firms%0A", (p) => `icp=solo%20firms&${DECK_TAGS(p)}`);
  expectEveryButton("?icp=solo%09firms", (p) => `icp=solofirms&${DECK_TAGS(p)}`);
  expectEveryButton("?icp=%7Fsolo%1Ffirms", (p) => `icp=solofirms&${DECK_TAGS(p)}`);
});

test("the first non-empty ?icp= is used, and the key is matched in lower case", () => {
  expectEveryButton("?icp=&icp=solo%20firms&icp=other", (p) => `icp=solo%20firms&${DECK_TAGS(p)}`);
  expectEveryButton("?icp=%00&icp=solo%20firms", (p) => `icp=solo%20firms&${DECK_TAGS(p)}`);
  expectEveryButton("?ICP=solo%20firms", (p) => `icp=solo%20firms&${DECK_TAGS(p)}`);
  expectEveryButton("?Icp=solo%20firms&icp=other", (p) => `icp=solo%20firms&${DECK_TAGS(p)}`);
});

test("the icp is passed on as written: no slug and no lower-casing", () => {
  expectEveryButton("?icp=Solo%20Firms%20%26%20CPAs", (p) => `icp=Solo%20Firms%20%26%20CPAs&${DECK_TAGS(p)}`);
});

test("an icp with spaces and symbols is written the way encodeURIComponent writes it", () => {
  const typed = `solo & firms!'()*~+%/?#${String.fromCodePoint(0xe9)}`;
  const written = encodeURIComponent(typed);
  assert.equal(written, "solo%20%26%20firms!'()*~%2B%25%2F%3F%23%C3%A9");
  // The visit carries the typed value in the URL as the browser would have written it.
  const search = `?icp=${written}`;
  expectEveryButton(search, (p) => `icp=${written}&${DECK_TAGS(p)}`);
  for (const position of positions) {
    const href = hrefFor(search, position);
    const icpPair = queryOf(href).find((pair) => pair.startsWith("icp="));
    assert.equal(icpPair, `icp=${written}`);
    assert.doesNotMatch(icpPair, /\+/, "a space is %20 and a typed + is %2B: no literal + in the icp");
    assert.equal(new URL(href).searchParams.get("icp"), typed, "decodes back to what was typed");
  }
  // A + typed in the visit's own URL is a space, as in any query string.
  expectEveryButton("?icp=solo+firms", (p) => `icp=solo%20firms&${DECK_TAGS(p)}`);
});

test("markup in an icp is only ever encoded, never interpreted", () => {
  expectEveryButton("?icp=%3Cscript%3E", (p) => `icp=%3Cscript%3E&${DECK_TAGS(p)}`);
});

/* ── An icp is never an industry ───────────────────────────────────────── */

test("an icp alone produces no industry param, whatever it says", () => {
  for (const search of ["?icp=solo%20firms", "?icp=law", "?icp=painters", "?icp=house%20painters", "?ref=paul&icp=solo%20firms&location=Toronto"]) {
    for (const position of positions) {
      const href = hrefFor(search, position);
      assert.ok(!keysOf(href).includes("industry"), `${search}: ${href}`);
    }
    assert.equal(LINKS.read(search, null).industry, null, search);
  }
  expectEveryButton("?ref=paul&icp=solo%20firms&location=Toronto", (p) => `ref=paul&icp=solo%20firms&location=toronto&${DECK_TAGS(p)}`);
});

test("the industry still comes from ?industry=, then ?business=", () => {
  expectEveryButton("?business=roofing&icp=solo%20firms", (p) => `icp=solo%20firms&industry=roofing&${DECK_TAGS(p)}`);
  expectEveryButton("?industry=law&business=roofing&icp=solo%20firms", (p) => `icp=solo%20firms&industry=law&${DECK_TAGS(p)}`);
  expectEveryButton("?business=roofing", (p) => `icp=trades&industry=roofing&${DECK_TAGS(p)}`);
});

test("the visitor's icp is a separate field: the deck's own icp (the page's data-icp) is untouched", () => {
  const visit = LINKS.read("?ref=paul&icp=solo%20firms", null);
  assert.equal(visit.visitorIcp, "solo firms");
  assert.equal(visit.icp, "trades");
  assert.equal(LINKS.read("", null).visitorIcp, "");
  assert.equal(LINKS.read("?icp=%00", null).visitorIcp, "");
});

/* ── Order, tracking, storage and the deck version are as they were ────── */

test("ref stays first, tracking params keep their arrival order, and the visitor's utm tags are not overwritten", () => {
  expectEveryButton(
    "?utm_source=meta&ref=paul&fbclid=fb1&industry=law&icp=solo%20firms&location=Toronto",
    (p) => `utm_source=meta&ref=paul&fbclid=fb1&icp=solo%20firms&industry=law&location=toronto&utm_medium=sales-deck&utm_campaign=deck-painting&utm_content=${p}`,
  );
  for (const position of positions) {
    const href = hrefFor("?ref=paul&aff=a1&utm_campaign=t1&industry=law&icp=solo%20firms", position);
    assert.deepEqual(keysOf(href), ["ref", "aff", "utm_campaign", "icp", "industry", "utm_source", "utm_medium", "utm_content"]);
  }
});

test("tracking values with spaces keep their + beside an icp written with %20", () => {
  expectEveryButton(
    "?ref=paul&coupon=take%2010&icp=solo%20firms",
    (p) => `ref=paul&coupon=take+10&icp=solo%20firms&${DECK_TAGS(p)}`,
  );
});

test("the deck version is picked from industry, then business, then icp, exactly as before", () => {
  // The deck has one version today, so a second one is added to the lifted block to see which words choose it.
  const original = "const VARIANTS = { painting: { icp: 'trades', match: ['painter', 'painters', 'painting'] } };";
  const source = liftBlock("links");
  assert.ok(source.includes(original), "the VARIANTS line is as this test expects; update the test if a version was added");
  const withRoofing = linksFrom(
    source.replace(original, "const VARIANTS = { painting: { icp: 'trades', match: ['painter', 'painters', 'painting'] }, roofing: { icp: 'roofers', match: ['roofer', 'roofers', 'roofing'] } };"),
  );
  const variantOf = (search) => withRoofing.read(search, null).variant;
  assert.equal(variantOf("?icp=roofing"), "roofing", "an icp still counts when it is all there is");
  assert.equal(variantOf("?industry=painting&icp=roofing"), "painting", "industry comes first");
  assert.equal(variantOf("?business=roofing&icp=painting"), "roofing", "then business, before icp");
  assert.equal(variantOf("?industry=roofing&business=painting&icp=painting"), "roofing");
  assert.equal(variantOf("?icp=solo%20firms"), "painting", "no match: the default version");
  // utm_campaign follows the version, and an icp-chosen version forwards the icp itself and no industry.
  const href = withRoofing.href(withRoofing.read("?icp=roofing", null), "offer-audit");
  assert.equal(href, `${AUDIT}?icp=roofing&utm_source=agents-getaffinitydesign&utm_medium=sales-deck&utm_campaign=deck-roofing&utm_content=offer-audit`);
});

test("with icp=painters or industry=painting the version, and so utm_campaign, is the painting deck", () => {
  for (const search of ["?icp=painters", "?industry=painting", "?icp=house%20painters", "?business=painters&icp=solo%20firms"]) {
    assert.equal(LINKS.read(search, null).variant, "painting", search);
    for (const position of positions) assert.match(hrefFor(search, position), /utm_campaign=deck-painting&/, search);
  }
});

test("the icp is not stored: only tracking params are, and a later visit without an icp sends the deck's own", () => {
  const written = [];
  const store = { getItem: () => (written.length ? written[written.length - 1] : null), setItem: (key, value) => written.push(value) };
  LINKS.read("?ref=paul&icp=solo%20firms&industry=law", store);
  assert.deepEqual(written.map((value) => JSON.parse(value)), [{ ref: "paul" }]);
  const later = LINKS.read("", store);
  assert.equal(later.visitorIcp, "");
  assert.equal(LINKS.href(later, "offer-audit"), `${AUDIT}?ref=paul&icp=trades&${DECK_TAGS("offer-audit")}`);
});

test("no param is ever sent empty", () => {
  for (const search of ["?icp=", "?icp=%20&industry=%20&location=%20", "?ref=&icp=solo%20firms", "?industry=!!!&icp=!!!", "?icp=%00%07"]) {
    for (const position of positions) assert.doesNotMatch(hrefFor(search, position), /=(&|$)/, search);
  }
});

test("an icp that cannot be encoded counts as not given, and href never throws", () => {
  const visit = { ...LINKS.read("?ref=paul", null), visitorIcp: `solo${LONE_HIGH_SURROGATE}` };
  assert.equal(LINKS.href(visit, "offer-audit"), `${AUDIT}?ref=paul&icp=trades&${DECK_TAGS("offer-audit")}`);
});

test("the link starts at the strategy audit and nothing else about the address changes", () => {
  for (const search of ["", "?icp=solo%20firms", "?ref=paul&industry=law&location=Toronto&icp=solo%20firms"]) {
    for (const position of positions) {
      const url = new URL(hrefFor(search, position));
      assert.equal(url.origin + url.pathname, AUDIT);
      assert.equal(url.hash, "");
    }
  }
});
