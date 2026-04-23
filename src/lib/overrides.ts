export interface ReportOverride {
  sql: string;
  savedAt: string;
}

export async function fetchOverrides(): Promise<Record<string, ReportOverride>> {
  const res = await fetch('/api/blob/overrides');
  if (!res.ok) return {};
  return (await res.json()) as Record<string, ReportOverride>;
}

async function putOverrides(overrides: Record<string, ReportOverride>): Promise<void> {
  const res = await fetch('/api/blob/overrides', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ overrides }),
  });
  if (!res.ok) throw new Error(`Failed to save overrides: ${await res.text()}`);
}

export async function saveOverride(reportId: string, sql: string): Promise<ReportOverride> {
  const current = await fetchOverrides();
  const override: ReportOverride = { sql, savedAt: new Date().toISOString() };
  await putOverrides({ ...current, [reportId]: override });
  return override;
}

export async function deleteOverride(reportId: string): Promise<void> {
  const current = await fetchOverrides();
  if (!(reportId in current)) return;
  const { [reportId]: _removed, ...rest } = current;
  void _removed;
  await putOverrides(rest);
}
