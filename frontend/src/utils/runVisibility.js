/** Runs created before showInProjects may omit the field; treat as visible for backward compatibility. */
export function runVisibleOnProjectsPage(run) {
  if (!run) return false;
  if (run.showInProjects === false) return false;
  return true;
}
