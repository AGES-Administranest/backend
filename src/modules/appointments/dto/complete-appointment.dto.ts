import { PickType } from '@nestjs/swagger';

import { CreateAppointmentDto } from './create-appointment.dto';

// What was filled in once the procedure was done. The status comes from the
// route, and the client, the location and the time slot are what was
// scheduled: completing does not reschedule or rebill, and the location goes
// with the client, so `clientId`, `location`, `startsAt` and `endsAt` are left
// out on purpose. So is `clientGeneratedId`, the idempotency key of an
// offline create. All fields stay optional; `amount` falls back to the one
// stored on the appointment.
export class CompleteAppointmentDto extends PickType(CreateAppointmentDto, [
  'amount',
  'procedureName',
  'patientName',
  'ownerName',
  'species',
  'patientAgeYears',
  'weightKg',
  'notes',
  'asa',
] as const) {}
