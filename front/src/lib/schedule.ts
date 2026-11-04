export type RepeatKind = 'daily' | 'weekdays' | 'monthday' | 'hours' | 'custom'

export interface RepeatForm {
  kind: RepeatKind
  time: string // HH:MM
  weekdays: number[] // 0 = Sunday
  dayOfMonth: number
  everyHours: number
  custom: string
}

export const DEFAULT_REPEAT: RepeatForm = { kind: 'daily', time: '09:00', weekdays: [1], dayOfMonth: 1, everyHours: 6, custom: '' }

// Only divisors of 24 repeat evenly: every 23 hours would send at 23:00 and again at 00:00.
export const HOUR_STEPS = [1, 2, 3, 4, 6, 8, 12]

const splitTime = (time: string): [number, number] => {
  const [h, m] = time.split(':').map(Number)
  return [Number.isFinite(h) ? h! : 0, Number.isFinite(m) ? m! : 0]
}

export function buildCron(form: RepeatForm): string {
  const [h, m] = splitTime(form.time)
  switch (form.kind) {
    case 'daily': return `${m} ${h} * * *`
    case 'weekdays': return `${m} ${h} * * ${[...form.weekdays].sort((a, b) => a - b).join(',')}`
    case 'monthday': return `${m} ${h} ${form.dayOfMonth} * *`
    case 'hours': return `0 ${form.everyHours === 1 ? '*' : `*/${form.everyHours}`} * * *`
    case 'custom': return form.custom.trim()
  }
}

const pad = (n: number) => String(n).padStart(2, '0')

// Reads back a rule made by buildCron so it can be edited with the same controls; anything else is "custom".
export function parseCron(cron: string): RepeatForm {
  const custom: RepeatForm = { ...DEFAULT_REPEAT, kind: 'custom', custom: cron }
  const f = cron.trim().split(/\s+/)
  if (f.length !== 5 || !/^\d+$/.test(f[0]!)) return custom
  const m = Number(f[0])
  if (m > 59) return custom
  const [min, hour, dom, mon, dow] = f as [string, string, string, string, string]
  if (mon !== '*') return custom
  if (/^\d+$/.test(hour) && Number(hour) < 24) {
    const time = `${pad(Number(hour))}:${pad(m)}`
    if (dom === '*' && dow === '*') return { ...DEFAULT_REPEAT, kind: 'daily', time }
    if (dom === '*' && /^[0-6](,[0-6])*$/.test(dow)) return { ...DEFAULT_REPEAT, kind: 'weekdays', time, weekdays: dow.split(',').map(Number) }
    if (/^\d+$/.test(dom) && Number(dom) >= 1 && Number(dom) <= 31 && dow === '*') {
      return { ...DEFAULT_REPEAT, kind: 'monthday', time, dayOfMonth: Number(dom) }
    }
    return custom
  }
  if (dom === '*' && dow === '*' && min === '0') {
    const time = '00:00'
    if (hour === '*') return { ...DEFAULT_REPEAT, kind: 'hours', time, everyHours: 1 }
    const every = /^\*\/(\d+)$/.exec(hour)
    if (every && HOUR_STEPS.includes(Number(every[1]))) return { ...DEFAULT_REPEAT, kind: 'hours', time, everyHours: Number(every[1]) }
  }
  return custom
}

export const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function describeRepeat(cron: string): string {
  const f = parseCron(cron)
  switch (f.kind) {
    case 'daily': return `Every day at ${f.time}`
    case 'weekdays': return `Every ${f.weekdays.map((d) => WEEKDAY_NAMES[d]).join(', ')} at ${f.time}`
    case 'monthday': return `Day ${f.dayOfMonth} of every month at ${f.time}`
    case 'hours': return `Every ${f.everyHours === 1 ? 'hour' : `${f.everyHours} hours`}, on the hour`
    case 'custom': return `Custom schedule: ${f.custom}`
  }
}
