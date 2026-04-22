interface Props {
  label: string;
  value: string | number;
  sub?: string;
  alert?: boolean;
}

export default function KpiCard({ label, value, sub, alert }: Props) {
  return (
    <div className={`bg-white rounded-lg border p-4 ${alert ? 'border-red-300' : 'border-zinc-200'}`}>
      <p className="text-xs text-zinc-500 uppercase tracking-wider">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${alert ? 'text-red-600' : 'text-zinc-800'}`}>{value}</p>
      {sub && <p className="text-xs text-zinc-400 mt-1">{sub}</p>}
    </div>
  );
}
