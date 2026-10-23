/**
 * The platform's own message templates. They are written into the database (with
 * tenant_uuid NULL) when the service starts, and a tenant can override any of them.
 * Raise `version` when you change the text of one so existing databases pick it up.
 *
 * Wording rule for health care: say that an appointment exists and when and where —
 * never why. No diagnoses, symptoms or treatment details belong in an email.
 */
const STYLE = 'font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1f2937;line-height:1.5';
const wrap = (inner) =>
  `<div style="${STYLE};max-width:560px;margin:0 auto;padding:24px">${inner}<p style="color:#6b7280;font-size:12px;margin-top:28px">This is an automated message. Please do not reply to it unless a reply address was shown.</p></div>`;

const detailsText = `When: {{appointmentDate}} at {{startTime}}
Where: {{facilityName}}
Service: {{serviceName}}
{{#doctorName}}Doctor: {{doctorName}}
{{/doctorName}}{{#tokenNumber}}Token number: {{tokenNumber}}
{{/tokenNumber}}`;

const detailsHtml = `<table style="border-collapse:collapse;margin:12px 0">
<tr><td style="padding:4px 14px 4px 0;color:#6b7280">When</td><td><strong>{{appointmentDate}} at {{startTime}}</strong></td></tr>
<tr><td style="padding:4px 14px 4px 0;color:#6b7280">Where</td><td>{{facilityName}}</td></tr>
<tr><td style="padding:4px 14px 4px 0;color:#6b7280">Service</td><td>{{serviceName}}</td></tr>
{{#doctorName}}<tr><td style="padding:4px 14px 4px 0;color:#6b7280">Doctor</td><td>{{doctorName}}</td></tr>{{/doctorName}}
{{#tokenNumber}}<tr><td style="padding:4px 14px 4px 0;color:#6b7280">Token number</td><td>{{tokenNumber}}</td></tr>{{/tokenNumber}}
</table>`;

const appointmentVars = [
  { name: 'patientName', required: true, description: 'Patient\'s name' },
  { name: 'appointmentDate', required: true, description: 'e.g. Wed, 14 Oct 2026' },
  { name: 'startTime', required: true, description: 'e.g. 11:00' },
  { name: 'serviceName', required: true, description: 'The service booked' },
  { name: 'facilityName', required: true, description: 'Where the patient should go' },
  { name: 'doctorName', required: false, description: 'Left empty when the booking is not with a specific doctor' },
  { name: 'tokenNumber', required: false, description: 'e.g. T003' },
];

const whatsappAppointmentVars = [
  { name: 'patientName', required: true, description: 'Patient\'s name' },
  { name: 'appointmentDate', required: true, description: 'e.g. Wed, 14 Oct 2026' },
  { name: 'startTime', required: true, description: 'e.g. 11:00' },
  { name: 'facilityName', required: true, description: 'Where the patient should go' },
];

const smsAppointmentVars = [
  { name: 'patientName', required: true, description: 'Patient\'s name' },
  { name: 'appointmentDate', required: true, description: 'e.g. Wed, 14 Oct 2026' },
  { name: 'startTime', required: true, description: 'e.g. 11:00' },
  { name: 'facilityName', required: true, description: 'Where the patient should go' },
];

