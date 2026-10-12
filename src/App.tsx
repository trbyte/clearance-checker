import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  STAT,
  norm,
  cls,
  detectStatus,
  tidy,
  evName,
  readSheet,
  keyOf,
} from './utils/excelParser';
import {
  loadFullLocalState,
  loadStateIfChanged,
  removeClearanceOverrides,
  type FullState,
  saveMasterList,
  saveSingleEvent,
  removeEventById,
  saveAttendanceEdit,
  saveClearanceOverride,
  renameEventInDb,
  updateEventClearanceColName,
  updateOverallClearanceColName,
  clearAllLocalData,
  type MasterStudent,
  type StoredEventRecord,
} from './db';
import {
  exportClearanceToExcel,
  exportDatabaseBackupJSON,
  importDatabaseBackupJSON,
} from './utils/exporter';
import { seedSampleDataset } from './utils/sampleData';
import {
  Download,
  Search,
  Trash2,
  FileSpreadsheet,
  Calendar,
  Sparkles,
  Printer,
  X,
  Upload,
  UserPlus,
  Pencil,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Filter,
  RotateCcw,
} from 'lucide-react';

export type SortField =
  | 'lastName'
  | 'firstName'
  | 'studentId'
  | 'program'
  | 'yearLevel'
  | 'remarks'
  | 'overallClearance'
  | `event_attend:${string}`
  | `event_clear:${string}`;

export type SortDirection = 'asc' | 'desc';

