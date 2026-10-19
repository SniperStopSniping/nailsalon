import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getDateKeyInTimeZone,
  getTimeKeyInTimeZone,
  getZonedDayBounds,
  isZonedTimeMatch,
  zonedTimeToUtc,
} from '../src/libs/timeZone.ts';

test('Node 24 uses the current Vancouver rule and shared booking timezone helpers', (t) => {
  assert.ok(Number(process.versions.node.split('.')[0]) >= 24, 'Run this contract in Node 24 or newer');

  const vancouverInstant = new Date('2027-01-04T12:00:00.000Z');
  const vancouverOffset = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Vancouver',
    timeZoneName: 'longOffset',
  }).formatToParts(vancouverInstant).find(part => part.type === 'timeZoneName')?.value;
  assert.equal(vancouverOffset, 'GMT-07:00');

  const vancouverStart = zonedTimeToUtc({ date: '2027-01-04', time: '09:00', timeZone: 'America/Vancouver' });
  assert.equal(vancouverStart.toISOString(), '2027-01-04T16:00:00.000Z');
  assert.equal(getDateKeyInTimeZone(vancouverStart, 'America/Vancouver'), '2027-01-04');
  assert.equal(getTimeKeyInTimeZone(vancouverStart, 'America/Vancouver'), '09:00');
  assert.equal(isZonedTimeMatch(vancouverStart, {
    date: '2027-01-04',
    time: '09:00',
    timeZone: 'America/Vancouver',
  }), true);

  const vancouverBounds = getZonedDayBounds('2027-01-04', 'America/Vancouver');
  assert.equal(vancouverBounds.startOfDay.toISOString(), '2027-01-04T07:00:00.000Z');
  assert.equal(vancouverBounds.endOfDay.toISOString(), '2027-01-05T06:59:59.999Z');

  const newYorkGap = { date: '2026-03-08', time: '02:30', timeZone: 'America/New_York' };
  assert.equal(isZonedTimeMatch(zonedTimeToUtc(newYorkGap), newYorkGap), false);
  const newYorkValid = { ...newYorkGap, time: '03:30' };
  assert.equal(isZonedTimeMatch(zonedTimeToUtc(newYorkValid), newYorkValid), true);

  const newYorkBounds = getZonedDayBounds('2026-03-08', 'America/New_York');
  assert.equal(newYorkBounds.startOfDay.toISOString(), '2026-03-08T05:00:00.000Z');
  assert.equal(newYorkBounds.endOfDay.toISOString(), '2026-03-09T03:59:59.999Z');

  t.diagnostic(JSON.stringify({ node: process.versions.node, tzdb: process.versions.tz, vancouverOffset }));
});