module.exports = [
  // EMAIL templates
  {
    key: 'APPOINTMENT_CONFIRMATION', category: 'TRANSACTIONAL', version: 1, channel: 'EMAIL',
    description: 'Sent when an appointment is booked',
    subject: 'Your appointment on {{appointmentDate}} at {{startTime}}',
    bodyText: `Hello {{patientName}},\n\nYour appointment is booked.\n\n${detailsText}\nPlease arrive a few minutes early.`,
    bodyHtml: wrap(`<p>Hello {{patientName}},</p><p>Your appointment is booked.</p>${detailsHtml}<p>Please arrive a few minutes early.</p>`),
    variables: appointmentVars,
  },
  {
    key: 'APPOINTMENT_REMINDER', category: 'REMINDER', version: 1, channel: 'EMAIL',
    description: 'Sent ahead of an appointment',
    subject: 'Reminder: your appointment on {{appointmentDate}} at {{startTime}}',
    bodyText: `Hello {{patientName}},\n\nThis is a reminder of your upcoming appointment.\n\n${detailsText}\nIf you can no longer come, please let the facility know so the slot can be given to someone else.`,
    bodyHtml: wrap(`<p>Hello {{patientName}},</p><p>This is a reminder of your upcoming appointment.</p>${detailsHtml}<p>If you can no longer come, please let the facility know so the slot can be given to someone else.</p>`),
    variables: appointmentVars,
  },
  {
    key: 'APPOINTMENT_CANCELLED', category: 'TRANSACTIONAL', version: 1, channel: 'EMAIL',
    description: 'Sent when an appointment is cancelled',
    subject: 'Your appointment on {{appointmentDate}} was cancelled',
    bodyText: `Hello {{patientName}},\n\nYour appointment has been cancelled.\n\n${detailsText}{{#cancellationReason}}Reason: {{cancellationReason}}\n{{/cancellationReason}}\nPlease contact the facility to book another time.`,
    bodyHtml: wrap(`<p>Hello {{patientName}},</p><p>Your appointment has been cancelled.</p>${detailsHtml}{{#cancellationReason}}<p>Reason: {{cancellationReason}}</p>{{/cancellationReason}}<p>Please contact the facility to book another time.</p>`),
    variables: [...appointmentVars, { name: 'cancellationReason', required: false, description: 'The reason chosen when cancelling' }],
  },
  {
    key: 'APPOINTMENT_RESCHEDULED', category: 'TRANSACTIONAL', version: 1, channel: 'EMAIL',
    description: 'Sent when an appointment is moved to another time',
    subject: 'Your appointment was moved to {{appointmentDate}} at {{startTime}}',
    bodyText: `Hello {{patientName}},\n\nYour appointment has been moved.\n\nPreviously: {{previousDate}} at {{previousTime}}\n\nNew time:\n${detailsText}\nPlease arrive a few minutes early.`,
    bodyHtml: wrap(`<p>Hello {{patientName}},</p><p>Your appointment has been moved.</p><p style="color:#6b7280">Previously: {{previousDate}} at {{previousTime}}</p><p><strong>New time</strong></p>${detailsHtml}<p>Please arrive a few minutes early.</p>`),
    variables: [...appointmentVars, { name: 'previousDate', required: true, description: 'The old date' }, { name: 'previousTime', required: true, description: 'The old time' }],
  },
  {
    key: 'PASSWORD_CHANGED', category: 'SECURITY', version: 1, channel: 'EMAIL',
    description: 'Sent to a user whose password was changed or reset',
    subject: 'Your password was changed',
    bodyText: `Hello {{userName}},\n\nThe password of your account was changed{{#changedBy}} by {{changedBy}}{{/changedBy}}. You were signed out of all devices.\n\nIf you did not expect this, contact your administrator straight away.`,
    bodyHtml: wrap(`<p>Hello {{userName}},</p><p>The password of your account was changed{{#changedBy}} by {{changedBy}}{{/changedBy}}. You were signed out of all devices.</p><p>If you did not expect this, contact your administrator straight away.</p>`),
    variables: [{ name: 'userName', required: true, description: 'The account holder\'s name' }, { name: 'changedBy', required: false, description: 'Who changed it, e.g. "an administrator"' }],
  },
  {
    key: 'TEST_EMAIL', category: 'TRANSACTIONAL', version: 1, channel: 'EMAIL',
    description: 'Used by the "send a test" button in the settings',
    subject: 'Test message from {{senderName}}',
    bodyText: 'This is a test message from {{senderName}}. If you can read it, email delivery is working.',
    bodyHtml: wrap('<p>This is a test message from <strong>{{senderName}}</strong>.</p><p>If you can read it, email delivery is working.</p>'),
    variables: [{ name: 'senderName', required: true, description: 'The name the message is sent as' }],
  },

  // WHATSAPP templates
  {
    key: 'APPOINTMENT_CONFIRMATION', category: 'TRANSACTIONAL', version: 1, channel: 'WHATSAPP',
    description: 'Sent when an appointment is booked',
    subject: 'Appointment Confirmed',
    bodyText: `Hello {{patientName}},\nYour appointment is confirmed.\nWhen: {{appointmentDate}} at {{startTime}}\nWhere: {{facilityName}}\n\nPlease arrive a few minutes early.`,
    bodyHtml: null,
    variables: whatsappAppointmentVars,
  },
  {
    key: 'APPOINTMENT_REMINDER', category: 'REMINDER', version: 1, channel: 'WHATSAPP',
    description: 'Sent ahead of an appointment',
    subject: 'Appointment Reminder',
    bodyText: `Hello {{patientName}},\nThis is a reminder of your upcoming appointment.\nWhen: {{appointmentDate}} at {{startTime}}\nWhere: {{facilityName}}\n\nIf you can no longer come, please let the facility know.`,
    bodyHtml: null,
    variables: whatsappAppointmentVars,
  },
  {
    key: 'APPOINTMENT_CANCELLED', category: 'TRANSACTIONAL', version: 1, channel: 'WHATSAPP',
    description: 'Sent when an appointment is cancelled',
    subject: 'Appointment Cancelled',
    bodyText: `Hello {{patientName}},\nYour appointment on {{appointmentDate}} has been cancelled.\n\nPlease contact the facility to book another time.`,
    bodyHtml: null,
    variables: [...whatsappAppointmentVars, { name: 'cancellationReason', required: false, description: 'The reason chosen when cancelling' }],
  },
  {
    key: 'APPOINTMENT_RESCHEDULED', category: 'TRANSACTIONAL', version: 1, channel: 'WHATSAPP',
    description: 'Sent when an appointment is moved to another time',
    subject: 'Appointment Rescheduled',
    bodyText: `Hello {{patientName}},\nYour appointment has been moved.\n\nPreviously: {{previousDate}} at {{previousTime}}\n\nNew time: {{appointmentDate}} at {{startTime}}\nWhere: {{facilityName}}\n\nPlease arrive a few minutes early.`,
    bodyHtml: null,
    variables: [...whatsappAppointmentVars, { name: 'previousDate', required: true, description: 'The old date' }, { name: 'previousTime', required: true, description: 'The old time' }],
  },
  {
    key: 'PASSWORD_CHANGED', category: 'SECURITY', version: 1, channel: 'WHATSAPP',
    description: 'Sent to a user whose password was changed or reset',
    subject: 'Password Changed',
    bodyText: `Hello {{userName}},\nThe password of your account was changed{{#changedBy}} by {{changedBy}}{{/changedBy}}.\n\nIf you did not expect this, contact your administrator straight away.`,
    bodyHtml: null,
    variables: [{ name: 'userName', required: true, description: 'The account holder\'s name' }, { name: 'changedBy', required: false, description: 'Who changed it, e.g. "an administrator"' }],
  },
  {
    key: 'TEST_WHATSAPP', category: 'TRANSACTIONAL', version: 1, channel: 'WHATSAPP',
    description: 'Used by the "send a test" button in the settings',
    subject: 'Test Message',
    bodyText: 'This is a test message from {{senderName}}. If you can read it, WhatsApp delivery is working.',
    bodyHtml: null,
    variables: [{ name: 'senderName', required: true, description: 'The name the message is sent as' }],
  },

  // SMS templates
  {
    key: 'APPOINTMENT_CONFIRMATION', category: 'TRANSACTIONAL', version: 1, channel: 'SMS',
    description: 'Sent when an appointment is booked',
    subject: 'Appt Confirmed',
    bodyText: `Hi {{patientName}}, your appt is confirmed for {{appointmentDate}} at {{startTime}} at {{facilityName}}. Please arrive early.`,
    bodyHtml: null,
    variables: smsAppointmentVars,
  },
  {
    key: 'APPOINTMENT_REMINDER', category: 'REMINDER', version: 1, channel: 'SMS',
    description: 'Sent ahead of an appointment',
    subject: 'Appt Reminder',
    bodyText: `Hi {{patientName}}, reminder: your appt is on {{appointmentDate}} at {{startTime}} at {{facilityName}}. Reply STOP to opt out.`,
    bodyHtml: null,
    variables: smsAppointmentVars,
  },
  {
    key: 'APPOINTMENT_CANCELLED', category: 'TRANSACTIONAL', version: 1, channel: 'SMS',
    description: 'Sent when an appointment is cancelled',
    subject: 'Appt Cancelled',
    bodyText: `Hi {{patientName}}, your appt on {{appointmentDate}} was cancelled. Contact {{facilityName}} to rebook.`,
    bodyHtml: null,
    variables: [...smsAppointmentVars, { name: 'cancellationReason', required: false, description: 'The reason chosen when cancelling' }],
  },
  {
    key: 'APPOINTMENT_RESCHEDULED', category: 'TRANSACTIONAL', version: 1, channel: 'SMS',
    description: 'Sent when an appointment is moved to another time',
    subject: 'Appt Rescheduled',
    bodyText: `Hi {{patientName}}, your appt was moved from {{previousDate}} {{previousTime}} to {{appointmentDate}} {{startTime}} at {{facilityName}}. Please arrive early.`,
    bodyHtml: null,
    variables: [...smsAppointmentVars, { name: 'previousDate', required: true, description: 'The old date' }, { name: 'previousTime', required: true, description: 'The old time' }],
  },
  {
    key: 'PASSWORD_CHANGED', category: 'SECURITY', version: 1, channel: 'SMS',
    description: 'Sent to a user whose password was changed or reset',
    subject: 'Password Changed',
    bodyText: `Hi {{userName}}, your password was changed{{#changedBy}} by {{changedBy}}{{/changedBy}}. If not you, contact admin.`,
    bodyHtml: null,
    variables: [{ name: 'userName', required: true, description: 'The account holder\'s name' }, { name: 'changedBy', required: false, description: 'Who changed it, e.g. "an administrator"' }],
  },
  {
    key: 'TEST_SMS', category: 'TRANSACTIONAL', version: 1, channel: 'SMS',
    description: 'Used by the "send a test" button in the settings',
    subject: 'Test',
    bodyText: `Test message from {{senderName}}. SMS delivery is working.`,
    bodyHtml: null,
    variables: [{ name: 'senderName', required: true, description: 'The name the message is sent as' }],
  },
];