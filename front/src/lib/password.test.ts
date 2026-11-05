import { expect, test } from 'vitest'
import { newPasswordProblem } from './password'

test.each([
  ['nothing typed yet', '', '', '', null],
  ['a short new password', 'current password', 'eleven char', '', 'tooShort'],
  ['only spaces', 'current password', ' '.repeat(20), '', 'tooShort'],
  ['a very long one', 'current password', 'b'.repeat(257), '', 'tooLong'],
  ['the same password', 'current password', 'current password', 'current password', 'same'],
  ['a mismatch', 'current password', 'a brand new password', 'a brand new passworX', 'mismatch'],
  ['a repeat still being typed', 'current password', 'a brand new password', '', null],
  ['a good one', 'current password', 'a brand new password', 'a brand new password', null],
])('new password check: %s', (_name, current, next, repeat, problem) => {
  expect(newPasswordProblem(current, next, repeat)).toBe(problem)
})
