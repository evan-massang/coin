// Verify the operator's council-teardown numbers against council_opinions.
import Database from "better-sqlite3";
const db = new Database("data/sniper.sqlite", { readonly: true });
const total = db.prepare("SELECT COUNT(*) n FROM council_opinions").get().n;
console.log("total opinions:", total);
const bySeat = db.prepare(`
  SELECT member_id, label, COUNT(*) n,
    SUM(CASE WHEN recommendation='confirm' THEN 1 ELSE 0 END) confirms,
    AVG(score) avgScore,
    SUM(CASE WHEN score=50 THEN 1 ELSE 0 END) exactly50,
    COUNT(DISTINCT score) distinctScores,
    COUNT(DISTINCT rationale) distinctRationales
  FROM council_opinions GROUP BY member_id`).all();
for (const s of bySeat) {
  console.log(`${s.member_id.padEnd(22)} n=${String(s.n).padStart(4)} confirm=${s.confirms} avg=${s.avgScore.toFixed(1)} score50=${s.exactly50} distinctScores=${s.distinctScores} distinctRationales=${s.distinctRationales}`);
}
const all50 = db.prepare("SELECT COUNT(*) n FROM council_opinions WHERE score=50").get().n;
console.log(`scores exactly 50: ${all50}/${total} (${((all50 / total) * 100).toFixed(0)}%)`);
const contra = db.prepare("SELECT COUNT(*) n FROM council_opinions WHERE recommendation='confirm' AND score < 55").get().n;
const confirms = db.prepare("SELECT COUNT(*) n FROM council_opinions WHERE recommendation='confirm'").get().n;
console.log(`CONFIRM with score<55: ${contra}/${confirms}`);
const rejects = db.prepare("SELECT COUNT(*) n FROM council_opinions WHERE recommendation NOT IN ('confirm','caution')").get().n;
console.log(`non confirm/caution verdicts: ${rejects}`);
// disconnect: council mints vs bought mints
const overlap = db.prepare(`
  SELECT COUNT(DISTINCT c.mint) n FROM council_opinions c
  WHERE c.mint IN (SELECT DISTINCT mint FROM paper_trades WHERE side='buy')`).get().n;
const councilMints = db.prepare("SELECT COUNT(DISTINCT mint) n FROM council_opinions").get().n;
const boughtMints = db.prepare("SELECT COUNT(DISTINCT mint) n FROM paper_trades WHERE side='buy'").get().n;
console.log(`council mints: ${councilMints} · bought mints: ${boughtMints} · overlap: ${overlap}`);
db.close();
