'use client';
import { useState } from 'react';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

interface Props {
  rows: Record<string, unknown>[];
  chartRef?: React.RefObject<HTMLDivElement | null>;
  filename?: string;
}

export default function ExportMenu({ rows, chartRef, filename = 'report' }: Props) {
  const [open, setOpen] = useState(false);

  const exportExcel = () => {
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Report');
    XLSX.writeFile(wb, `${filename}.xlsx`);
    setOpen(false);
  };

  const exportPdf = () => {
    const doc = new jsPDF({ orientation: 'landscape' });
    const cols = Object.keys(rows[0] ?? {});
    doc.setFontSize(8);
    doc.text(cols.join('  |  '), 10, 10);
    rows.slice(0, 50).forEach((row, i) => {
      doc.text(cols.map(c => String(row[c] ?? '')).join('  |  '), 10, 18 + i * 6);
    });
    doc.save(`${filename}.pdf`);
    setOpen(false);
  };

  const exportPng = async () => {
    if (!chartRef?.current) return;
    try {
      const canvas = await html2canvas(chartRef.current);
      const link = document.createElement('a');
      link.download = `${filename}.png`;
      link.href = canvas.toDataURL();
      link.click();
      setOpen(false);
    } catch (e) {
      console.error('PNG export failed:', e);
    }
  };

  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)}
        className="px-3 py-1.5 text-sm border border-zinc-300 rounded hover:bg-zinc-50">
        Export ▾
      </button>
      {open && (
        <div className="absolute right-0 mt-1 bg-white border border-zinc-200 rounded shadow-lg z-10 text-sm">
          <button onClick={exportExcel} className="block w-full px-4 py-2 hover:bg-zinc-50 text-left">Excel (.xlsx)</button>
          <button onClick={exportPdf} className="block w-full px-4 py-2 hover:bg-zinc-50 text-left">PDF</button>
          {chartRef && <button onClick={exportPng} className="block w-full px-4 py-2 hover:bg-zinc-50 text-left">PNG (chart)</button>}
        </div>
      )}
    </div>
  );
}
