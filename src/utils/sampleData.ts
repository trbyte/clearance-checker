import type { MasterStudent, StoredEventRecord } from '../db';
import { restoreBackup } from '../db';

export const SAMPLE_MASTER_STUDENTS: MasterStudent[] = [
  { id: '1', key: 'id:202210021', studentId: '2022-10021', lastName: 'Dela Cruz', firstName: 'Juan Miguel', program: 'BS Computer Science', yearLevel: '3rd Year', remarks: 'Class Representative' },
  { id: '2', key: 'id:202210045', studentId: '2022-10045', lastName: 'Santos', firstName: 'Maria Clara', program: 'BS Information Technology', yearLevel: '3rd Year', remarks: 'Honor Student' },
  { id: '3', key: 'id:202320112', studentId: '2023-20112', lastName: 'Reyes', firstName: 'Gabriel Paolo', program: 'BS Computer Science', yearLevel: '2nd Year', remarks: '' },
  { id: '4', key: 'id:202108912', studentId: '2021-08912', lastName: 'Aquino', firstName: 'Bea Angelica', program: 'BS Information Systems', yearLevel: '4th Year', remarks: 'Graduating' },
  { id: '5', key: 'id:202320340', studentId: '2023-20340', lastName: 'Bautista', firstName: 'Joshua Dave', program: 'BS Entertainment & Multimedia Computing', yearLevel: '2nd Year', remarks: '' },
  { id: '6', key: 'id:202210550', studentId: '2022-10550', lastName: 'Villanueva', firstName: 'Katelyn Rose', program: 'BS Computer Science', yearLevel: '3rd Year', remarks: '' },
  { id: '7', key: 'id:202430018', studentId: '2024-30018', lastName: 'Garcia', firstName: 'Ethan Lucas', program: 'BS Information Technology', yearLevel: '1st Year', remarks: 'Freshman' },
  { id: '8', key: 'id:202210619', studentId: '2022-10619', lastName: 'Torres', firstName: 'Sophia Andrea', program: 'BS Computer Science', yearLevel: '3rd Year', remarks: 'Varsity Athlete' },
  { id: '9', key: 'id:202320701', studentId: '2023-20701', lastName: 'Mendoza', firstName: 'Christian Mark', program: 'BS Information Technology', yearLevel: '2nd Year', remarks: '' },
  { id: '10', key: 'id:202109110', studentId: '2021-09110', lastName: 'Castro', firstName: 'Alyssa Nicole', program: 'BS Information Systems', yearLevel: '4th Year', remarks: 'Thesis Lead' },
  { id: '11', key: 'id:202430154', studentId: '2024-30154', lastName: 'Navarro', firstName: 'Daniel James', program: 'BS Computer Science', yearLevel: '1st Year', remarks: '' },
  { id: '12', key: 'id:202210777', studentId: '2022-10777', lastName: 'Lim', firstName: 'Hannah Patricia', program: 'BS Information Technology', yearLevel: '3rd Year', remarks: '' },
  { id: '13', key: 'id:202320890', studentId: '2023-20890', lastName: 'Mercado', firstName: 'Angelo Rafael', program: 'BS Computer Science', yearLevel: '2nd Year', remarks: '' },
  { id: '14', key: 'id:202109432', studentId: '2021-09432', lastName: 'Flores', firstName: 'Jasmine Camille', program: 'BS Information Systems', yearLevel: '4th Year', remarks: '' },
  { id: '15', key: 'id:202430221', studentId: '2024-30221', lastName: 'Tan', firstName: 'Alexander Scott', program: 'BS Computer Science', yearLevel: '1st Year', remarks: '' },
];

