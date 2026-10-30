// Run with: node --test tests/audience.test.mjs   (no dependencies)
//
// Lifts the @audience block out of index.html and runs it, then runs the small DOM step (the @audience-step block)
// against a stand-in document, and reads the served cover markup. It checks:
//
//   - the value gate: what a link may put into the cover, and what is rejected (a value over 120 characters
//     falls back to the default; it is never cut);
//   - case handling: lower case mid-sentence, initialisms kept, places title-cased;
//   - every audience-sentence combination, and that an icp is never an industry;
//   - that with nothing to add the page is left exactly as served: the DOM step touches nothing;
//   - that the text goes in through textContent, and that LINKS and the start-up block are not involved.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const deckPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "index.html");
const deck = readFileSync(deckPath, "utf8").replace(/\r\n/g, "\n");

function liftBlock(name) {
  const start = `/* @${name}:start */`;
  const end = `/* @${name}:end */`;
  const from = deck.indexOf(start);
  const to = deck.indexOf(end);
  assert.ok(from !== -1 && to > from, `index.html has a ${start} ... ${end} block`);
  return deck.slice(from + start.length, to);
}

const audienceSource = liftBlock("audience");
const stepSource = liftBlock("audience-step");
const AUDIENCE = new Function(`${audienceSource}\nreturn AUDIENCE;`)();
const withoutComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const CASE_A = "?industry=law&location=Toronto&icp=solo%20firms";
const CASE_B = "?icp=solo%20firms";
const CASE_E = "?location=St.Louis";
// Case d from the card: each one alone must read exactly like no params.
const CASE_D = [
  "?icp=%3Cscript%3E",
  "?icp=%7B%7Bx%7D%7D",
  "?industry=evil.com/x",
  "?location=http%3A%2F%2Fevil.example",
  `?industry=${"x".repeat(121)}`,
];
const values = (industry = "", location = "", icp = "") => ({ industry, location, icp });

/* ── Value gate ────────────────────────────────────────────────────────── */

test("good values read through as typed, from the real card link", () => {
  assert.deepEqual(AUDIENCE.read(CASE_A), values("law", "Toronto", "solo firms"));
  assert.deepEqual(AUDIENCE.read("?industry=plumbing+heating&location=New%20York"), values("plumbing heating", "New York", ""));
});

test("the ends are trimmed and inner runs of spaces become one space", () => {
  assert.equal(AUDIENCE.clean("  law   firms  "), "law firms");
  assert.equal(AUDIENCE.clean("\t law \n"), "law");
});

test("missing, empty, whitespace-only, punctuation-only and non-string values are missing", () => {
  for (const missing of [undefined, null, "", "   ", "-", "+", "...", "!!", 42, {}, []]) {
    assert.equal(AUDIENCE.clean(missing), "", JSON.stringify(missing));
  }
  assert.deepEqual(AUDIENCE.read(""), values());
  assert.deepEqual(AUDIENCE.read("?industry=&location=&icp="), values());
  assert.deepEqual(AUDIENCE.read(undefined), values());
});

test("a value of 120 characters is kept; one of 121 falls back to the default and is never cut", () => {
  assert.equal(AUDIENCE.MAX_LENGTH, 120);
  assert.equal(AUDIENCE.clean("a".repeat(120)), "a".repeat(120));
  assert.equal(AUDIENCE.clean("a".repeat(121)), "");
  assert.equal(AUDIENCE.clean("a".repeat(500)), "", "not cut to 120 either");
  assert.equal(AUDIENCE.read(`?industry=${"x".repeat(121)}`).industry, "");
  assert.equal(AUDIENCE.read(`?industry=${"x".repeat(120)}`).industry, "x".repeat(120));
});

test("the length is counted after trimming, and in characters rather than UTF-16 units", () => {
  assert.equal(AUDIENCE.clean(`   ${"a".repeat(120)}   `), "a".repeat(120));
  assert.equal(AUDIENCE.clean(`${"a".repeat(119)}😀`), `${"a".repeat(119)}😀`, "120 characters, one of them an emoji");
  assert.equal(AUDIENCE.clean(`${"a".repeat(120)}😀`), "", "121 characters");
});

