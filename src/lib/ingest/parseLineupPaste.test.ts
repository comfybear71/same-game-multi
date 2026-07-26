/**
 * Run: npx tsx --test src/lib/ingest/parseLineupPaste.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { parseLineupPaste, pasteToExtractedLineup } from "@/lib/ingest/parseLineupPaste";
import { selectedCount } from "@/lib/ingest/lineupAudit";

const SAMPLE = `37
Michael Sellwood
18
James O'Donnell
24
Buku Khamis
Full Backs
35
Nathan Broad
41
Kye Annand
11
Luke Trainor
29
Lachlan Bramble
Half Forwards
44
Seth Campbell
3
Dion Prestia
7
Rhyan Mansell
16
Jordan Croft
33
Aaron Naughton
3
Cody Weightman
Interchanges
15
Jayden Short
22
Sam Cumming
13
Hugo Ralphsmith
24
Sam Grlj
Emergencies
36
James Trezise
28
Kane McAuliffe
IN
Someone`;

describe("parseLineupPaste", () => {
  it("assigns away then home blocks and finds Naughton", () => {
    const { players } = parseLineupPaste(
      SAMPLE,
      "Western Bulldogs",
      "Richmond",
    );
    const naughton = players.find((p) => p.name.includes("Naughton"));
    assert.ok(naughton);
    assert.equal(naughton.jumper, 33);
    assert.ok(naughton.status === "named" || naughton.status === "interchange");

    const broad = players.find((p) => p.name.includes("Broad"));
    assert.equal(broad?.team, "away");
  });

  it("yields ~23 selected per side for full R20 paste", () => {
    const path =
      "src/lib/ingest/fixtures/bulldogs-richmond-r20-paste.txt";
    let full: string;
    try {
      full = readFileSync(path, "utf8");
    } catch {
      return; // optional fixture file
    }
    const extracted = pasteToExtractedLineup(
      full,
      "Western Bulldogs",
      "Richmond",
    );
    const rows = extracted.teams.flatMap((t) =>
      t.players.map((p) => ({
        team: t.team,
        playerName: p.name,
        jumper: p.jumper,
        status: p.status,
      })),
    );
    const homeSel = selectedCount(rows, "Western Bulldogs");
    const awaySel = selectedCount(rows, "Richmond");
    assert.ok(homeSel >= 19, `home selected ${homeSel}`);
    assert.ok(awaySel >= 19, `away selected ${awaySel}`);
    assert.ok(rows.some((r) => r.playerName.includes("Naughton")));
  });

  it("stops before IN/OUT panel", () => {
    const { players } = parseLineupPaste(SAMPLE, "Western Bulldogs", "Richmond");
    assert.ok(!players.some((p) => p.name === "Someone"));
  });

  it("parses Match Centre column copy for Brisbane v Port", () => {
    const path = "src/lib/ingest/fixtures/brisbane-port-paste-column.txt";
    let raw: string;
    try {
      raw = readFileSync(path, "utf8");
    } catch {
      return;
    }
    const { players } = parseLineupPaste(raw, "Brisbane Lions", "Port Adelaide");
    const answerth = players.find((p) => p.name.includes("Answerth"));
    const wilmot = players.find((p) => p.name.includes("Wilmot"));
    assert.equal(answerth?.team, "home");
    assert.equal(wilmot?.team, "home");
    const fort = players.find((p) => p.name.includes("Darcy Fort"));
    assert.equal(fort?.team, "home");
    assert.ok(!players.some((p) => p.team === "away" && p.name.includes("Answerth")));
  });

  it("does not treat Interchanges header as IN/OUT stop", () => {
    const block = `Full Forwards
1
A One
2
B Two
Interchanges
10
Int Away
11
Int Home
Emergencies
99
Em Only
IN
Panel`;
    const { players } = parseLineupPaste(block, "Home FC", "Away FC");
    assert.ok(players.some((p) => p.name === "Int Away" && p.status === "interchange"));
    assert.ok(players.some((p) => p.name === "Int Home" && p.status === "interchange"));
    assert.ok(!players.some((p) => p.name === "Panel"));
  });
});
