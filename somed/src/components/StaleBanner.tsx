interface Props {
  onRefresh: () => void;
  onRefreshAll: () => void;
}

export default function StaleBanner({ onRefresh, onRefreshAll }: Props) {
  return (
    <div className="mb-4 flex items-center gap-3 px-4 py-2 bg-amber-50 border border-amber-200 rounded text-sm text-amber-800">
      <span>New data available — results below are from previous data.</span>
      <button onClick={onRefresh} className="underline hover:no-underline">Refresh This</button>
      <button onClick={onRefreshAll} className="underline hover:no-underline">Refresh All</button>
    </div>
  );
}