test("markup, template tokens and brackets are rejected", () => {
  for (const bad of [
    "<script>", "<script>alert(1)</script>", "<b>law</b>", "law<", ">law",
    "{{x}}", "{x}", "{{ industry }}", "[[x]]", "[x]", "[[a||b]]", "law {industry}",
  ]) {
    assert.equal(AUDIENCE.clean(bad), "", bad);
  }
});

test("encoded markup and HTML entities are rejected", () => {
  for (const bad of ["%3Cscript%3E", "%3cb%3e", "%7B%7Bx%7D%7D", "%5B%5Bx%5D%5D", "&lt;b&gt;", "&#60;b", "&#x3c;b", "&amp;"]) {
    assert.equal(AUDIENCE.clean(bad), "", bad);
  }
  assert.equal(AUDIENCE.clean("Plumbing & Heating"), "Plumbing & Heating");
  assert.equal(AUDIENCE.clean("100% remote"), "100% remote");
});

test("URLs, domains, IP addresses and executable schemes are rejected", () => {
  for (const bad of [
    "http://evil.example", "https://evil.example/x", "ftp://x", "://x", "//evil.example",
    "evil.com", "evil.com/x", "Evil.Com", "evil.example/x", "evil.ca", "sub.evil.io", "evil.xyzabc",
    "www.evil", "www.evil.com", "visit www.x", "user@evil.com", "law evil.com/x",
    "10.0.0.1", "192.168.1.1", "go to 8.8.8.8 now",
    "javascript:alert(1)", "JavaScript:alert(1)", "data:text/html,hi", "mailto:a@b", "tel:5551234",
    "St.Louis.com", "st.louis.com",
    // A capitalised suffix that is not a known top-level domain is a place name only until a path, query, fragment or port follows it.
    "Evil.Abcdef/x", "Louis.Missouri?x=1", "Evil.Abcdef#frag", "Site.Thing:8080",
  ]) {
    assert.equal(AUDIENCE.clean(bad), "", bad);
  }
});

test("control characters and invisible characters inside a value reject it", () => {
  for (const bad of ["law\u0000firm", "law\tfirm", "law\nfirm", "law\rfirm", "law​firm", "law‮firm", "law­firm", "law﻿firm"]) {
    assert.equal(AUDIENCE.clean(bad), "", JSON.stringify(bad));
  }
  assert.equal(AUDIENCE.clean("law\n"), "law", "a trailing newline is just trimmed");
});

test("St.Louis and Ft.Myers style places are kept, real domains are not", () => {
  for (const place of ["St.Louis", "Ft.Myers", "Mt.Pleasant", "st.louis", "ft.myers", "St. Louis", "Washington D.C.", "O'Fallon", "Winston-Salem"]) {
    assert.notEqual(AUDIENCE.clean(place), "", place);
  }
  assert.equal(AUDIENCE.clean("St.Louis"), "St.Louis");
  assert.equal(AUDIENCE.read("?location=St.Louis").location, "St.Louis");
});

test("a capitalised word after the dot is a place name unless it is a top-level domain", () => {
  // These rely on the capital letter alone: their first part is not in the abbreviation list.
  assert.equal(AUDIENCE.clean("Fort.Worth"), "Fort.Worth");
  assert.equal(AUDIENCE.clean("Dr.Smith"), "Dr.Smith");
  assert.equal(AUDIENCE.clean("Prince.George"), "Prince.George");
  // The same words in lower case, or ending in a real top-level domain, read as an address.
  assert.equal(AUDIENCE.clean("fort.worth"), "");
  assert.equal(AUDIENCE.clean("Fort.Com"), "");
  assert.equal(AUDIENCE.clean("Prince.Io"), "");
});

