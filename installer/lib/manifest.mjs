export function buildInstallation(plan, packageVersion) {
  const now = new Date().toISOString();
  const prior = plan.installation;
  return {
    schemaVersion: 1,
    installer: { name: 'starter-harness', version: packageVersion },
    profile: plan.profile,
    installedAt: prior?.installedAt ?? now,
    updatedAt: now,
    catalog: { schemaVersion: 1, hash: plan.catalogHash },
    baseline: plan.baseline,
    options: {
      projectName: plan.values.name,
      projectSlug: plan.values.slug,
    },
    artifacts: plan.operations
      .filter((operation) => operation.id)
      .map((operation) => ({
        id: operation.id,
        path: operation.path,
        ownership: operation.ownership,
        ...(operation.sourceHash ? { sourceHash: operation.sourceHash } : {}),
        ...(operation.installedHash ? { installedHash: operation.installedHash } : {}),
        ...(operation.lines ? { lines: operation.lines } : {}),
      })),
    migrations: plan.operations
      .filter((operation) => operation.ownership === 'migration' || operation.ownership === 'retirement')
      .map((operation) => ({
        path: operation.path,
        ...(operation.retiredId ? { retiredId: operation.retiredId } : {}),
        ...(operation.expectedHash ? { sourceHash: operation.expectedHash } : {}),
      })),
  };
}