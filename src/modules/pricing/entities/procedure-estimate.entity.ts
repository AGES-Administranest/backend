export class ProcedureEstimateResponse {
  /** hoursCost + tripCost + suppliesCost, with the safety margin in the hours. */
  minimumPrice!: string;
  /** The same sum with the hourly rate without the safety margin. */
  breakEvenPrice!: string;
  hoursCost!: string;
  tripCost!: string;
  suppliesCost!: string;
  /** The hourly rate with the margin, as GET /pricing/hourly-rate returns it. */
  hourlyRateUsed!: string;
  /** The hourly rate without the margin, behind breakEvenPrice. */
  minimumHourlyRateUsed!: string;
  /** false without a client, or without trips to it to learn from. */
  tripEstimateAvailable!: boolean;
  /** The days with trips to the client the trip cost averages. */
  tripEstimateDays!: number;
  /** Items counted at 0 because they have no cost recorded. */
  suppliesWithoutCost!: string[];
  durationMinutes!: number;
  /** The month the hourly rate comes from: the current one, in UTC. */
  month!: number;
  year!: number;
}