test("sentence punctuation hanging off the end is dropped, inner punctuation survives", () => {
  assert.equal(AUDIENCE.clean("Toronto."), "Toronto");
  assert.equal(AUDIENCE.clean("solo firms!!"), "solo firms");
  assert.equal(AUDIENCE.clean("Washington D.C."), "Washington D.C");
  assert.equal(AUDIENCE.clean("St. Louis, MO"), "St. Louis, MO");
  assert.equal(AUDIENCE.clean("coaches & consultants"), "coaches & consultants");
});

test("only industry, location and icp are read; keys are matched like LINKS does, and an icp is never the industry", () => {
  assert.deepEqual(AUDIENCE.read(CASE_B), values("", "", "solo firms"));
  assert.deepEqual(AUDIENCE.read("?business=law&state=Ontario&company=x"), values(), "no aliases");
  assert.deepEqual(AUDIENCE.read("?INDUSTRY=Law&Location=Toronto&ICP=solo%20firms"), values("Law", "Toronto", "solo firms"), "keys are lower-cased");
  assert.deepEqual(AUDIENCE.read("?industry=&industry=law"), values("law"), "the first non-blank value is used");
  assert.deepEqual(AUDIENCE.read("?industry=evil.com&industry=law"), values(), "a bad first value does not fall through to a later one");
  assert.deepEqual(AUDIENCE.read("?industry=evil.com/x&location=Toronto&icp=%3Cx%3E"), values("", "Toronto", ""), "each slot falls back on its own");
  assert.deepEqual(AUDIENCE.read("?__proto__=x&constructor=y&toString=z"), values());
});

/* ── Case handling ─────────────────────────────────────────────────────── */

test("industry and icp read as lower case mid-sentence, with initialisms kept", () => {
  const prose = AUDIENCE.proseCase;
  assert.equal(prose("Law"), "law");
  assert.equal(prose("LAW"), "law");
  assert.equal(prose("solo FIRMS"), "solo firms");
  assert.equal(prose("Plumbing & Heating"), "plumbing & heating");
  assert.equal(prose("HVAC"), "HVAC");
  assert.equal(prose("hvac"), "HVAC");
  assert.equal(prose("Hvac contractors"), "HVAC contractors");
  assert.equal(prose("CPAs"), "CPAs");
  assert.equal(prose("cpa"), "CPA");
  assert.equal(prose("cfos"), "CFOs");
  assert.equal(prose("IT services"), "IT services");
  assert.equal(prose("saas founders"), "SaaS founders");
  assert.equal(prose("b2b agencies"), "B2B agencies");
  assert.equal(prose("(HVAC), plumbing"), "(HVAC), plumbing");
});

test("an initialism is matched as a whole word, and words that look like object members stay plain text", () => {
  assert.equal(AUDIENCE.proseCase("hvacr"), "hvacr");
  assert.equal(AUDIENCE.proseCase("cpaing"), "cpaing");
  for (const word of ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf"]) {
    assert.equal(AUDIENCE.proseCase(word), word.toLowerCase(), word);
  }
});

test("a place reads as a proper noun", () => {
  const place = AUDIENCE.placeName;
  assert.equal(place("Toronto"), "Toronto");
  assert.equal(place("toronto"), "Toronto");
  assert.equal(place("new york"), "New York");
  assert.equal(place("NEW YORK"), "New York");
  assert.equal(place("TORONTO"), "Toronto");
  assert.equal(place("Toronto, ON"), "Toronto, ON");
  assert.equal(place("TORONTO, ON"), "Toronto, ON");
  assert.equal(place("BC"), "BC");
  assert.equal(place("NYC"), "NYC");
  assert.equal(place("McDonald"), "McDonald");
  assert.equal(place("o'fallon"), "O'Fallon");
  assert.equal(place("winston-salem"), "Winston-Salem");
  assert.equal(place("isle of wight"), "Isle of Wight");
  assert.equal(place("ISLE OF WIGHT"), "Isle of Wight");
  assert.equal(place("The Hague"), "The Hague");
  assert.equal(place("são paulo"), "São Paulo");
  assert.equal(place("Route 66"), "Route 66");
});

