/**
 * Human-readable model name for run dashboard (avoids "Unavailable" during training or partial reports).
 */
export function resolveDev2BaseModelName(report) {
  const choice = report?.dev2?.choice;
  if (!choice) return null;
  if (choice.type === "ensemble" && Array.isArray(choice.members) && choice.members.length > 0) {
    return `Ensemble (${choice.members.join(", ")})`;
  }
  const first = Array.isArray(choice.members) ? choice.members[0] : null;
  if (first) return first;
  return null;
}

/** @param {[string, number][] | undefined} ranked */
function firstRankedModelName(ranked) {
  if (!Array.isArray(ranked) || ranked.length === 0) return null;
  const row = ranked[0];
  if (Array.isArray(row) && row.length > 0 && typeof row[0] === "string") return row[0];
  return null;
}

/**
 * @param {object | null} report
 * @param {string} [status] run.status
 */
export function resolveFinalChosenModelLabel(report, status) {
  if (status === "running" || status === "pending") {
    return "Training in progress…";
  }
  if (status === "failed") {
    return "Not available (run failed)";
  }

  const base = resolveDev2BaseModelName(report) || firstRankedModelName(report?.dev2?.ranked_models);
  const sv = report?.dev3?.selected_model_version;
  const best = report?.dev3?.best_candidate_name;

  if (sv === "improved" || sv === "randomized_search") {
    if (best) return best;
    if (base) return base;
    if (sv === "randomized_search") return "Tuned model (randomized search)";
    return best || base || "See model metrics below";
  }

  if (base) return base;
  if (best) return best;
  return "See report when training finishes";
}