export default function App() {
  const [master, setMaster] = useState<MasterStudent[]>([]);
  const [events, setEvents] = useState<StoredEventRecord[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [clr, setClr] = useState<Record<string, string>>({});
  const [masterFileName, setMasterFileName] = useState<string>('');
  
  // Search, Filter & Sort State
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'cleared' | 'blocked'>('all');
  const [programFilter, setProgramFilter] = useState<string>('all');
  const [yearLevelFilter, setYearLevelFilter] = useState<string>('all');
  const [eventFilterName, setEventFilterName] = useState<string>('all');
  const [eventFilterStatus, setEventFilterStatus] = useState<string>('all');
  const [sortField, setSortField] = useState<SortField>('lastName');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  const [messages, setMessages] = useState<string[]>([]);
  const [isExporting, setIsExporting] = useState(false);
  const [selectedStudentForSlip, setSelectedStudentForSlip] = useState<MasterStudent | null>(null);

  // Rename Event State
  const [renamingEvent, setRenamingEvent] = useState<StoredEventRecord | null>(null);
  const [renameInputValue, setRenameInputValue] = useState('');

  // Edit Clearance Column Name State
  const [overallClearanceColName, setOverallClearanceColName] = useState<string>('Overall Clearance');
  const [editingClearanceCol, setEditingClearanceCol] = useState<
    { type: 'event'; event: StoredEventRecord } | { type: 'overall' } | null
  >(null);
  const [clearanceColInputValue, setClearanceColInputValue] = useState('');

  const masterInputRef = useRef<HTMLInputElement>(null);
  const eventInputRef = useRef<HTMLInputElement>(null);
  const [isDraggingMaster, setIsDraggingMaster] = useState(false);
  const [isDraggingEvents, setIsDraggingEvents] = useState(false);

  // Apply a snapshot from the shared cloud database
  const versionRef = useRef(-1);
  const applyState = (data: FullState) => {
    versionRef.current = data.version;
    setMaster(data.students);
    setEvents(data.events);
    setEdits(data.edits);
    setClr(data.clr);
    setMasterFileName(data.meta?.masterFileName ?? '');
    setOverallClearanceColName(data.meta?.overallClearanceColName ?? 'Overall Clearance');
  };

  // Load from cloud DB on startup, then poll so teammates' changes show up
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await loadFullLocalState();
        if (!cancelled) applyState(data);
      } catch (err) {
        console.error('Failed to load cloud DB:', err);
        addNotice('Could not load data from the cloud database. Check your connection and reload.');
      }
    })();
    const timer = setInterval(async () => {
      if (document.hidden) return;
      try {
        const data = await loadStateIfChanged(versionRef.current);
        if (data && !cancelled) applyState(data);
      } catch {
        /* transient network error; try again next tick */
      }
    }, 8000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const addNotice = (msg: string) => {
    setMessages((prev) => [...prev, msg]);
  };

  // Sort master A-Z by Last Name, then First Name
  const sortMasterList = (list: MasterStudent[]) => {
    return [...list].sort(
      (a, b) =>
        a.lastName.localeCompare(b.lastName, undefined, { sensitivity: 'base' }) ||
        a.firstName.localeCompare(b.firstName, undefined, { sensitivity: 'base' })
    );
  };

  // Precompute Event Matching Maps
  const processedEvents = useMemo(() => {
    return events.map((ev) => {
      const byId = new Map<string, string>();
      const byNm = new Map<string, string>();

      ev.recs.forEach((r) => {
        if (norm(r.id)) byId.set(norm(r.id), r.status);
        byNm.set(norm(r.last) + '|' + norm(r.first), r.status);
      });

      const map = new Map<string, string>();
      const used = new Set<string>();

      master.forEach((m) => {
        let s: string | undefined;
        let u: string | undefined;

        if (norm(m.studentId) && byId.has(norm(m.studentId))) {
          s = byId.get(norm(m.studentId));
          u = 'i' + norm(m.studentId);
        } else if (byNm.has(norm(m.lastName) + '|' + norm(m.firstName))) {
          s = byNm.get(norm(m.lastName) + '|' + norm(m.firstName));
          u = 'n' + norm(m.lastName) + '|' + norm(m.firstName);
        }

        if (u !== undefined) {
          map.set(m.key, s || '');
          used.add(u);
        }
      });

      const extra = ev.recs.filter(
        (r) =>
          !(
            used.has('i' + norm(r.id)) ||
            used.has('n' + norm(r.last) + '|' + norm(r.first))
          )
      );

      return {
        ...ev,
        map,
        used,
        extra,
      };
    });
  }, [events, master]);

  // Status resolution functions
  const getSt = (m: MasterStudent, ev: StoredEventRecord | { name: string }): string => {
    const k = m.key + '||' + ev.name;
    if (k in edits) return edits[k];
    const pe = processedEvents.find((e) => e.name === ev.name);
    if (pe && pe.map.has(m.key)) {
      return pe.map.get(m.key) || 'No record';
    }
    return 'No record';
  };

  // Event Clearance is "Blocked" by default for each event.
  // The user will be the one to clear it or modify the status after verifying via external site.
  const getEvCl = (m: MasterStudent, ev: StoredEventRecord | { name: string }): string => {
    const k = m.key + '||' + ev.name;
    return clr[k] || 'Blocked';
  };

  // Helper to check if student attended/excused all events based on raw attendance
  const isAllEventsAttended = (m: MasterStudent): boolean => {
    return (
      events.length > 0 &&
      events.every((ev) => {
        const st = norm(getSt(m, ev));
        return ['present', 'excused'].includes(st);
      })
    );
  };

  // Overall Clearance is also Blocked by default.
  // The user modifies it to Cleared when verified on an external site.
  const getCl = (m: MasterStudent): string => {
    return clr[m.key] || 'Blocked';
  };

  // Process Master List File (from input or drag & drop)
  const processMasterFile = async (file: File) => {
    setMessages([]);

    try {
      const { rows, col } = await readSheet(file);
      if (col.id === undefined && col.last === undefined) {
        addNotice('Could not find a Student ID column (or Last Name) in the master list.');
        return;
      }

      const g = (r: any[], k: string) =>
        col[k] === undefined ? '' : String(r[col[k]!] ?? '').trim();

      const newMaster: MasterStudent[] = rows.map((r, i) => {
        const id = g(r, 'id');
        const last = g(r, 'last');
        const first = g(r, 'first');
        return {
          id: 'std_' + (norm(id) || i),
          key: keyOf(id, last, first),
          studentId: id,
          lastName: last,
          firstName: first,
          program: g(r, 'program'),
          yearLevel: g(r, 'year'),
          remarks: g(r, 'remarks'),
        };
      });

      const sorted = sortMasterList(newMaster);
      setMaster(sorted);
      setMasterFileName(file.name);
      await saveMasterList(sorted, file.name);
    } catch (err: any) {
      addNotice(`Error parsing master list file: ${err?.message || 'Invalid format'}`);
    } finally {
      if (masterInputRef.current) masterInputRef.current.value = '';
    }
  };

  const handleMasterListUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await processMasterFile(file);
  };

  const handleClearMaster = async () => {
    setMaster([]);
    setMasterFileName('');
    await saveMasterList([], '');
    addNotice('Master list cleared.');
  };

  // Process Event Files (from input or drag & drop)
  const processEventFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setMessages([]);

    let currentMaster = [...master];
    const newEvents = [...events];

    for (const file of files) {
      try {
        const { rows, col } = await readSheet(file);
        const name = evName(file.name);
        const statusCol = detectStatus(rows);

        if (statusCol === undefined) {
          addNotice(`"${file.name}": could not find a column with Present / Absent / Incomplete values, skipped.`);
          continue;
        }

        if (col.id === undefined && col.last === undefined) {
          addNotice(`"${file.name}": no Student ID column found, skipped.`);
          continue;
        }

        const g = (r: any[], k: string) =>
          col[k] === undefined ? '' : String(r[col[k]!] ?? '').trim();

        const recs = rows
          .map((r) => ({
            id: g(r, 'id'),
            last: g(r, 'last'),
            first: g(r, 'first'),
            program: g(r, 'program'),
            year: g(r, 'year'),
            status: tidy(r[statusCol]),
          }))
          .filter((r) => r.id || r.last);

        // If no master list exists, build from first event
        if (currentMaster.length === 0) {
          currentMaster = recs.map((r, i) => ({
            id: 'std_' + (norm(r.id) || i),
            key: keyOf(r.id, r.last, r.first),
            studentId: r.id,
            lastName: r.last,
            firstName: r.first,
            program: r.program,
            yearLevel: r.year,
            remarks: '',
          }));
          currentMaster = sortMasterList(currentMaster);
          setMaster(currentMaster);
          setMasterFileName(`Built from ${name}`);
          await saveMasterList(currentMaster, `Built from ${name}`);
        }

        const existingIdx = newEvents.findIndex((x) => x.name === name);
        const storedEv: StoredEventRecord = {
          id: 'evt_' + norm(name),
          name,
          fileName: file.name,
          uploadedAt: Date.now(),
          clearanceColName: `${name} Clearance`,
          recs,
        };

        if (existingIdx >= 0) {
          newEvents[existingIdx] = {
            ...storedEv,
            clearanceColName: newEvents[existingIdx].clearanceColName || `${name} Clearance`,
          };
        } else {
          newEvents.push(storedEv);
        }

        await saveSingleEvent(storedEv);
      } catch (err: any) {
        addNotice(`Error parsing "${file.name}": ${err?.message || 'Invalid format'}`);
      }
    }

    setEvents(newEvents);
    if (eventInputRef.current) eventInputRef.current.value = '';
  };

  const handleEventFilesUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    await processEventFiles(files);
  };

  // Remove single event
  const handleRemoveEvent = async (evNameToRemove: string) => {
    const ev = events.find((e) => e.name === evNameToRemove);
    if (!ev) return;
    setEvents((prev) => prev.filter((e) => e.name !== evNameToRemove));
    await removeEventById(ev.id);
  };

  // Rename Event Title
  const openRenameModal = (ev: StoredEventRecord) => {
    setRenamingEvent(ev);
    setRenameInputValue(ev.name);
  };

  const handleSaveRename = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renamingEvent) return;
    const newName = renameInputValue.trim();
    if (!newName || newName === renamingEvent.name) {
      setRenamingEvent(null);
      return;
    }

    // Check duplicate
    if (events.some((ev) => ev.id !== renamingEvent.id && ev.name.toLowerCase() === newName.toLowerCase())) {
      addNotice(`An event named "${newName}" already exists.`);
      return;
    }

    const oldName = renamingEvent.name;

    // 1. Update cloud DB
    await renameEventInDb(oldName, newName);

    // 2. Update events state
    setEvents((prev) =>
      prev.map((ev) =>
        ev.id === renamingEvent.id
          ? {
              ...ev,
              name: newName,
              // If the clearance column name was using the default oldName Clearance, update it as well
              clearanceColName:
                ev.clearanceColName === `${oldName} Clearance` || !ev.clearanceColName
                  ? `${newName} Clearance`
                  : ev.clearanceColName,
            }
          : ev
      )
    );

    // 3. Update edits state
    setEdits((prev) => {
      const updated: Record<string, string> = {};
      for (const [k, v] of Object.entries(prev)) {
        if (k.endsWith('||' + oldName)) {
          const prefix = k.slice(0, k.length - oldName.length);
          updated[prefix + newName] = v;
        } else {
          updated[k] = v;
        }
      }
      return updated;
    });

    // 4. Update clr state
    setClr((prev) => {
      const updated: Record<string, string> = {};
      for (const [k, v] of Object.entries(prev)) {
        if (k.endsWith('||' + oldName)) {
          const prefix = k.slice(0, k.length - oldName.length);
          updated[prefix + newName] = v;
        } else {
          updated[k] = v;
        }
      }
      return updated;
    });

    setRenamingEvent(null);
  };

  // Open Edit Clearance Column Name
  const openEditEventClearanceModal = (ev: StoredEventRecord) => {
    setEditingClearanceCol({ type: 'event', event: ev });
    setClearanceColInputValue(ev.clearanceColName || `${ev.name} Clearance`);
  };

  const openEditOverallClearanceModal = () => {
    setEditingClearanceCol({ type: 'overall' });
    setClearanceColInputValue(overallClearanceColName);
  };

  const handleSaveClearanceCol = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingClearanceCol) return;
    const finalVal = clearanceColInputValue.trim();
    if (!finalVal) return;

    if (editingClearanceCol.type === 'event') {
      const evId = editingClearanceCol.event.id;
      setEvents((prev) =>
        prev.map((ev) => (ev.id === evId ? { ...ev, clearanceColName: finalVal } : ev))
      );
      await updateEventClearanceColName(evId, finalVal);
    } else {
      setOverallClearanceColName(finalVal);
      await updateOverallClearanceColName(finalVal);
    }

    setEditingClearanceCol(null);
  };

  // Handle dropdown change (auto-saved to cloud DB)
  const handleSelectChange = async (
    type: 'attendance' | 'eventClearance' | 'overallClearance',
    mKey: string,
    evNameOrVal: string,
    newVal?: string
  ) => {
    if (type === 'attendance') {
      const compositeKey = mKey + '||' + evNameOrVal;
      const val = newVal!;
      setEdits((prev) => ({ ...prev, [compositeKey]: val }));
      await saveAttendanceEdit(compositeKey, val);
    } else if (type === 'eventClearance') {
      const compositeKey = mKey + '||' + evNameOrVal;
      const val = newVal!;
      setClr((prev) => ({ ...prev, [compositeKey]: val }));
      await saveClearanceOverride(compositeKey, val);
    } else if (type === 'overallClearance') {
      const val = evNameOrVal;
      setClr((prev) => ({ ...prev, [mKey]: val }));
      await saveClearanceOverride(mKey, val);
    }
  };

  // Add extra student from report into master list
  const handleAddExtraStudent = async (r: {
    id: string;
    last: string;
    first: string;
    program: string;
    year: string;
  }) => {
    const newStudent: MasterStudent = {
      id: 'std_' + (norm(r.id) || Date.now()),
      key: keyOf(r.id, r.last, r.first),
      studentId: r.id,
      lastName: r.last,
      firstName: r.first,
      program: r.program || '',
      yearLevel: r.year || '',
      remarks: 'Added from event attendance',
    };
    const updated = sortMasterList([...master, newStudent]);
    setMaster(updated);
    await saveMasterList(updated, masterFileName);
  };

  // Unique programs & year levels for dropdown filters
  const uniquePrograms = useMemo(() => {
    const set = new Set<string>();
    master.forEach((m) => {
      const p = m.program?.trim();
      if (p) set.add(p);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [master]);

  const uniqueYearLevels = useMemo(() => {
    const set = new Set<string>();
    master.forEach((m) => {
      const y = m.yearLevel?.trim();
      if (y) set.add(y);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [master]);

  // Sort toggle handler
  const handleToggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // Check if any non-default filter or sort is active
  const isFilterActive =
    searchQuery.trim() !== '' ||
    statusFilter !== 'all' ||
    programFilter !== 'all' ||
    yearLevelFilter !== 'all' ||
    eventFilterName !== 'all' ||
    eventFilterStatus !== 'all' ||
    sortField !== 'lastName' ||
    sortDirection !== 'asc';

  // Reset all filters and sort to default
  const handleResetFiltersAndSort = () => {
    setSearchQuery('');
    setStatusFilter('all');
    setProgramFilter('all');
    setYearLevelFilter('all');
    setEventFilterName('all');
    setEventFilterStatus('all');
    setSortField('lastName');
    setSortDirection('asc');
  };

  // Sort indicator icon renderer for table headers
  const renderSortIndicator = (field: SortField) => {
    if (sortField === field) {
      return sortDirection === 'asc' ? (
        <ArrowUp className="w-3.5 h-3.5 text-[var(--acc)] inline-block shrink-0" />
      ) : (
        <ArrowDown className="w-3.5 h-3.5 text-[var(--acc)] inline-block shrink-0" />
      );
    }
    return (
      <ArrowUpDown className="w-3 h-3 text-[var(--mut)] opacity-35 group-hover:opacity-90 inline-block shrink-0 transition-opacity" />
    );
  };

  // Filtered and Sorted master students
  const filteredAndSortedMaster = useMemo(() => {
    // 1. Filtering
    const filtered = master.filter((m) => {
      // Search Query
      if (searchQuery.trim()) {
        const q = norm(searchQuery);
        const text = norm(`${m.studentId} ${m.lastName} ${m.firstName} ${m.program} ${m.remarks}`);
        if (!text.includes(q)) return false;
      }

      // Overall Clearance Status Filter
      const overall = getCl(m);
      if (statusFilter === 'cleared' && overall !== 'Cleared') return false;
      if (statusFilter === 'blocked' && overall !== 'Blocked') return false;

      // Program Filter
      if (programFilter !== 'all' && m.program.trim() !== programFilter) return false;

      // Year Level Filter
      if (yearLevelFilter !== 'all' && m.yearLevel.trim() !== yearLevelFilter) return false;

      // Event-Specific Filter
      if (eventFilterName !== 'all') {
        const targetEvent = events.find((e) => e.name === eventFilterName);
        if (targetEvent) {
          if (eventFilterStatus === 'Cleared') {
            if (getEvCl(m, targetEvent) !== 'Cleared') return false;
          } else if (eventFilterStatus === 'Blocked') {
            if (getEvCl(m, targetEvent) !== 'Blocked') return false;
          } else if (eventFilterStatus !== 'all') {
            const att = getSt(m, targetEvent);
            if (norm(att) !== norm(eventFilterStatus)) return false;
          }
        }
      }

      return true;
    });

    // 2. Sorting
    return [...filtered].sort((a, b) => {
      let comparison = 0;

      if (sortField === 'studentId') {
        comparison = a.studentId.localeCompare(b.studentId, undefined, { numeric: true, sensitivity: 'base' });
      } else if (sortField === 'lastName') {
        comparison =
          a.lastName.localeCompare(b.lastName, undefined, { sensitivity: 'base' }) ||
          a.firstName.localeCompare(b.firstName, undefined, { sensitivity: 'base' });
      } else if (sortField === 'firstName') {
        comparison =
          a.firstName.localeCompare(b.firstName, undefined, { sensitivity: 'base' }) ||
          a.lastName.localeCompare(b.lastName, undefined, { sensitivity: 'base' });
      } else if (sortField === 'program') {
        comparison =
          a.program.localeCompare(b.program, undefined, { sensitivity: 'base' }) ||
          a.lastName.localeCompare(b.lastName, undefined, { sensitivity: 'base' });
      } else if (sortField === 'yearLevel') {
        comparison =
          a.yearLevel.localeCompare(b.yearLevel, undefined, { numeric: true, sensitivity: 'base' }) ||
          a.lastName.localeCompare(b.lastName, undefined, { sensitivity: 'base' });
      } else if (sortField === 'remarks') {
        comparison =
          a.remarks.localeCompare(b.remarks, undefined, { sensitivity: 'base' }) ||
          a.lastName.localeCompare(b.lastName, undefined, { sensitivity: 'base' });
      } else if (sortField === 'overallClearance') {
        const clA = getCl(a);
        const clB = getCl(b);
        comparison =
          clA.localeCompare(clB) ||
          a.lastName.localeCompare(b.lastName, undefined, { sensitivity: 'base' });
      } else if (sortField.startsWith('event_attend:')) {
        const evNm = sortField.replace('event_attend:', '');
        const stA = getSt(a, { name: evNm });
        const stB = getSt(b, { name: evNm });
        comparison =
          stA.localeCompare(stB) ||
          a.lastName.localeCompare(b.lastName, undefined, { sensitivity: 'base' });
      } else if (sortField.startsWith('event_clear:')) {
        const evNm = sortField.replace('event_clear:', '');
        const ecA = getEvCl(a, { name: evNm });
        const ecB = getEvCl(b, { name: evNm });
        comparison =
          ecA.localeCompare(ecB) ||
          a.lastName.localeCompare(b.lastName, undefined, { sensitivity: 'base' });
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [
    master,
    searchQuery,
    statusFilter,
    programFilter,
    yearLevelFilter,
    eventFilterName,
    eventFilterStatus,
    sortField,
    sortDirection,
    events,
    clr,
    edits,
  ]);

  // Excel Download using current filtered and sorted view
  const handleDownloadExcel = async () => {
    if (filteredAndSortedMaster.length === 0 || isExporting) return;
    setIsExporting(true);
    try {
      await exportClearanceToExcel(
        filteredAndSortedMaster,
        events,
        getSt,
        getEvCl,
        getCl,
        overallClearanceColName
      );
    } catch (err) {
      console.error('Export error:', err);
      addNotice('Failed to generate Excel file: ' + String(err));
    } finally {
      setIsExporting(false);
    }
  };

  // Overall cleared counter
  const clearedCount = useMemo(() => {
    return master.filter((m) => getCl(m) === 'Cleared').length;
  }, [master, events, clr, edits]);

  const blockedCount = master.length - clearedCount;

  // Bulk action to mark attended students as Cleared (after verifying via external site)
  const handleBulkMarkAttendedCleared = async () => {
    const eligible = master.filter((m) => isAllEventsAttended(m) && getCl(m) !== 'Cleared');
    if (eligible.length === 0) {
      addNotice('No students with all events attended are pending clearance.');
      return;
    }
    if (
      confirm(
        `Mark ${eligible.length} student(s) who attended all events as Cleared (verified via external site)?`
      )
    ) {
      const updatedClr = { ...clr };
      for (const m of eligible) {
        updatedClr[m.key] = 'Cleared';
        await saveClearanceOverride(m.key, 'Cleared');
      }
      setClr(updatedClr);
      addNotice(`Marked ${eligible.length} student(s) as Cleared.`);
    }
  };

  // Bulk action to reset all clearances back to default Blocked
  const handleResetAllToBlocked = async () => {
    if (confirm('Reset all student clearances back to default Blocked?')) {
      const updatedClr = { ...clr };
      for (const m of master) {
        delete updatedClr[m.key];
      }
      setClr(updatedClr);
      await removeClearanceOverrides(master.map((m) => m.key));
      addNotice('All student clearances have been reset to default Blocked.');
    }
  };

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--ink)] p-5 font-sans">
      <div className="max-w-[1500px] mx-auto space-y-3.5">
        {/* Title Header with subtle local DB indicators */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] pb-3">
          <div>
            <h1 className="text-[22px] font-bold tracking-tight text-[var(--ink)] m-0 leading-tight">
              Unblocking Attendance Checker
            </h1>
            <p className="text-[14px] text-[var(--mut)] m-0 mt-1">
              Upload your event files (and member list). Everything is matched by Student ID and saved to the shared cloud database, so your team sees the same data. Clearance is Blocked by default until verified and modified via your external site.
            </p>
          </div>

          {/* Quiet Local Database Actions */}
          <div className="flex items-center gap-2 text-xs">
            <span
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-[var(--card)] text-[var(--okt)] border border-[var(--line)] font-medium"
              title="All data & manual overrides are saved to the shared cloud database"
            >
              <span className="w-2 h-2 rounded-full bg-[#1f5f4a]"></span>
              <span>Cloud DB Synced</span>
            </span>

            <button
              onClick={async () => {
                await seedSampleDataset();
                applyState(await loadFullLocalState());
              }}
              className="px-2.5 py-1 text-xs font-medium text-[var(--ink)] bg-[var(--card)] hover:bg-[var(--none)] border border-[var(--line)] rounded transition-colors cursor-pointer flex items-center gap-1"
              title="Load 15 sample students & 3 events"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-600" />
              <span>Load Sample</span>
            </button>

            <button
              onClick={exportDatabaseBackupJSON}
              className="px-2.5 py-1 text-xs font-medium text-[var(--ink)] bg-[var(--card)] hover:bg-[var(--none)] border border-[var(--line)] rounded transition-colors cursor-pointer flex items-center gap-1"
              title="Download full JSON database backup"
            >
              <Download className="w-3.5 h-3.5 text-[var(--mut)]" />
              <span>Backup</span>
            </button>

            <label
              className="px-2.5 py-1 text-xs font-medium text-[var(--ink)] bg-[var(--card)] hover:bg-[var(--none)] border border-[var(--line)] rounded transition-colors cursor-pointer flex items-center gap-1"
              title="Restore database from JSON"
            >
              <Upload className="w-3.5 h-3.5 text-[var(--mut)]" />
              <span>Restore</span>
              <input
                type="file"
                accept=".json"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const res = await importDatabaseBackupJSON(f);
                  if (res.success) {
                    applyState(await loadFullLocalState());
                  } else {
                    addNotice(res.message);
                  }
                  e.target.value = '';
                }}
              />
            </label>

            {(master.length > 0 || events.length > 0) && (
              <button
                onClick={async () => {
                  if (confirm('Clear the shared database and start fresh? This erases all saved events and overrides FOR EVERYONE on the team.')) {
                    await clearAllLocalData();
                    setMaster([]);
                    setEvents([]);
                    setEdits({});
                    setClr({});
                    setMasterFileName('');
                    setOverallClearanceColName('Overall Clearance');
                  }
                }}
                className="px-2 py-1 text-xs text-[var(--badt)] hover:bg-[var(--bad)] border border-[var(--line)] rounded transition-colors cursor-pointer"
                title="Wipe database to start fresh"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* 2 Step Boxes */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {/* Step 1: Master List */}
          <div
            className={`bg-[var(--card)] border rounded-lg p-3.5 transition-all ${
              isDraggingMaster
                ? 'border-[var(--acc)] bg-emerald-50/40 ring-2 ring-[var(--acc)]/25'
                : 'border-[var(--line)]'
            }`}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDraggingMaster(true);
            }}
            onDragLeave={() => setIsDraggingMaster(false)}
            onDrop={async (e) => {
              e.preventDefault();
              setIsDraggingMaster(false);
              const file = e.dataTransfer.files?.[0];
              if (file) {
                await processMasterFile(file);
              }
            }}
          >
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-[15px] font-semibold text-[var(--ink)] m-0">
                1. Master list of students
              </h2>
              <span className="text-[11px] font-medium text-[var(--mut)] bg-[var(--none)] px-2 py-0.5 rounded">
                Optional
              </span>
            </div>
            <p className="text-[var(--mut)] text-xs m-0 mb-3 leading-relaxed">
              Optional. If skipped, the first event file is automatically used as the list.
            </p>

            {/* Hidden native input */}
            <input
              ref={masterInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleMasterListUpload}
              className="hidden"
            />

            {/* Polished custom Choose File bar */}
            <div className="flex items-center gap-2 p-1.5 bg-[var(--bg)] border border-[var(--line)] rounded-md">
              <button
                type="button"
                onClick={() => masterInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold bg-[var(--card)] hover:bg-[var(--none)] text-[var(--ink)] border border-[var(--line)] shadow-2xs transition-colors cursor-pointer shrink-0"
              >
                <Upload className="w-3.5 h-3.5 text-[var(--acc)]" />
                <span>{master.length > 0 ? 'Change File' : 'Choose File'}</span>
              </button>

              {master.length === 0 ? (
                <div className="flex items-center justify-between flex-1 min-w-0 pr-1.5">
                  <span className="text-xs text-[var(--mut)] italic select-none">
                    No file chosen
                  </span>
                  <span className="text-[11px] text-[var(--mut)] font-mono opacity-80 hidden sm:inline">
                    .xlsx, .xls, .csv
                  </span>
                </div>
              ) : (
                <div className="flex items-center justify-between flex-1 min-w-0 pr-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                    <span className="text-xs font-semibold text-[var(--ink)] truncate max-w-[170px]" title={masterFileName}>
                      {masterFileName || 'Master List'}
                    </span>
                    <span className="text-[11px] text-[var(--mut)] shrink-0">
                      ({master.length} students)
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handleClearMaster}
                    className="text-[var(--mut)] hover:text-[var(--badt)] font-bold text-sm leading-none p-1 cursor-pointer transition-colors"
                    title="Remove master list"
                  >
                    ×
                  </button>
                </div>
              )}
            </div>

            <div className="mt-2 text-[11px] text-[var(--mut)] flex items-center justify-between">
              <span>Drag & drop student Excel or CSV file here, or click Choose File</span>
              {master.length > 0 && (
                <span className="text-emerald-700 font-medium text-[11px]">✓ Ready</span>
              )}
            </div>
          </div>

          {/* Step 2: Event Attendance Files */}
          <div
            className={`bg-[var(--card)] border rounded-lg p-3.5 transition-all ${
              isDraggingEvents
                ? 'border-[var(--acc)] bg-emerald-50/40 ring-2 ring-[var(--acc)]/25'
                : 'border-[var(--line)]'
            }`}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDraggingEvents(true);
            }}
            onDragLeave={() => setIsDraggingEvents(false)}
            onDrop={async (e) => {
              e.preventDefault();
              setIsDraggingEvents(false);
              const droppedFiles = Array.from(e.dataTransfer.files || []);
              if (droppedFiles.length > 0) {
                await processEventFiles(droppedFiles);
              }
            }}
          >
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-[15px] font-semibold text-[var(--ink)] m-0">
                2. Event attendance files
              </h2>
              <span className="text-[11px] font-medium text-[var(--mut)] bg-[var(--none)] px-2 py-0.5 rounded">
                Multi-select
              </span>
            </div>
            <p className="text-[var(--mut)] text-xs m-0 mb-3 leading-relaxed">
              One file per event. Select several at once. Present / Absent / Incomplete is found automatically.
            </p>

            {/* Hidden native input */}
            <input
              ref={eventInputRef}
              type="file"
              multiple
              accept=".xlsx,.xls,.csv"
              onChange={handleEventFilesUpload}
              className="hidden"
            />

            {/* Polished custom Choose File bar */}
            <div className="flex items-center gap-2 p-1.5 bg-[var(--bg)] border border-[var(--line)] rounded-md">
              <button
                type="button"
                onClick={() => eventInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold bg-[var(--card)] hover:bg-[var(--none)] text-[var(--ink)] border border-[var(--line)] shadow-2xs transition-colors cursor-pointer shrink-0"
              >
                <Upload className="w-3.5 h-3.5 text-[var(--acc)]" />
                <span>{events.length > 0 ? 'Choose More Files' : 'Choose Files'}</span>
              </button>

              <div className="flex items-center justify-between flex-1 min-w-0 pr-1.5">
                {events.length === 0 ? (
                  <>
                    <span className="text-xs text-[var(--mut)] italic select-none">
                      No file chosen
                    </span>
                    <span className="text-[11px] text-[var(--mut)] font-mono opacity-80 hidden sm:inline">
                      multiple files supported
                    </span>
                  </>
                ) : (
                  <>
                    <span className="text-xs font-semibold text-[var(--ink)] flex items-center gap-1.5 truncate">
                      <span className="w-2 h-2 rounded-full bg-emerald-600 shrink-0"></span>
                      <span>
                        {events.length} {events.length === 1 ? 'event file imported' : 'event files imported'}
                      </span>
                    </span>
                    <span className="text-[11px] text-[var(--mut)] hidden sm:inline shrink-0">
                      Click to add more
                    </span>
                  </>
                )}
              </div>
            </div>

            {/* Event chips with Rename & Remove buttons */}
            {events.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 mt-2.5 max-h-24 overflow-y-auto pt-0.5">
                {events.map((e) => (
                  <span
                    key={e.name}
                    className="inline-flex items-center gap-1.5 bg-[var(--none)] text-[var(--ink)] pl-2.5 pr-2 py-0.5 rounded-full text-xs font-medium border border-[var(--line)] shadow-2xs"
                  >
                    <span
                      onClick={() => openRenameModal(e)}
                      className="cursor-pointer hover:underline truncate max-w-[140px]"
                      title={`Click to rename "${e.name}"`}
                    >
                      {e.name}
                    </span>
                    <span className="text-[10px] text-[var(--mut)] font-mono">
                      ({e.recs.length})
                    </span>
                    <button
                      type="button"
                      onClick={() => openRenameModal(e)}
                      className="border-0 bg-transparent text-[var(--mut)] hover:text-[var(--acc)] cursor-pointer text-xs p-0 leading-none flex items-center"
                      title="Rename event title"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemoveEvent(e.name)}
                      className="border-0 bg-transparent text-[var(--mut)] hover:text-[var(--badt)] cursor-pointer text-sm pl-0.5 leading-none font-bold"
                      title="Remove event"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <div className="mt-2 text-[11px] text-[var(--mut)]">
                Drag & drop multiple event attendance spreadsheets here, or click Choose Files
              </div>
            )}
          </div>
        </div>

        {/* Messages / Warnings */}
        {messages.length > 0 && (
          <div className="space-y-1.5">
            {messages.map((m, idx) => (
              <div
                key={idx}
                className="bg-[var(--warn)] text-[var(--warnt)] px-3 py-2 rounded-md text-xs flex items-center justify-between"
              >
                <span>{m}</span>
                <button
                  onClick={() => setMessages((prev) => prev.filter((_, i) => i !== idx))}
                  className="font-bold text-sm leading-none ml-2 cursor-pointer opacity-70 hover:opacity-100"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Control Bar & Filter Toolbar */}
        <div className="bg-[var(--card)] border border-[var(--line)] rounded-lg p-3 my-3 shadow-2xs space-y-2.5">
          {/* Main Controls Row */}
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Search box with clear button */}
            <div className="relative min-w-[220px] flex-1 max-w-xs">
              <Search className="w-3.5 h-3.5 text-[var(--mut)] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search name, ID, or program..."
                className="w-full pl-8 pr-7 py-1.5 border border-[var(--line)] rounded-md bg-[var(--bg)] text-[var(--ink)] text-xs focus:outline-none focus:border-[var(--acc)] transition-colors"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--mut)] hover:text-[var(--ink)] cursor-pointer text-xs"
                  title="Clear search"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Quick Status Filter Buttons */}
            <div className="flex items-center bg-[var(--bg)] border border-[var(--line)] rounded-md p-0.5 text-xs font-medium">
              <button
                type="button"
                onClick={() => setStatusFilter('all')}
                className={`px-2.5 py-1 rounded transition-colors cursor-pointer ${
                  statusFilter === 'all'
                    ? 'bg-[var(--card)] text-[var(--ink)] font-bold shadow-2xs'
                    : 'text-[var(--mut)] hover:text-[var(--ink)]'
                }`}
              >
                All ({master.length})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('cleared')}
                className={`px-2.5 py-1 rounded transition-colors cursor-pointer flex items-center gap-1 ${
                  statusFilter === 'cleared'
                    ? 'bg-[var(--ok)] text-[var(--okt)] font-bold shadow-2xs'
                    : 'text-[var(--mut)] hover:text-[var(--ink)]'
                }`}
              >
                <span>Cleared</span>
                <span className="text-[10px] font-mono px-1 py-0.2 bg-emerald-200/60 rounded">
                  {clearedCount}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('blocked')}
                className={`px-2.5 py-1 rounded transition-colors cursor-pointer flex items-center gap-1 ${
                  statusFilter === 'blocked'
                    ? 'bg-[var(--bad)] text-[var(--badt)] font-bold shadow-2xs'
                    : 'text-[var(--mut)] hover:text-[var(--ink)]'
                }`}
              >
                <span>Blocked</span>
                <span className="text-[10px] font-mono px-1 py-0.2 bg-rose-200/60 rounded">
                  {blockedCount}
                </span>
              </button>
            </div>

            {/* Sort Controls */}
            <div className="flex items-center gap-1.5 bg-[var(--bg)] border border-[var(--line)] rounded-md px-2 py-1 text-xs">
              <span className="text-[var(--mut)] font-medium">Sort:</span>
              <select
                value={sortField}
                onChange={(e) => setSortField(e.target.value as SortField)}
                className="bg-transparent font-semibold text-[var(--ink)] cursor-pointer focus:outline-none text-xs pr-1"
                title="Select column to sort by"
              >
                <option value="lastName">Last Name</option>
                <option value="firstName">First Name</option>
                <option value="studentId">Student ID</option>
                <option value="program">Program</option>
                <option value="yearLevel">Year Level</option>
                <option value="remarks">Remarks</option>
                <option value="overallClearance">Overall Clearance</option>
                {events.length > 0 && (
                  <>
                    <optgroup label="Event Attendance">
                      {events.map((ev) => (
                        <option key={'att_' + ev.name} value={'event_attend:' + ev.name}>
                          {ev.name} (Attendance)
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Event Clearance">
                      {events.map((ev) => (
                        <option key={'clr_' + ev.name} value={'event_clear:' + ev.name}>
                          {ev.clearanceColName || `${ev.name} Clearance`}
                        </option>
                      ))}
                    </optgroup>
                  </>
                )}
              </select>

              {/* Order Toggle (Ascending / Descending) */}
              <button
                type="button"
                onClick={() => setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))}
                className="inline-flex items-center gap-1 pl-1.5 pr-2 py-0.5 rounded bg-[var(--card)] hover:bg-[var(--none)] border border-[var(--line)] font-semibold text-[var(--ink)] cursor-pointer transition-colors"
                title={`Order: ${sortDirection === 'asc' ? 'Ascending (A-Z / 1-9)' : 'Descending (Z-A / 9-1)'}. Click to reverse order.`}
              >
                {sortDirection === 'asc' ? (
                  <ArrowUp className="w-3.5 h-3.5 text-[var(--acc)]" />
                ) : (
                  <ArrowDown className="w-3.5 h-3.5 text-[var(--acc)]" />
                )}
                <span>{sortDirection === 'asc' ? 'Asc (A-Z)' : 'Desc (Z-A)'}</span>
              </button>
            </div>

            {/* Download Excel Button */}
            <button
              onClick={handleDownloadExcel}
              disabled={filteredAndSortedMaster.length === 0 || isExporting}
              className="bg-[var(--acc)] hover:bg-[var(--acc-hover)] text-white border-0 rounded-md py-1.5 px-3.5 text-xs font-semibold cursor-pointer disabled:opacity-40 disabled:cursor-default flex items-center gap-1.5 transition-colors ml-auto shrink-0"
              title="Download filtered & sorted clearance-status.xlsx with interactive Excel dropdowns"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{isExporting ? 'Generating Excel...' : 'Download Excel'}</span>
            </button>
          </div>

          {/* Secondary Filters Bar & Summary */}
          {master.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[var(--line)]/70 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                {/* Program Filter */}
                {uniquePrograms.length > 0 && (
                  <div className="flex items-center gap-1">
                    <span className="text-[var(--mut)] text-[11px]">Program:</span>
                    <select
                      value={programFilter}
                      onChange={(e) => setProgramFilter(e.target.value)}
                      className="bg-[var(--bg)] border border-[var(--line)] rounded px-2 py-1 text-xs text-[var(--ink)] font-medium focus:outline-none cursor-pointer"
                    >
                      <option value="all">All Programs</option>
                      {uniquePrograms.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Year Level Filter */}
                {uniqueYearLevels.length > 0 && (
                  <div className="flex items-center gap-1">
                    <span className="text-[var(--mut)] text-[11px]">Year:</span>
                    <select
                      value={yearLevelFilter}
                      onChange={(e) => setYearLevelFilter(e.target.value)}
                      className="bg-[var(--bg)] border border-[var(--line)] rounded px-2 py-1 text-xs text-[var(--ink)] font-medium focus:outline-none cursor-pointer"
                    >
                      <option value="all">All Years</option>
                      {uniqueYearLevels.map((y) => (
                        <option key={y} value={y}>
                          {y}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Event Attendance / Clearance Filter */}
                {events.length > 0 && (
                  <div className="flex items-center gap-1">
                    <span className="text-[var(--mut)] text-[11px]">Event Filter:</span>
                    <select
                      value={eventFilterName}
                      onChange={(e) => {
                        setEventFilterName(e.target.value);
                        if (e.target.value === 'all') setEventFilterStatus('all');
                      }}
                      className="bg-[var(--bg)] border border-[var(--line)] rounded px-2 py-1 text-xs text-[var(--ink)] font-medium focus:outline-none cursor-pointer max-w-[150px]"
                    >
                      <option value="all">All Events</option>
                      {events.map((ev) => (
                        <option key={ev.name} value={ev.name}>
                          {ev.name}
                        </option>
                      ))}
                    </select>
                    {eventFilterName !== 'all' && (
                      <select
                        value={eventFilterStatus}
                        onChange={(e) => setEventFilterStatus(e.target.value)}
                        className="bg-[var(--bg)] border border-[var(--line)] rounded px-2 py-1 text-xs text-[var(--ink)] font-semibold focus:outline-none cursor-pointer"
                      >
                        <option value="all">Any Status</option>
                        <option value="Cleared">Cleared</option>
                        <option value="Blocked">Blocked</option>
                        <option value="Present">Present</option>
                        <option value="Absent">Absent</option>
                        <option value="Incomplete">Incomplete</option>
                        <option value="Excused">Excused</option>
                        <option value="No record">No record</option>
                      </select>
                    )}
                  </div>
                )}

                {/* Reset Filters & Sort button */}
                {isFilterActive && (
                  <button
                    type="button"
                    onClick={handleResetFiltersAndSort}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-md cursor-pointer transition-colors"
                    title="Reset all filters, search query, and sorting back to default"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Reset Filters & Sort</span>
                  </button>
                )}
              </div>

              {/* Bulk helpers & Row counter */}
              <div className="flex items-center gap-2 ml-auto">
                {events.length > 0 && (
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={handleBulkMarkAttendedCleared}
                      className="px-2 py-1 text-[11px] font-semibold text-emerald-900 bg-emerald-100 hover:bg-emerald-200 border border-emerald-300 rounded transition-colors cursor-pointer"
                      title="Mark all students who attended all events as Cleared (verified via external site)"
                    >
                      Mark Attended as Cleared
                    </button>
                    {clearedCount > 0 && (
                      <button
                        type="button"
                        onClick={handleResetAllToBlocked}
                        className="px-2 py-1 text-[11px] font-medium text-[var(--mut)] hover:text-[var(--badt)] bg-[var(--bg)] hover:bg-[var(--bad)] border border-[var(--line)] rounded transition-colors cursor-pointer"
                        title="Reset all student clearances back to default Blocked"
                      >
                        Reset All to Blocked
                      </button>
                    )}
                  </div>
                )}

                <span className="text-[var(--mut)] text-xs font-medium whitespace-nowrap">
                  Showing <strong className="text-[var(--ink)]">{filteredAndSortedMaster.length}</strong> of{' '}
                  {master.length} students
                  {isFilterActive && (
                    <span className="text-amber-800 ml-1 text-[11px] font-normal">(filtered)</span>
                  )}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Master Table Wrap */}
        <div className="overflow-x-auto border border-[var(--line)] rounded-lg bg-[var(--card)] max-h-[70vh]">
          <table className="border-collapse w-full text-xs">
            <thead>
              <tr>
                <th
                  onClick={() => handleToggleSort('studentId')}
                  className="p-2 border-b-2 border-[var(--line)] text-left whitespace-nowrap sticky top-0 bg-[var(--card)] z-10 cursor-pointer hover:bg-slate-100/80 select-none group transition-colors"
                  title="Click to sort by Student ID"
                >
                  <div className="flex items-center gap-1.5">
                    <span>Student ID</span>
                    {renderSortIndicator('studentId')}
                  </div>
                </th>
                <th
                  onClick={() => handleToggleSort('lastName')}
                  className="p-2 border-b-2 border-[var(--line)] text-left whitespace-nowrap sticky top-0 bg-[var(--card)] z-10 cursor-pointer hover:bg-slate-100/80 select-none group transition-colors"
                  title="Click to sort by Last Name"
                >
                  <div className="flex items-center gap-1.5">
                    <span>Last Name</span>
                    {renderSortIndicator('lastName')}
                  </div>
                </th>
                <th
                  onClick={() => handleToggleSort('firstName')}
                  className="p-2 border-b-2 border-[var(--line)] text-left whitespace-nowrap sticky top-0 bg-[var(--card)] z-10 cursor-pointer hover:bg-slate-100/80 select-none group transition-colors"
                  title="Click to sort by First Name"
                >
                  <div className="flex items-center gap-1.5">
                    <span>First Name</span>
                    {renderSortIndicator('firstName')}
                  </div>
                </th>
                <th
                  onClick={() => handleToggleSort('program')}
                  className="p-2 border-b-2 border-[var(--line)] text-left whitespace-nowrap sticky top-0 bg-[var(--card)] z-10 cursor-pointer hover:bg-slate-100/80 select-none group transition-colors"
                  title="Click to sort by Program"
                >
                  <div className="flex items-center gap-1.5">
                    <span>Program</span>
                    {renderSortIndicator('program')}
                  </div>
                </th>
                <th
                  onClick={() => handleToggleSort('yearLevel')}
                  className="p-2 border-b-2 border-[var(--line)] text-left whitespace-nowrap sticky top-0 bg-[var(--card)] z-10 cursor-pointer hover:bg-slate-100/80 select-none group transition-colors"
                  title="Click to sort by Year Level"
                >
                  <div className="flex items-center gap-1.5">
                    <span>Year Level</span>
                    {renderSortIndicator('yearLevel')}
                  </div>
                </th>
                <th
                  onClick={() => handleToggleSort('remarks')}
                  className="p-2 border-b-2 border-[var(--line)] text-left whitespace-nowrap sticky top-0 bg-[var(--card)] z-10 cursor-pointer hover:bg-slate-100/80 select-none group transition-colors"
                  title="Click to sort by Remarks"
                >
                  <div className="flex items-center gap-1.5">
                    <span>Remarks</span>
                    {renderSortIndicator('remarks')}
                  </div>
                </th>

                {/* Event Columns with Sort Buttons, Rename Title Button & Rename Clearance Header Button */}
                {events.map((e) => (
                  <React.Fragment key={e.name}>
                    {/* Event Attendance Header (Clickable to Sort) */}
                    <th className="p-2 border-b-2 border-[var(--line)] text-center whitespace-nowrap sticky top-0 bg-[var(--card)] z-10 border-l border-[var(--line)] select-none">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleToggleSort(`event_attend:${e.name}`)}
                          className="group inline-flex items-center gap-1 font-bold text-[var(--ink)] hover:text-[var(--acc)] cursor-pointer select-none bg-transparent border-0 p-0"
                          title={`Click to sort by ${e.name} attendance`}
                        >
                          <span>{e.name}</span>
                          {renderSortIndicator(`event_attend:${e.name}`)}
                        </button>
                        <button
                          type="button"
                          onClick={(evt) => {
                            evt.stopPropagation();
                            openRenameModal(e);
                          }}
                          className="border-0 bg-transparent cursor-pointer text-[var(--mut)] hover:text-[var(--acc)] p-0.5 ml-0.5"
                          title="Rename event title"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onClick={(evt) => {
                            evt.stopPropagation();
                            handleRemoveEvent(e.name);
                          }}
                          className="border-0 bg-transparent cursor-pointer text-[var(--mut)] hover:text-[var(--badt)] text-sm ml-0.5 leading-none font-bold"
                          title="Remove event"
                        >
                          ×
                        </button>
                      </div>
                    </th>

                    {/* Editable Event Clearance Header (Clickable to Sort) */}
                    <th className="p-2 border-b-2 border-[var(--line)] text-center whitespace-nowrap sticky top-0 bg-[var(--card)] z-10 border-r border-[var(--line)] select-none">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleToggleSort(`event_clear:${e.name}`)}
                          className="group inline-flex items-center gap-1 font-bold text-slate-800 hover:text-[var(--acc)] cursor-pointer select-none bg-transparent border-0 p-0"
                          title={`Click to sort by ${e.clearanceColName || `${e.name} Clearance`}`}
                        >
                          <span>{e.clearanceColName || `${e.name} Clearance`}</span>
                          {renderSortIndicator(`event_clear:${e.name}`)}
                        </button>
                        <button
                          type="button"
                          onClick={(evt) => {
                            evt.stopPropagation();
                            openEditEventClearanceModal(e);
                          }}
                          className="border-0 bg-transparent cursor-pointer text-[var(--mut)] hover:text-[var(--acc)] p-0.5 ml-0.5"
                          title="Edit clearance column name"
                        >
                          <Pencil className="w-3 h-3 text-[var(--acc)]" />
                        </button>
                      </div>
                      <span className="block text-[10px] font-normal text-[var(--mut)] mt-0.5">
                        (Blocked by default)
                      </span>
                    </th>
                  </React.Fragment>
                ))}

                {/* Editable Overall Clearance Column Header (Clickable to Sort) */}
                <th className="p-2 border-b-2 border-[var(--line)] text-center whitespace-nowrap sticky top-0 bg-[var(--card)] z-10 border-l border-[var(--line)] font-bold select-none">
                  <div className="flex items-center justify-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleToggleSort('overallClearance')}
                      className="group inline-flex items-center gap-1 font-bold text-[var(--ink)] hover:text-[var(--acc)] cursor-pointer select-none bg-transparent border-0 p-0"
                      title="Click to sort by Overall Clearance"
                    >
                      <span>{overallClearanceColName}</span>
                      {renderSortIndicator('overallClearance')}
                    </button>
                    <button
                      type="button"
                      onClick={(evt) => {
                        evt.stopPropagation();
                        openEditOverallClearanceModal();
                      }}
                      className="border-0 bg-transparent cursor-pointer text-[var(--mut)] hover:text-[var(--acc)] p-0.5 ml-0.5"
                      title="Edit overall clearance column name"
                    >
                      <Pencil className="w-3 h-3 text-[var(--acc)]" />
                    </button>
                  </div>
                  <span className="block text-[10px] font-normal text-[var(--mut)] mt-0.5">
                    (Blocked by default)
                  </span>
                </th>

                <th className="p-2 border-b-2 border-[var(--line)] text-center whitespace-nowrap sticky top-0 bg-[var(--card)] z-10">
                  Slip
                </th>
              </tr>
            </thead>

            <tbody>
              {filteredAndSortedMaster.length === 0 ? (
                <tr>
                  <td
                    colSpan={7 + events.length * 2}
                    className="p-8 text-center text-[var(--mut)] text-xs"
                  >
                    {master.length === 0
                      ? 'Upload your master list or event files to see attendance matching.'
                      : isFilterActive
                      ? 'No students match your active filters or search query.'
                      : 'No student found.'}
                  </td>
                </tr>
              ) : (
                filteredAndSortedMaster.map((m) => {
                  const overallCl = getCl(m);
                  return (
                    <tr key={m.key} className="hover:bg-[var(--bg)] transition-colors">
                      <td className="p-2 border-b border-[var(--line)] font-mono whitespace-nowrap">
                        {m.studentId}
                      </td>
                      <td className="p-2 border-b border-[var(--line)] font-semibold whitespace-nowrap">
                        {m.lastName}
                      </td>
                      <td className="p-2 border-b border-[var(--line)] whitespace-nowrap">
                        {m.firstName}
                      </td>
                      <td className="p-2 border-b border-[var(--line)] whitespace-nowrap text-[var(--mut)]">
                        {m.program}
                      </td>
                      <td className="p-2 border-b border-[var(--line)] whitespace-nowrap text-[var(--mut)]">
                        {m.yearLevel}
                      </td>
                      <td className="p-2 border-b border-[var(--line)] whitespace-nowrap text-[var(--mut)]">
                        {m.remarks}
                      </td>

                      {/* Event Columns */}
                      {events.map((ev) => {
                        const st = getSt(m, ev);
                        const ec = getEvCl(m, ev);
                        return (
                          <React.Fragment key={ev.name}>
                            {/* Attendance Select */}
                            <td className="p-1.5 border-b border-[var(--line)] border-l border-[var(--line)] text-center whitespace-nowrap">
                              <select
                                value={st}
                                onChange={(e) =>
                                  handleSelectChange('attendance', m.key, ev.name, e.target.value)
                                }
                                className={`status-select text-center ${cls(st)}`}
                              >
                                {STAT.map((opt) => (
                                  <option key={opt} value={opt}>
                                    {opt}
                                  </option>
                                ))}
                              </select>
                            </td>

                            {/* Event Clearance Select */}
                            <td className="p-1.5 border-b border-[var(--line)] border-r border-[var(--line)] text-center whitespace-nowrap">
                              <select
                                value={ec}
                                onChange={(e) =>
                                  handleSelectChange('eventClearance', m.key, ev.name, e.target.value)
                                }
                                className={`status-select text-center ${cls(ec)}`}
                              >
                                <option value="Blocked">Blocked</option>
                                <option value="Cleared">Cleared</option>
                              </select>
                            </td>
                          </React.Fragment>
                        );
                      })}

                      {/* Overall Clearance Select (Blocked by default, modified by user via external site) */}
                      <td className="p-1.5 border-b border-[var(--line)] border-l border-[var(--line)] text-center whitespace-nowrap">
                        <div className="inline-flex flex-col items-center">
                          <select
                            value={overallCl}
                            onChange={(e) =>
                              handleSelectChange('overallClearance', m.key, e.target.value)
                            }
                            className={`status-select font-bold ${cls(overallCl)}`}
                            title="Blocked by default. Select Cleared when verified on external site."
                          >
                            <option value="Blocked">Blocked</option>
                            <option value="Cleared">Cleared</option>
                          </select>
                          {events.length > 0 && isAllEventsAttended(m) && overallCl === 'Blocked' && (
                            <span
                              className="text-[10px] text-emerald-800 bg-emerald-50 border border-emerald-200 px-1 py-0.2 rounded font-medium mt-0.5"
                              title="Student attended all events. Pending external site verification."
                            >
                              Attended all
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Printable Slip icon */}
                      <td className="p-1.5 border-b border-[var(--line)] text-center whitespace-nowrap">
                        <button
                          onClick={() => setSelectedStudentForSlip(m)}
                          className="border-0 bg-transparent text-[var(--mut)] hover:text-[var(--acc)] p-1 cursor-pointer"
                          title="Print Student Clearance Slip"
                        >
                          <Printer className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Matching Report */}
        <details className="mt-3.5 text-xs text-[var(--ink)]" open={events.length > 0}>
          <summary className="font-semibold cursor-pointer text-[var(--ink)] hover:text-[var(--acc)] select-none">
            Matching report
          </summary>
          <div className="mt-2 space-y-2 text-[var(--ink)]">
            {processedEvents.length === 0 ? (
              <p className="text-[var(--mut)] italic m-0">Upload files to see the report.</p>
            ) : (
              processedEvents.map((ev) => {
                const miss = master.filter((m) => !ev.map.has(m.key));
                return (
                  <div key={ev.name} className="p-2.5 bg-[var(--card)] border border-[var(--line)] rounded-md">
                    <p className="m-0 leading-relaxed">
                      <b className="cursor-pointer hover:underline" onClick={() => openRenameModal(ev)}>
                        {ev.name}
                      </b>
                      : {ev.map.size} matched, {miss.length} student(s) not in this file (shown as "No record")
                      {ev.extra.length > 0 && (
                        <span>
                          , <strong className="text-[var(--badt)]">{ev.extra.length} name(s)</strong> in the file but not in your master list:{' '}
                          <span className="text-[var(--mut)]">
                            {ev.extra
                              .slice(0, 15)
                              .map((x) => x.id || `${x.last} ${x.first}`)
                              .join('; ')}
                            {ev.extra.length > 15 ? '…' : ''}
                          </span>
                        </span>
                      )}
                      .
                    </p>

                    {/* Quick Add Buttons for Unmatched Students */}
                    {ev.extra.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-[var(--line)] flex flex-wrap items-center gap-1.5">
                        <span className="text-[11px] font-semibold text-[var(--mut)]">
                          Add unmatched to master list:
                        </span>
                        {ev.extra.slice(0, 6).map((ex, idx) => (
                          <button
                            key={idx}
                            onClick={() => handleAddExtraStudent(ex)}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[var(--bg)] border border-[var(--line)] hover:border-[var(--acc)] text-[11px] text-[var(--ink)] cursor-pointer"
                          >
                            <UserPlus className="w-3 h-3 text-[var(--acc)]" />
                            <span>{ex.id || `${ex.last}, ${ex.first}`}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </details>
      </div>

      {/* Edit Clearance Column Name Modal */}
      {editingClearanceCol && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-2xs no-print">
          <div className="bg-[var(--card)] rounded-lg max-w-sm w-full p-5 shadow-xl border border-[var(--line)]">
            <div className="flex items-center justify-between pb-2 border-b border-[var(--line)] mb-3">
              <h3 className="text-sm font-bold text-[var(--ink)] m-0">
                Edit Clearance Column Header
              </h3>
              <button
                onClick={() => setEditingClearanceCol(null)}
                className="border-0 bg-transparent text-[var(--mut)] hover:text-[var(--ink)] cursor-pointer p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveClearanceCol} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-[var(--mut)] mb-1">
                  {editingClearanceCol.type === 'event'
                    ? `Header for "${editingClearanceCol.event.name}" Clearance:`
                    : 'Overall Clearance Column Header:'}
                </label>
                <input
                  type="text"
                  value={clearanceColInputValue}
                  onChange={(e) => setClearanceColInputValue(e.target.value)}
                  className="w-full text-xs p-2 border border-[var(--line)] rounded bg-[var(--bg)] text-[var(--ink)] focus:outline-none focus:border-[var(--acc)] font-medium"
                  autoFocus
                  required
                />
              </div>

              {/* Suggestions */}
              <div>
                <span className="text-[11px] font-semibold text-[var(--mut)] block mb-1">
                  Quick Suggestions:
                </span>
                <div className="flex flex-wrap gap-1">
                  {(editingClearanceCol.type === 'event'
                    ? [
                        `${editingClearanceCol.event.name} Clearance`,
                        'Clearance',
                        'Compliance',
                        'Clearance Status',
                        'Status',
                      ]
                    : [
                        'Overall Clearance',
                        'Final Clearance',
                        'Clearance Status',
                        'Unblocking Status',
                        'Eligibility',
                      ]
                  ).map((sug) => (
                    <button
                      key={sug}
                      type="button"
                      onClick={() => setClearanceColInputValue(sug)}
                      className="text-[11px] px-2 py-0.5 rounded bg-[var(--bg)] border border-[var(--line)] hover:border-[var(--acc)] text-[var(--ink)] cursor-pointer"
                    >
                      {sug}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-[var(--line)]">
                <button
                  type="button"
                  onClick={() => {
                    if (editingClearanceCol.type === 'event') {
                      setClearanceColInputValue(`${editingClearanceCol.event.name} Clearance`);
                    } else {
                      setClearanceColInputValue('Overall Clearance');
                    }
                  }}
                  className="text-[11px] text-[var(--mut)] hover:text-[var(--ink)] cursor-pointer bg-transparent border-0 underline"
                >
                  Reset Default
                </button>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingClearanceCol(null)}
                    className="px-3 py-1.5 text-xs text-[var(--mut)] hover:bg-[var(--none)] rounded border-0 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-3 py-1.5 text-xs font-bold text-white bg-[var(--acc)] hover:bg-[var(--acc-hover)] rounded border-0 cursor-pointer"
                  >
                    Save Header
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Rename Event Title Modal */}
      {renamingEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-2xs no-print">
          <div className="bg-[var(--card)] rounded-lg max-w-sm w-full p-5 shadow-xl border border-[var(--line)]">
            <div className="flex items-center justify-between pb-2 border-b border-[var(--line)] mb-3">
              <h3 className="text-sm font-bold text-[var(--ink)] m-0">Rename Event</h3>
              <button
                onClick={() => setRenamingEvent(null)}
                className="border-0 bg-transparent text-[var(--mut)] hover:text-[var(--ink)] cursor-pointer p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveRename} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-[var(--mut)] mb-1">
                  Event Name
                </label>
                <input
                  type="text"
                  value={renameInputValue}
                  onChange={(e) => setRenameInputValue(e.target.value)}
                  className="w-full text-xs p-2 border border-[var(--line)] rounded bg-[var(--bg)] text-[var(--ink)] focus:outline-none focus:border-[var(--acc)] font-medium"
                  autoFocus
                  required
                />
                <span className="text-[11px] text-[var(--mut)] block mt-1">
                  Source file: {renamingEvent.fileName}
                </span>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setRenamingEvent(null)}
                  className="px-3 py-1.5 text-xs text-[var(--mut)] hover:bg-[var(--none)] rounded border-0 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-3 py-1.5 text-xs font-bold text-white bg-[var(--acc)] hover:bg-[var(--acc-hover)] rounded border-0 cursor-pointer"
                >
                  Save Name
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Printable Clearance Certificate Modal */}
      {selectedStudentForSlip && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-2xs no-print">
          <div className="bg-[var(--card)] rounded-lg max-w-lg w-full p-6 shadow-xl border border-[var(--line)] max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-[var(--line)]">
              <span className="text-xs font-bold text-[var(--mut)] uppercase tracking-wider">
                Student Clearance Slip
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => window.print()}
                  className="px-3 py-1 bg-[var(--acc)] text-white rounded text-xs font-semibold hover:bg-[var(--acc-hover)] cursor-pointer flex items-center gap-1 border-0"
                >
                  <Printer className="w-3 h-3" />
                  Print Pass
                </button>
                <button
                  onClick={() => setSelectedStudentForSlip(null)}
                  className="border-0 bg-transparent text-[var(--mut)] hover:text-[var(--ink)] cursor-pointer p-1"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="py-5 space-y-4 text-xs">
              <div className="text-center">
                <h2 className="text-base font-bold text-[var(--ink)] uppercase m-0">Clearance Certification</h2>
                <p className="text-[var(--mut)] m-0 mt-0.5">Official Student Activity Clearance Pass</p>
              </div>

              <div className="p-3 bg-[var(--bg)] border border-[var(--line)] rounded grid grid-cols-2 gap-2">
                <div>
                  <span className="text-[var(--mut)] block text-[11px]">Student ID</span>
                  <strong className="text-[var(--ink)] font-mono text-sm">{selectedStudentForSlip.studentId}</strong>
                </div>
                <div>
                  <span className="text-[var(--mut)] block text-[11px]">Full Name</span>
                  <strong className="text-[var(--ink)] text-sm">{selectedStudentForSlip.lastName}, {selectedStudentForSlip.firstName}</strong>
                </div>
                <div>
                  <span className="text-[var(--mut)] block text-[11px]">Program</span>
                  <span className="text-[var(--ink)]">{selectedStudentForSlip.program || 'N/A'}</span>
                </div>
                <div>
                  <span className="text-[var(--mut)] block text-[11px]">Year Level</span>
                  <span className="text-[var(--ink)]">{selectedStudentForSlip.yearLevel || 'N/A'}</span>
                </div>
              </div>

              <div className={`p-2.5 rounded border text-center font-bold text-sm ${cls(getCl(selectedStudentForSlip))}`}>
                {overallClearanceColName}: {getCl(selectedStudentForSlip).toUpperCase()}
              </div>

              <div>
                <span className="font-bold text-[var(--ink)] block mb-1">Event Breakdown:</span>
                <div className="border border-[var(--line)] rounded divide-y divide-[var(--line)]">
                  {events.map((ev) => (
                    <div key={ev.name} className="p-2 flex items-center justify-between text-[11px]">
                      <span className="font-medium text-[var(--ink)]">{ev.name}</span>
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded font-semibold ${cls(getSt(selectedStudentForSlip, ev))}`}>
                          {getSt(selectedStudentForSlip, ev)}
                        </span>
                        <span className={`font-bold ${getEvCl(selectedStudentForSlip, ev) === 'Cleared' ? 'text-[var(--okt)]' : 'text-[var(--badt)]'}`}>
                          {getEvCl(selectedStudentForSlip, ev)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="pt-6 border-t border-[var(--line)] flex justify-between text-[var(--mut)] text-[11px]">
                <div>
                  <div className="border-b border-[var(--line)] w-36 mb-1"></div>
                  <span>Student Signature</span>
                </div>
                <div>
                  <div className="border-b border-[var(--line)] w-36 mb-1"></div>
                  <span>Clearance Officer</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