test("St.Louis and Ft.Myers keep the dot and the capital after it", () => {
  const place = AUDIENCE.placeName;
  assert.equal(place("St.Louis"), "St.Louis");
  assert.equal(place("st.louis"), "St.Louis");
  assert.equal(place("Ft.Myers"), "Ft.Myers");
  assert.equal(place("ft.myers"), "Ft.Myers");
  assert.equal(place("ST LOUIS"), "St Louis");
  assert.equal(place("St. Louis, MO"), "St. Louis, MO");
});

/* ── Audience sentence: every combination ──────────────────────────────── */

test("industry, location and icp together", () => {
  assert.equal(AUDIENCE.sentence(values("law", "Toronto", "solo firms")), "Set up for local law businesses in Toronto. Built for solo firms.");
});

test("industry and location", () => {
  assert.equal(AUDIENCE.sentence(values("law", "Toronto")), "Set up for local law businesses in Toronto.");
});

test("industry only", () => {
  assert.equal(AUDIENCE.sentence(values("law")), "Set up for local law businesses.");
});

test("location only", () => {
  assert.equal(AUDIENCE.sentence(values("", "Toronto")), "Set up for local businesses in Toronto.");
});

test("icp is added as its own sentence after any of the others", () => {
  assert.equal(AUDIENCE.sentence(values("law", "", "solo firms")), "Set up for local law businesses. Built for solo firms.");
  assert.equal(AUDIENCE.sentence(values("", "Toronto", "solo firms")), "Set up for local businesses in Toronto. Built for solo firms.");
});

test("nothing usable adds nothing", () => {
  assert.equal(AUDIENCE.sentence(values()), "");
});

test("icp only adds just \"Built for {icp}.\" - never \"{icp} businesses\"", () => {
  const sentence = AUDIENCE.sentence(values("", "", "solo firms"));
  assert.equal(sentence, "Built for solo firms.");
  assert.doesNotMatch(sentence, /business|local|set up/i);
  assert.equal(AUDIENCE.sentenceFor(CASE_B), "Built for solo firms.");
});

test("case follows the sentence: lower case values, kept initialisms, title-cased places", () => {
  assert.equal(AUDIENCE.sentence(values("Law", "toronto", "Solo Firms")), "Set up for local law businesses in Toronto. Built for solo firms.");
  assert.equal(AUDIENCE.sentence(values("hvac", "ontario", "CPAs")), "Set up for local HVAC businesses in Ontario. Built for CPAs.");
});

test("a value ending in a full stop does not double it", () => {
  assert.equal(AUDIENCE.sentenceFor("?location=Toronto.&icp=solo%20firms."), "Set up for local businesses in Toronto. Built for solo firms.");
  assert.equal(AUDIENCE.sentenceFor("?location=Washington%20D.C."), "Set up for local businesses in Washington D.C.");
});

test("the card's links read as specified", () => {
  assert.equal(AUDIENCE.sentenceFor(CASE_A), "Set up for local law businesses in Toronto. Built for solo firms.");
  assert.equal(AUDIENCE.sentenceFor(CASE_B), "Built for solo firms.");
  assert.equal(AUDIENCE.sentenceFor(CASE_E), "Set up for local businesses in St.Louis.");
  assert.equal(AUDIENCE.sentenceFor("?industry=HVAC&location=ontario"), "Set up for local HVAC businesses in Ontario.");
  assert.equal(AUDIENCE.sentenceFor("?ref=paul&industry=law&location=Toronto&icp=solo%20firms"), "Set up for local law businesses in Toronto. Built for solo firms.", "a ?ref= link still shows the words");
});

