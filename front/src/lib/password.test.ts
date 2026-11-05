import { expect, test } from 'vitest'
import { newPasswordProblem } from './password'

test.each([
  ['nothing typed yet', '', '', '', null],
  ['a short new password', 'current password', 'eleven char', '', 'Use at least 12 characters.'],
  ['only spaces', 'current password', ' '.repeat(20), '', 'Use at least 12 characters.'],
  ['a very long one', 'current password', 'b'.repeat(257), '', 'Use at most 256 characters.'],
  ['the same password', 'current password', 'current password', 'current password', 'Choose a different password.'],
  ['a mismatch', 'current password', 'a brand new password', 'a brand new passworX', 'The passwords do not match.'],
  ['a repeat still being typed', 'current password', 'a brand new password', '', null],
  ['a good one', 'current password', 'a brand new password', 'a brand new password', null],
])('new password check: %s', (_name, current, next, repeat, problem) => {
  expect(newPasswordProblem(current, next, repeat)).toBe(problem)
})
