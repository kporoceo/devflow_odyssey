// Who can do what, from the use case diagram. The database enforces the
// same rules (schema_finals_accounts.sql); these lists only decide what
// the screens show, so a hidden button is never the only protection.

export const LEADERSHIP = ['Managing Partner', 'Partner'];
export const AUDIT_TEAM = ['Audit and Assurance Lead', 'Audit Associate'];
export const OPERATIONS = ['Supervisor', 'Accounting Assistant'];
export const CLIENT_ROLE = 'Client Representative';

export const FIRM_ROLES = [...LEADERSHIP, ...AUDIT_TEAM, ...OPERATIONS];
export const ALL_ROLES = [...FIRM_ROLES, CLIENT_ROLE];

export function teamOf(role) {
  if (LEADERSHIP.includes(role)) return 'Firm Leadership';
  if (AUDIT_TEAM.includes(role)) return 'Audit Team';
  if (OPERATIONS.includes(role)) return 'Operations Team';
  if (role === CLIENT_ROLE) return 'Client';
  return 'No access';
}

export const isLeadership = (role) => LEADERSHIP.includes(role);
export const isAuditTeam = (role) => AUDIT_TEAM.includes(role);
export const isFirmStaff = (role) => FIRM_ROLES.includes(role);
export const isClient = (role) => role === CLIENT_ROLE;
export const canPrepareReports = (role) => [...LEADERSHIP, ...OPERATIONS].includes(role);

// Where each person lands after logging in.
export function homeFor(role) {
  return isClient(role) ? '/reports' : '/dashboard';
}

// Report sign-off: which status waits for which role.
export const SIGNOFF_LEVELS = [
  { status: 'Draft', level: 'Preparer', who: 'Firm Leadership or Operations Team', canAct: canPrepareReports },
  { status: 'Returned', level: 'Preparer', who: 'Firm Leadership or Operations Team', canAct: canPrepareReports },
  { status: 'For Review', level: 'Reviewer', who: 'Audit and Assurance Lead', canAct: (role) => role === 'Audit and Assurance Lead' },
  { status: 'For Partner Approval', level: 'Partner', who: 'Partner or Managing Partner', canAct: isLeadership },
  { status: 'For Client Approval', level: 'Client', who: 'Client Representative', canAct: isClient },
];

export function signoffStepFor(status) {
  return SIGNOFF_LEVELS.find((s) => s.status === status) || null;
}

// Colour of each report status in the lists.
export const STATUS_COLORS = {
  'Draft': '#666',
  'Returned': 'crimson',
  'For Review': '#c60',
  'For Partner Approval': '#c60',
  'For Client Approval': '#c60',
  'Signed Off': '#2a7',
};