test("no params, campaign-only params and bad values all read exactly like no params", () => {
  assert.equal(AUDIENCE.sentenceFor(""), "");
  assert.equal(AUDIENCE.sentenceFor("?ref=paul&utm_source=meta&fbclid=abc"), "");
  for (const search of CASE_D) assert.equal(AUDIENCE.sentenceFor(search), "", search);
  assert.equal(
    AUDIENCE.sentenceFor(`?icp=%3Cscript%3E&industry=evil.com%2Fx&location=http%3A%2F%2Fevil.example&x=${"y".repeat(300)}`),
    "",
    "all of them together",
  );
});

test("a 121-character industry falls back, a 120-character one is used whole", () => {
  assert.equal(AUDIENCE.sentenceFor(`?industry=${"x".repeat(121)}&location=Toronto`), "Set up for local businesses in Toronto.");
  assert.equal(AUDIENCE.sentenceFor(`?industry=${"x".repeat(120)}&location=Toronto`), `Set up for local ${"x".repeat(120)} businesses in Toronto.`);
});

test("a bad value falls back for its own slot only", () => {
  assert.equal(AUDIENCE.sentenceFor("?industry=evil.com/x&location=Toronto&icp=solo%20firms"), "Set up for local businesses in Toronto. Built for solo firms.");
  assert.equal(AUDIENCE.sentenceFor("?industry=law&location=http%3A%2F%2Fevil.example"), "Set up for local law businesses.");
});

/* ── The DOM step, run against a stand-in document ─────────────────────── */

// Runs the real @audience-step code with a stand-in $, document and location. Any write to innerHTML (or the other
// HTML-parsing properties) on anything the step touches throws, so the step cannot use them without failing.
function runStep(search, { leadExists = true } = {}) {
  const queries = [];
  const created = [];
  const forbidHtml = (element) => {
    for (const property of ["innerHTML", "outerHTML"]) {
      Object.defineProperty(element, property, { set() { throw new Error(`${property} written`); }, get() { return ""; } });
    }
    element.insertAdjacentHTML = () => { throw new Error("insertAdjacentHTML called"); };
    return element;
  };
  const appended = [];
  const lead = forbidHtml({ appendChild(child) { appended.push(child); return child; } });
  const fakeDocument = {
    createElement(tag) {
      const element = forbidHtml({ tag, textContent: "" });
      created.push(element);
      return element;
    },
  };
  const find = (selector) => { queries.push(selector); return leadExists ? lead : null; };
  new Function("AUDIENCE", "location", "document", "$", stepSource)(AUDIENCE, { search }, fakeDocument, find);
  return { queries, created, appended };
}

test("with no params the step touches nothing: no query, no element created, nothing appended", () => {
  for (const search of ["", "?ref=paul", "?ref=paul&utm_source=meta", ...CASE_D]) {
    const run = runStep(search);
    assert.deepEqual(run.queries, [], search);
    assert.deepEqual(run.created, [], search);
    assert.deepEqual(run.appended, [], search);
  }
});

test("with values the step appends one span of plain text to the cover's lead paragraph", () => {
  const run = runStep(CASE_A);
  assert.deepEqual(run.queries, ['[data-scene="cover"] .text-lead-slide-body-v1']);
  assert.equal(run.created.length, 1);
  assert.equal(run.created[0].tag, "span");
  assert.equal(run.appended.length, 1);
  assert.equal(run.appended[0], run.created[0]);
  assert.equal(run.appended[0].textContent, " Set up for local law businesses in Toronto. Built for solo firms.");
});

test("each case adds exactly its sentence, with a space in front", () => {
  assert.equal(runStep(CASE_B).appended[0].textContent, " Built for solo firms.");
  assert.equal(runStep(CASE_E).appended[0].textContent, " Set up for local businesses in St.Louis.");
  assert.equal(runStep("?ref=paul&industry=hvac&location=ontario").appended[0].textContent, " Set up for local HVAC businesses in Ontario.");
});

