import ExcelJS from 'exceljs';
import type { MasterStudent, StoredEventRecord } from '../db';
import { fetchBackup, restoreBackup } from '../db';

export async function exportClearanceToExcel(
  master: MasterStudent[],
  events: StoredEventRecord[],
  getSt: (m: MasterStudent, ev: StoredEventRecord) => string,
  getEvCl: (m: MasterStudent, ev: StoredEventRecord) => string,
  getCl: (m: MasterStudent) => string,
  overallClearanceColName: string = 'Overall Clearance'
): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Unblocking Attendance Checker';
  workbook.lastModifiedBy = 'Unblocking Attendance Checker';
  workbook.created = new Date();
  workbook.modified = new Date();

  const worksheet = workbook.addWorksheet('Clearance', {
    views: [{ state: 'frozen', xSplit: 2, ySplit: 1 }], // Freeze header row and ID/Last Name
  });

  const headers = [
    'Student ID',
    'Last Name',
    'First Name',
    'Program',
    'Year Level',
    'Remarks',
    ...events.flatMap((e) => [e.name, e.clearanceColName || `${e.name} Clearance`]),
    overallClearanceColName,
  ];

  // Add Header Row
  const headerRow = worksheet.addRow(headers);
  headerRow.height = 24;
  headerRow.font = { bold: true, size: 11, color: { argb: 'FF1D2623' } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFF0F2F1' },
  };
  // Align header cells (columns 7 onwards are centered for status and clearances)
  headerRow.eachCell((cell, colNumber) => {
    cell.alignment = {
      vertical: 'middle',
      horizontal: colNumber >= 7 ? 'center' : 'left',
    };
  });

  // Add Data Rows
  master.forEach((m) => {
    const rowData = [
      m.studentId,
      m.lastName,
      m.firstName,
      m.program,
      m.yearLevel,
      m.remarks,
      ...events.flatMap((ev) => [getSt(m, ev), getEvCl(m, ev)]),
      getCl(m),
    ];
    const row = worksheet.addRow(rowData);
    row.height = 20;
    // Align student info left, status and clearances centered
    row.eachCell((cell, colNumber) => {
      cell.alignment = {
        vertical: 'middle',
        horizontal: colNumber >= 7 ? 'center' : 'left',
      };
    });
  });

  // Apply Data Validation (Native Dropdowns in Excel)
  // Rows 2 to Math.max(master.length + 1, 2)
  const startRow = 2;
  const endRow = Math.max(master.length + 1, 50); // Provide dropdowns for all current rows and extra rows

  events.forEach((_, evIndex) => {
    // 1-based column indices:
    // 1: ID, 2: Last, 3: First, 4: Program, 5: Year, 6: Remarks
    // 7: Event 1 Status, 8: Event 1 Clearance, 9: Event 2 Status, 10: Event 2 Clearance...
    const statusColIndex = 7 + evIndex * 2;
    const clearanceColIndex = 8 + evIndex * 2;

    for (let r = startRow; r <= endRow; r++) {
      // Dropdown for attendance status
      worksheet.getCell(r, statusColIndex).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: ['"Present,Absent,Incomplete,Excused,No record"'],
        showErrorMessage: true,
        errorTitle: 'Invalid Attendance Status',
        error: 'Please choose Present, Absent, Incomplete, Excused, or No record',
      };

      // Dropdown for event clearance
      worksheet.getCell(r, clearanceColIndex).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: ['"Blocked,Cleared"'],
        showErrorMessage: true,
        errorTitle: 'Invalid Clearance',
        error: 'Please choose Blocked or Cleared',
      };
    }
  });

  // Overall Clearance Column
  const overallColIndex = 7 + events.length * 2;
  for (let r = startRow; r <= endRow; r++) {
    worksheet.getCell(r, overallColIndex).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: ['"Blocked,Cleared"'],
      showErrorMessage: true,
      errorTitle: 'Invalid Clearance',
      error: 'Please choose Blocked or Cleared',
    };
  }

  // Set intelligent column widths
  worksheet.columns.forEach((col, idx) => {
    const headerTitle = headers[idx] || '';
    if (idx === 0) col.width = 16; // Student ID
    else if (idx === 1 || idx === 2) col.width = 18; // Last & First Name
    else if (idx === 3) col.width = 16; // Program
    else if (idx === 4) col.width = 12; // Year Level
    else if (idx === 5) col.width = 20; // Remarks
    else {
      col.width = Math.max(16, headerTitle.length + 3);
    }
  });

  // Generate buffer and trigger browser download
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'clearance-status.xlsx';
  a.click();
  URL.revokeObjectURL(url);
}

export async function exportDatabaseBackupJSON(): Promise<void> {
  const data = await fetchBackup();

  const backupData = {
    version: 1,
    system: 'ClearPass Cloud DB',
    exportedAt: new Date().toISOString(),
    data,
  };

  const jsonStr = JSON.stringify(backupData, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `attendance-unblocking-db-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function importDatabaseBackupJSON(file: File): Promise<{
  success: boolean;
  message: string;
}> {
  try {
    const text = await file.text();
    const backup = JSON.parse(text);

    if (!backup.data || !backup.data.students || !backup.data.events) {
      throw new Error('Invalid backup file format.');
    }

    await restoreBackup(backup.data);

    return {
      success: true,
      message: `Restored ${backup.data.students.length} students and ${backup.data.events.length} events from backup.`,
    };
  } catch (err: any) {
    return {
      success: false,
      message: `Failed to restore database: ${err?.message || 'Unknown error'}`,
    };
  }
}