export const SAMPLE_EVENTS: StoredEventRecord[] = [
  {
    id: 'evt_assembly',
    name: 'General Student Assembly 2025',
    fileName: 'General_Student_Assembly_2025.xlsx',
    uploadedAt: Date.now() - 86400000 * 3,
    recs: [
      { id: '2022-10021', last: 'Dela Cruz', first: 'Juan Miguel', program: 'BSCS', year: '3', status: 'Present' },
      { id: '2022-10045', last: 'Santos', first: 'Maria Clara', program: 'BSIT', year: '3', status: 'Present' },
      { id: '2023-20112', last: 'Reyes', first: 'Gabriel Paolo', program: 'BSCS', year: '2', status: 'Present' },
      { id: '2021-08912', last: 'Aquino', first: 'Bea Angelica', program: 'BSIS', year: '4', status: 'Excused' },
      { id: '2023-20340', last: 'Bautista', first: 'Joshua Dave', program: 'BSEMC', year: '2', status: 'Absent' },
      { id: '2022-10550', last: 'Villanueva', first: 'Katelyn Rose', program: 'BSCS', year: '3', status: 'Present' },
      { id: '2024-30018', last: 'Garcia', first: 'Ethan Lucas', program: 'BSIT', year: '1', status: 'Present' },
      { id: '2022-10619', last: 'Torres', first: 'Sophia Andrea', program: 'BSCS', year: '3', status: 'Present' },
      { id: '2023-20701', last: 'Mendoza', first: 'Christian Mark', program: 'BSIT', year: '2', status: 'Incomplete' },
      { id: '2021-09110', last: 'Castro', first: 'Alyssa Nicole', program: 'BSIS', year: '4', status: 'Present' },
      { id: '2024-30154', last: 'Navarro', first: 'Daniel James', program: 'BSCS', year: '1', status: 'Present' },
      { id: '2022-10777', last: 'Lim', first: 'Hannah Patricia', program: 'BSIT', year: '3', status: 'Present' },
      { id: '2023-20890', last: 'Mercado', first: 'Angelo Rafael', program: 'BSCS', year: '2', status: 'Present' },
      { id: '2021-09432', last: 'Flores', first: 'Jasmine Camille', program: 'BSIS', year: '4', status: 'Present' },
      { id: '2024-30221', last: 'Tan', first: 'Alexander Scott', program: 'BSCS', year: '1', status: 'Present' },
      // Unmatched student example
      { id: '2025-99999', last: 'Robles', first: 'Mark Angelo', program: 'BSIT', year: '1', status: 'Present' },
    ],
  },
  {
    id: 'evt_career',
    name: 'CICT Career & Tech Summit',
    fileName: 'CICT_Career_Tech_Summit.xlsx',
    uploadedAt: Date.now() - 86400000 * 2,
    recs: [
      { id: '2022-10021', last: 'Dela Cruz', first: 'Juan Miguel', program: 'BSCS', year: '3', status: 'Present' },
      { id: '2022-10045', last: 'Santos', first: 'Maria Clara', program: 'BSIT', year: '3', status: 'Absent' },
      { id: '2023-20112', last: 'Reyes', first: 'Gabriel Paolo', program: 'BSCS', year: '2', status: 'Present' },
      { id: '2021-08912', last: 'Aquino', first: 'Bea Angelica', program: 'BSIS', year: '4', status: 'Present' },
      { id: '2023-20340', last: 'Bautista', first: 'Joshua Dave', program: 'BSEMC', year: '2', status: 'Absent' },
      { id: '2022-10550', last: 'Villanueva', first: 'Katelyn Rose', program: 'BSCS', year: '3', status: 'Present' },
      { id: '2024-30018', last: 'Garcia', first: 'Ethan Lucas', program: 'BSIT', year: '1', status: 'Present' },
      { id: '2022-10619', last: 'Torres', first: 'Sophia Andrea', program: 'BSCS', year: '3', status: 'Excused' },
      { id: '2023-20701', last: 'Mendoza', first: 'Christian Mark', program: 'BSIT', year: '2', status: 'Present' },
      { id: '2021-09110', last: 'Castro', first: 'Alyssa Nicole', program: 'BSIS', year: '4', status: 'Present' },
      { id: '2024-30154', last: 'Navarro', first: 'Daniel James', program: 'BSCS', year: '1', status: 'Present' },
      { id: '2022-10777', last: 'Lim', first: 'Hannah Patricia', program: 'BSIT', year: '3', status: 'Present' },
      { id: '2023-20890', last: 'Mercado', first: 'Angelo Rafael', program: 'BSCS', year: '2', status: 'Present' },
      { id: '2021-09432', last: 'Flores', first: 'Jasmine Camille', program: 'BSIS', year: '4', status: 'Present' },
      { id: '2024-30221', last: 'Tan', first: 'Alexander Scott', program: 'BSCS', year: '1', status: 'Absent' },
    ],
  },
  {
    id: 'evt_leadership',
    name: 'Leadership & Ethics Seminar',
    fileName: 'Leadership_Seminar.xlsx',
    uploadedAt: Date.now() - 86400000 * 1,
    recs: [
      { id: '2022-10021', last: 'Dela Cruz', first: 'Juan Miguel', program: 'BSCS', year: '3', status: 'Present' },
      { id: '2022-10045', last: 'Santos', first: 'Maria Clara', program: 'BSIT', year: '3', status: 'Present' },
      { id: '2023-20112', last: 'Reyes', first: 'Gabriel Paolo', program: 'BSCS', year: '2', status: 'Incomplete' },
      { id: '2021-08912', last: 'Aquino', first: 'Bea Angelica', program: 'BSIS', year: '4', status: 'Present' },
      { id: '2023-20340', last: 'Bautista', first: 'Joshua Dave', program: 'BSEMC', year: '2', status: 'Present' },
      { id: '2022-10550', last: 'Villanueva', first: 'Katelyn Rose', program: 'BSCS', year: '3', status: 'Present' },
      { id: '2024-30018', last: 'Garcia', first: 'Ethan Lucas', program: 'BSIT', year: '1', status: 'Present' },
      { id: '2022-10619', last: 'Torres', first: 'Sophia Andrea', program: 'BSCS', year: '3', status: 'Present' },
      { id: '2023-20701', last: 'Mendoza', first: 'Christian Mark', program: 'BSIT', year: '2', status: 'Present' },
      { id: '2021-09110', last: 'Castro', first: 'Alyssa Nicole', program: 'BSIS', year: '4', status: 'Present' },
      { id: '2024-30154', last: 'Navarro', first: 'Daniel James', program: 'BSCS', year: '1', status: 'Present' },
      { id: '2022-10777', last: 'Lim', first: 'Hannah Patricia', program: 'BSIT', year: '3', status: 'Present' },
      { id: '2023-20890', last: 'Mercado', first: 'Angelo Rafael', program: 'BSCS', year: '2', status: 'Present' },
      { id: '2021-09432', last: 'Flores', first: 'Jasmine Camille', program: 'BSIS', year: '4', status: 'Present' },
      { id: '2024-30221', last: 'Tan', first: 'Alexander Scott', program: 'BSCS', year: '1', status: 'Present' },
    ],
  },
];

export async function seedSampleDataset(): Promise<void> {
  const now = Date.now();
  await restoreBackup({
    students: SAMPLE_MASTER_STUDENTS,
    events: SAMPLE_EVENTS,
    edits: [],
    // Maria Clara Santos was Absent in Career Summit, but unblocked via excuse slip
    clearances: [{ id: 'id:202210045||CICT Career & Tech Summit', val: 'Cleared', updatedAt: now }],
    meta: [{ id: 'meta_main', masterFileName: 'CICT_Official_Students_2025.xlsx', lastUpdated: now }],
  });
}
