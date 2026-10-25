// Platform event definitions: which template each event sends by default. Written at start-up.
module.exports = [
  { key: 'APPOINTMENT_CONFIRMATION', name: 'Appointment confirmed', description: 'Sent when an appointment is booked', template: 'APPOINTMENT_CONFIRMATION', category: 'TRANSACTIONAL' },
  { key: 'APPOINTMENT_REMINDER', name: 'Appointment reminder', description: 'Sent ahead of an upcoming appointment', template: 'APPOINTMENT_REMINDER', category: 'REMINDER' },
  { key: 'APPOINTMENT_CANCELLED', name: 'Appointment cancelled', description: 'Sent when an appointment is cancelled', template: 'APPOINTMENT_CANCELLED', category: 'TRANSACTIONAL' },
  { key: 'APPOINTMENT_RESCHEDULED', name: 'Appointment rescheduled', description: 'Sent when an appointment moves to a new slot', template: 'APPOINTMENT_RESCHEDULED', category: 'TRANSACTIONAL' },
  { key: 'PASSWORD_CHANGED', name: 'Password changed', description: 'Security notice after a password reset or change', template: 'PASSWORD_CHANGED', category: 'SECURITY' },
];
