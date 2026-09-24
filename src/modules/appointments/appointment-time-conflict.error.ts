export class AppointmentTimeConflictError extends Error {
  constructor() {
    super('Appointment time conflicts with an existing appointment');
    this.name = 'AppointmentTimeConflictError';
  }
}