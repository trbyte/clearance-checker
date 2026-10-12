import * as XLSX from 'xlsx';

export const STAT = ['Present', 'Absent', 'Incomplete', 'Excused', 'No record'] as const;

export const norm = (s: unknown): string =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

export const cls = (s: unknown): string => {
  const n = norm(s);
  return 's-' + (n === 'norecord' || !s ? 'none' : n);
};

export const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
  }[c] || c));

export const MAPS: Record<string, RegExp> = {
  id: /student.*(id|no|num)|^id(no)?$|idnumber|student_id|sr_code|lrn/,
  last: /last|surname|family/,
  first: /first|given/,
  fullName: /^name$|student_name|full_name|student.*name/,
  program: /program|course|degree/,
  year: /year/,
  remarks: /remark|note/,
};

export const STATRE = /^(present|absent|incomplete|excused|draft)$/i;

// The attendance result is found by what the cells contain, not by header name
export function detectStatus(rows: any[][]): number | undefined {
  const n = rows.length || 1;
  const cnt: Record<number, number> = {};

  rows.forEach((r) =>
    r.forEach((c, i) => {
      if (STATRE.test(String(c ?? '').trim())) {
        cnt[i] = (cnt[i] || 0) + 1;
      }
    })
  );

  let best = -1;
  let bc = 0;
  for (const i in cnt) {
    if (cnt[i] > bc) {
      bc = cnt[i];
      best = Number(i);
    }
  }

  return bc / n > 0.15 ? best : undefined;
}

export const tidy = (s: unknown): string => {
  const str = String(s ?? '').trim();
  return str ? str[0].toUpperCase() + str.slice(1).toLowerCase() : '';
};

export const evName = (f: string): string =>
  f
    .replace(/\.[^.]+$/, '')
    .replace(/__\d+_?$/, '')
    .replace(/\s*\(\d+\)$/, '')
    .replace(/_/g, ' ')
    .replace(/^copy of\s+/i, '')
    .trim();

export async function readSheet(file: File): Promise<{
  rows: any[][];
  col: Record<string, number | undefined>;
}> {
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const rows: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {
    header: 1,
    defval: '',
    raw: false,
  });

  let h = rows.findIndex(
    (r, i) =>
      i < 20 &&
      r.some((c) => String(c ?? '').length < 30 && (MAPS.id.test(norm(c)) || MAPS.last.test(norm(c))))
  );
  if (h < 0) h = 0;

  const head = (rows[h] || []).map((c) => norm(c));
  const col: Record<string, number | undefined> = {};

  for (const k in MAPS) {
    const i = head.findIndex((x) => x && MAPS[k].test(x));
    if (i >= 0) col[k] = i;
  }

  return {
    rows: rows.slice(h + 1).filter((r) => r.some((c) => String(c ?? '').trim() !== '')),
    col,
  };
}

export const keyOf = (id: string, l: string, f: string): string =>
  norm(id) ? 'id:' + norm(id) : 'nm:' + norm(l) + '|' + norm(f);
