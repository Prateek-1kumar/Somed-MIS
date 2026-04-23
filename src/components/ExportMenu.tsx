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
    <div style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)} style={{
        padding: '6px 14px', borderRadius: '6px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
        border: '1px solid var(--border)', backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)',
        display: 'flex', alignItems: 'center', gap: '6px',
      }}>
        ↓ Export
      </button>
      {open && (
        <div style={{
          position: 'absolute', right: 0, top: 'calc(100% + 4px)', zIndex: 50, minWidth: '160px',
          backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '8px',
          boxShadow: '0 8px 24px rgba(0,0,0,0.12)', overflow: 'hidden',
        }}>
          {[
            { label: '📊 Excel (.xlsx)', action: exportExcel },
            { label: '📄 PDF', action: exportPdf },
            ...(chartRef ? [{ label: '🖼 PNG (chart)', action: exportPng }] : []),
          ].map(item => (
            <button key={item.label} onClick={item.action} style={{
              display: 'block', width: '100%', padding: '10px 16px', fontSize: '13px',
              textAlign: 'left', color: 'var(--text-primary)', backgroundColor: 'transparent',
              border: 'none', cursor: 'pointer',
            }}
            className="hover:bg-[--bg-surface-raised]">
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
