import { isLanguage, type Language } from '../../shared/languages'
import type { AddEntryInput, UpdateEntryInput } from '../../shared/types'
import { MAX_NOTES } from '../../shared/cloud'
import { CollectionError } from './collection'

/** Argument checks for callers that cannot be trusted (the renderer, the web RPC). */

export function checkLanguage(v: unknown): Language {
  if (!isLanguage(v)) throw new CollectionError('Unknown language')
  return v
}

/** A positive safe integer, e.g. a database id. */
export function checkId(v: unknown, what: string): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 1)
    throw new CollectionError(`${what} must be a positive whole number`)
  return v
}

export function checkString(v: unknown, what: string): string {
  if (typeof v !== 'string') throw new CollectionError(`${what} must be a string`)
  return v
}

export function checkObject(v: unknown, what: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v))
    throw new CollectionError(`${what} must be an object`)
  return v as Record<string, unknown>
}

export function checkDelta(v: unknown): 1 | -1 {
  if (v !== 1 && v !== -1) throw new CollectionError('Adjustment must be +1 or -1')
  return v
}

/** Caps notes on an add input or update patch; the server stores them and syncs them everywhere. */
export function checkNotesLength(v: unknown): void {
  const notes = (v as { notes?: unknown } | null)?.notes
  if (typeof notes === 'string' && notes.length > MAX_NOTES)
    throw new CollectionError(`notes must be at most ${MAX_NOTES} characters`)
}

export function checkAddInput(v: unknown): AddEntryInput {
  const o = checkObject(v, 'Entry')
  return {
    printingId: checkId(o.printingId, 'printingId'),
    imageId: checkId(o.imageId, 'imageId'),
    quantity: checkId(o.quantity, 'quantity')
  }
}

export function checkUpdatePatch(v: unknown): UpdateEntryInput {
  const o = checkObject(v, 'Patch')
  const patch: UpdateEntryInput = {}
  if (o.quantity !== undefined) patch.quantity = checkId(o.quantity, 'quantity')
  if (o.printingId !== undefined) patch.printingId = checkId(o.printingId, 'printingId')
  if (o.imageId !== undefined) patch.imageId = checkId(o.imageId, 'imageId')
  if (o.notes !== undefined) patch.notes = checkString(o.notes, 'notes')
  return patch
}
