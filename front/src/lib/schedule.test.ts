import { describe, expect, test } from 'vitest'
import { buildCron, DEFAULT_REPEAT, HOUR_STEPS, parseCron, type RepeatForm } from './schedule'

const form = (o: Partial<RepeatForm>): RepeatForm => ({ ...DEFAULT_REPEAT, ...o })

describe('buildCron', () => {
  test.each([
    [{ kind: 'daily', time: '09:05' }, '5 9 * * *'],
    [{ kind: 'weekdays', time: '18:30', weekdays: [5, 1, 3] }, '30 18 * * 1,3,5'],
    [{ kind: 'monthday', time: '00:00', dayOfMonth: 15 }, '0 0 15 * *'],
    [{ kind: 'hours', time: '18:45', everyHours: 6 }, '0 */6 * * *'],
    [{ kind: 'hours', time: '00:00', everyHours: 1 }, '0 * * * *'],
    [{ kind: 'custom', custom: '  0 8 * * 1-5 ' }, '0 8 * * 1-5'],
  ] as [Partial<RepeatForm>, string][])('%j -> %s', (o, cron) => {
    expect(buildCron(form(o))).toBe(cron)
  })
})

test('only divisors of 24 are offered', () => {
  expect(HOUR_STEPS).toEqual([1, 2, 3, 4, 6, 8, 12])
})

describe('parseCron', () => {
  test.each([
    [{ kind: 'daily', time: '09:05' }],
    [{ kind: 'weekdays', time: '18:30', weekdays: [1, 3, 5] }],
    [{ kind: 'monthday', time: '07:00', dayOfMonth: 15 }],
    [{ kind: 'hours', time: '00:00', everyHours: 6 }],
    [{ kind: 'hours', time: '00:00', everyHours: 1 }],
  ] as Partial<RepeatForm>[])('round-trips %j', (o) => {
    const original = form(o)
    expect(parseCron(buildCron(original))).toMatchObject({ kind: original.kind, time: original.time })
    expect(buildCron(parseCron(buildCron(original)))).toBe(buildCron(original))
  })

  test('anything else becomes custom, keeping the text', () => {
    expect(parseCron('0 8 * * 1-5')).toMatchObject({ kind: 'custom', custom: '0 8 * * 1-5' })
    expect(parseCron('0 9 * 6 *')).toMatchObject({ kind: 'custom' })
    expect(parseCron('10 */6 * * *')).toMatchObject({ kind: 'custom' })
    expect(parseCron('0 */23 * * *')).toMatchObject({ kind: 'custom' })
    expect(parseCron('nonsense')).toMatchObject({ kind: 'custom', custom: 'nonsense' })
  })
})