test("a value carrying markup is never parsed: it is rejected, and even an accepted one only goes in as textContent", () => {
  assert.equal(runStep("?icp=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E&location=%3Cb%3EToronto%3C%2Fb%3E").appended.length, 0);
  const run = runStep("?icp=solo%20%26%20firms");
  assert.equal(run.appended[0].textContent, " Built for solo & firms.", "& stays a plain character");
});

test("if the cover's lead paragraph is missing the step does nothing and does not throw", () => {
  const run = runStep(CASE_A, { leadExists: false });
  assert.deepEqual(run.created, []);
  assert.deepEqual(run.appended, []);
});

/* ── What the served page keeps ────────────────────────────────────────── */

const coverMarkup = deck.slice(deck.indexOf('data-scene="cover"'), deck.indexOf("</section>", deck.indexOf('data-scene="cover"')));
const servedMarkup = deck.slice(0, deck.indexOf("<script"));

test("the cover keeps its eyebrow chip, h1 and lead paragraph exactly as served", () => {
  assert.ok(coverMarkup.includes("</i>For painters, contractors and home-service pros</span>"));
  assert.ok(coverMarkup.includes('<h1 class="text-display-cover-headline-v1" data-r>The office team your trades business never had time to hire.</h1>'));
  assert.ok(
    coverMarkup.includes(
      '<p class="text-lead-slide-body-v1" data-r>Agents that fill your calendar and do the legwork, plus one brain that shows you where the business leaks. You stay on the job.</p>',
    ),
  );
});

test("the step's selector finds exactly one element in the served cover: the lead paragraph", () => {
  const leads = coverMarkup.match(/<[a-z0-9]+ [^>]*\btext-lead-slide-body-v1\b[^>]*>/g) || [];
  assert.equal(leads.length, 1);
  assert.match(leads[0], /^<p class="text-lead-slide-body-v1" data-r>$/);
});

test("the served markup carries no audience sentence: it is added by the script after load", () => {
  assert.doesNotMatch(servedMarkup, /Set up for local|Built for/);
});

/* ── Scope ─────────────────────────────────────────────────────────────── */

test("the pure block has no DOM calls, and the step writes through textContent only", () => {
  const pureCode = withoutComments(audienceSource);
  // A bare browser global: not a property (values.location), a key (location:) or a quoted param name ('location').
  assert.doesNotMatch(pureCode, /(?<![.'"\w])(?:document|window|location|sessionStorage|localStorage)(?![\w'"]|\s*:)|\$\$?\(/);
  assert.doesNotMatch(pureCode, /innerHTML|outerHTML|insertAdjacentHTML|createElement|appendChild/);

  const stepCode = withoutComments(stepSource);
  assert.match(stepCode, /\.textContent\s*=/);
  assert.doesNotMatch(stepCode, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
});

test("LINKS and the audience code do not know about each other", () => {
  assert.doesNotMatch(withoutComments(audienceSource), /\bLINKS\b/);
  assert.doesNotMatch(withoutComments(stepSource), /\bLINKS\b|data-cta|\.href\b/);
  assert.doesNotMatch(liftBlock("links"), /\bAUDIENCE\b/);
  const startUp = deck.slice(deck.indexOf("/* Start-up: choose the deck version"), deck.indexOf("/* ═══════════════════════ Audience:"));
  assert.doesNotMatch(startUp, /AUDIENCE/);
});

test("the audience code reads no param other than industry, location and icp, and never the deck's other keys", () => {
  const readCode = withoutComments(audienceSource);
  assert.deepEqual([...new Set([...readCode.matchAll(/k === '([a-z]+)'/g)].map((match) => match[1]))].sort(), ["icp", "industry", "location"]);
  assert.doesNotMatch(readCode, /'business'|'state'|sessionStorage|afd_tracking_params/);
});

test("the head tags and the page's JSON-LD story are untouched: no audience code before the script, no JSON-LD added", () => {
  assert.doesNotMatch(servedMarkup, /\bAUDIENCE\b/);
  assert.doesNotMatch(deck, /application\/ld\+json/);
});
