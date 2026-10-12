export type AttendanceStatus = 'Present' | 'Absent' | 'Incomplete' | 'Excused' | 'No record';

export type ClearanceStatus = 'Cleared' | 'Blocked';

export interface Student {
  id: string; // Internal primary key
  studentId: string; // e.g. "2024-00123"
  lastName: string;
  firstName: string;
  fullName: string;
  program: string; // e.g. "BS Computer Science"
  yearLevel: string; // e.g. "3rd Year" or "3"
  remarks: string;
  createdAt: number;
  updatedAt: number;
}

export interface EventRecord {
  id: string;
  name: string;
  date: string;
  category?: string;
  isMandatory: boolean;
  academicTerm: string;
  fileName?: string;
  createdAt: number;
}

export interface AttendanceEntry {
  id: string; // compound key `${studentId}||${eventId}`
  studentId: string;
  eventId: string;
  status: AttendanceStatus;
  recordedAt: number;
  source: 'import' | 'manual' | 'override';
  notes?: string;
}

export interface ClearanceOverride {
  id: string; // `${studentId}` for overall or `${studentId}||${eventId}` for event
  targetType: 'overall' | 'event';
  studentId: string;
  eventId?: string;
  status: ClearanceStatus;
  reason?: string;
  unblockedBy?: string;
  updatedAt: number;
}

export interface AuditLog {
  id: string;
  timestamp: number;
  action: string;
  studentId?: string;
  studentName?: string;
  eventId?: string;
  eventName?: string;
  details: string;
}

export interface SystemSettings {
  id: string;
  schoolName: string;
  organizationName: string;
  clearanceOfficerName: string;
  excusedIsCleared: boolean;
  requireAllEvents: boolean;
  currentTerm: string;
}

export interface ParsedStudentRow {
  studentId: string;
  lastName: string;
  firstName: string;
  program: string;
  yearLevel: string;
  remarks: string;
  status?: AttendanceStatus;
  raw: Record<string, any>;
}

export interface EventParseResult {
  fileName: string;
  eventName: string;
  rows: ParsedStudentRow[];
  detectedStatusCol?: string;
  totalRows: number;
}

export interface MatchingSummary {
  eventId: string;
  eventName: string;
  matchedCount: number;
  missingInEventCount: number;
  extraInEventCount: number;
  extraStudents: { id: string; name: string; status: AttendanceStatus }[];
}
