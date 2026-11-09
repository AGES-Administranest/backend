/**
 * A span of time, `from` included and `to` excluded.
 *
 * Half-open on purpose: a "day" is `[00:00, 00:00 next day)`, so a column that
 * holds a timestamp and one that holds a date both match the same way, and no
 * record sits on the boundary of two periods.
 */
export interface Period {
  from: Date;
  to: Date;
}
