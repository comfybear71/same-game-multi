/** Post-read checks so incomplete JPEG line-ups are obvious before betting. */

export type LineupRowAudit = {
  team: string;
  playerName: string;
  jumper: number | null;
  status: "named" | "interchange" | "emergency";
};

/** Selected side = named + interchange (excludes emergencies). */
export function selectedCount(rows: LineupRowAudit[], team: string): number {
  return rows.filter(
    (r) => r.team === team && r.status !== "emergency",
  ).length;
}

/**
 * Typical AFL selected squad is 22 (18 on field + 4 interchange). Vision often
 * drops names on JPEG team sheets — warn well before that.
 */
export const MIN_SELECTED_PER_TEAM = 20;

export function auditLineupRows(
  rows: LineupRowAudit[],
  homeTeam: string,
  awayTeam: string,
): string[] {
  const warnings: string[] = [];
  const teams = [homeTeam, awayTeam];

  for (const team of teams) {
    const n = selectedCount(rows, team);
    if (n > 0 && n < MIN_SELECTED_PER_TEAM) {
      warnings.push(
        `${team}: only ${n} selected players (expected ~22). The screenshot read is incomplete — re-upload the full team sheet (try list view + field view, or paste Match Centre text).`,
      );
    }
  }

  const homeSel = selectedCount(rows, homeTeam);
  const awaySel = selectedCount(rows, awayTeam);
  if (homeSel > 0 && awaySel > 0 && Math.abs(homeSel - awaySel) >= 6) {
    warnings.push(
      `Uneven squads (${homeTeam} ${homeSel} vs ${awayTeam} ${awaySel} selected). One side may be missing from the screenshot — check Review squad before generating predictions.`,
    );
  }

  const byJumper = new Map<number, string[]>();
  for (const r of rows) {
    if (r.jumper == null || r.status === "emergency") continue;
    const list = byJumper.get(r.jumper) ?? [];
    list.push(`${r.playerName} (${r.team})`);
    byJumper.set(r.jumper, list);
  }
  for (const [jumper, names] of byJumper) {
    const teamSet = new Set(
      rows
        .filter((r) => r.jumper === jumper && r.status !== "emergency")
        .map((r) => r.team),
    );
    // Same guernsey on both clubs is normal — only warn if duplicated on one club.
    if (teamSet.size > 1) continue;
    if (names.length > 1) {
      warnings.push(
        `Guernsey #${jumper} appears more than once on ${names[0]?.match(/\(([^)]+)\)/)?.[1] ?? "one club"} (${names.join(", ")}). Re-upload or fix in Review squad.`,
      );
    }
  }

  return warnings;
}
