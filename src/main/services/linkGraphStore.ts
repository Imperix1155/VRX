import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { LinkedPerson, LinkedPersonMember, Platform } from '@shared/types'
import type {
  LinkChange,
  LinkedProfile,
  LinkProfileFile,
  LinkProfileSnapshot
} from '@shared/linkedProfiles'
import { isPlatformAccountId } from './accountSession'
import { LinkProfileStorage } from './linkProfileStorage'

export const LINK_GRAPH_FORMAT_VERSION = 1
export const LINK_GRAPH_MAX_PEOPLE = 5_000

const ID_PATTERN = /^[A-Za-z0-9_-]+$/
const SERIALIZED_FORMAT_VERSION_PATTERN = /["']storeFormatVersion["']\s*:\s*(\d+)/
const DANGEROUS_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const platformSchema = z.enum(['vrchat', 'chilloutvr'] satisfies readonly Platform[])
const idSchema = z.string().min(1).max(256).regex(ID_PATTERN)
const personIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(ID_PATTERN)
  .refine((id) => !DANGEROUS_OBJECT_KEYS.has(id))
const memberSchema = z
  .object({
    platform: platformSchema,
    platformAccountId: z.string().refine(isPlatformAccountId),
    friendId: idSchema
  })
  .strict()

const displayNameSchema = z.string().max(256).nullable()

// Electron's main process has one JavaScript realm. This guard deliberately
// covers every LinkGraphStore instance in that realm, including storage hooks.
let linkGraphOperationActive = false

export interface LinkGraphFile {
  storeFormatVersion: number
  people: Record<string, LinkedPerson>
}

export interface LinkGraphStorage {
  read(): unknown
  write(value: LinkGraphFile | LinkProfileFile): void
  backup?(): void
}

interface LinkGraphLoadResult {
  file: LinkGraphFile
  loadValid: boolean
}

function emptyLinkGraphFile(storeFormatVersion = LINK_GRAPH_FORMAT_VERSION): LinkGraphFile {
  const file = Object.create(null) as LinkGraphFile
  file.storeFormatVersion = storeFormatVersion
  file.people = Object.create(null) as Record<string, LinkedPerson>
  return file
}

function memberKey(member: LinkedPersonMember): string {
  return `${member.platform}\u0000${member.platformAccountId}\u0000${member.friendId}`
}

function serializedFormatVersion(raw: string): number | null {
  const match = SERIALIZED_FORMAT_VERSION_PATTERN.exec(raw)
  if (!match) return null
  const version = Number(match[1])
  return Number.isSafeInteger(version) ? version : null
}

function parseFile(raw: unknown): LinkGraphLoadResult {
  let candidate = raw
  if (typeof raw === 'string') {
    try {
      candidate = JSON.parse(raw) as unknown
    } catch {
      return {
        file: emptyLinkGraphFile(serializedFormatVersion(raw) ?? LINK_GRAPH_FORMAT_VERSION),
        loadValid: false
      }
    }
  }

  const canonical = canonicalizeFile(candidate)
  if (canonical.kind === 'empty') return { file: emptyLinkGraphFile(), loadValid: true }
  if (canonical.kind === 'invalid') {
    return { file: emptyLinkGraphFile(canonical.storeFormatVersion), loadValid: false }
  }

  // Zod establishes that the descriptor-captured snapshot has the expected
  // shape. Never adopt `parsed.data`: Zod may materialize records through
  // ordinary objects, whose inherited non-writable names can drop data.
  if (isCanonicalFileValid(canonical.value)) {
    return { file: materializeFile(canonical.value), loadValid: true }
  }

  return {
    file: emptyLinkGraphFile(),
    loadValid: false
  }
}

function isCanonicalFileValid(snapshot: Record<string, unknown>): boolean {
  const version = snapshotValue(snapshot, 'storeFormatVersion')
  if (!isFormatVersion(version)) return false
  const people = snapshotValue(snapshot, 'people') as Record<string, unknown>
  const personIds = Object.keys(people)
  if (personIds.length > LINK_GRAPH_MAX_PEOPLE) return false

  const memberOwners = new Set<string>()
  for (const personId of personIds) {
    if (!Object.hasOwn(people, personId) || !personIdSchema.safeParse(personId).success)
      return false
    const person = materializePerson(snapshotValue(people, personId) as Record<string, unknown>)
    if (!isCanonicalPersonValid(person) || person.id !== personId) return false
    for (const member of person.members) {
      const key = memberKey(member)
      if (memberOwners.has(key)) return false
      memberOwners.add(key)
    }
  }
  return true
}

function isCanonicalPersonValid(person: LinkedPerson): boolean {
  const [firstMember, secondMember] = person.members
  return (
    personIdSchema.safeParse(person.id).success &&
    displayNameSchema.safeParse(person.displayName).success &&
    memberSchema.safeParse(firstMember).success &&
    memberSchema.safeParse(secondMember).success &&
    firstMember.platform !== secondMember.platform &&
    memberKey(firstMember) !== memberKey(secondMember)
  )
}

type CanonicalFile =
  | Readonly<{ kind: 'empty' }>
  | Readonly<{ kind: 'invalid'; storeFormatVersion: number }>
  | Readonly<{ kind: 'valid'; value: Record<string, unknown> }>

interface DataDescriptor {
  readonly value: unknown
  readonly enumerable?: boolean
}

function canonicalizeFile(value: unknown): CanonicalFile {
  const descriptors = dataDescriptors(value)
  if (descriptors === null) return invalidFile()
  const names = Object.keys(descriptors)
  if (names.length === 0) return isStructuredCloneSafe(value) ? { kind: 'empty' } : invalidFile()

  const version = ownDataDescriptor(descriptors, 'storeFormatVersion')
  if (
    version !== null &&
    isFormatVersion(version.value) &&
    version.value > LINK_GRAPH_FORMAT_VERSION
  ) {
    return invalidFile(version.value)
  }
  if (!hasExactlyKeys(descriptors, ['storeFormatVersion', 'people'])) return invalidFile()

  const peopleDescriptor = ownDataDescriptor(descriptors, 'people')
  if (peopleDescriptor === null) return invalidFile()
  const people = canonicalizePeople(peopleDescriptor.value)
  if (people === null || !isStructuredCloneSafe(value)) return invalidFile()
  const file = Object.create(null) as Record<string, unknown>
  const versionDescriptor = ownDataDescriptor(descriptors, 'storeFormatVersion')
  if (versionDescriptor === null) return invalidFile()
  file.storeFormatVersion = versionDescriptor.value
  file.people = people
  return { kind: 'valid', value: file }
}

function canonicalizePeople(value: unknown): Record<string, unknown> | null {
  const descriptors = dataDescriptors(value)
  if (descriptors === null) return null
  const people = Object.create(null) as Record<string, unknown>
  for (const personId of Object.keys(descriptors)) {
    const descriptor = ownDataDescriptor(descriptors, personId)
    if (descriptor === null) return null
    if (!personIdSchema.safeParse(personId).success) return null
    const person = canonicalizePerson(descriptor.value)
    if (person === null) return null
    people[personId] = person
  }
  return people
}

function canonicalizePerson(value: unknown): Record<string, unknown> | null {
  const descriptors = dataDescriptors(value)
  if (descriptors === null || !hasExactlyKeys(descriptors, ['id', 'members', 'displayName'])) {
    return null
  }
  const membersDescriptor = ownDataDescriptor(descriptors, 'members')
  const idDescriptor = ownDataDescriptor(descriptors, 'id')
  const displayNameDescriptor = ownDataDescriptor(descriptors, 'displayName')
  if (membersDescriptor === null || idDescriptor === null || displayNameDescriptor === null) {
    return null
  }
  const members = canonicalizeMembers(membersDescriptor.value)
  if (members === null) return null
  const person = Object.create(null) as Record<string, unknown>
  person.id = idDescriptor.value
  person.members = members
  person.displayName = displayNameDescriptor.value
  return person
}

function canonicalizeMembers(
  value: unknown
): [Record<string, unknown>, Record<string, unknown>] | null {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null
  if (Object.getOwnPropertySymbols(value).length !== 0) return null
  const descriptors = Object.getOwnPropertyDescriptors(value) as Record<string, PropertyDescriptor>
  if (!hasExactlyKeys(descriptors, ['0', '1', 'length'])) return null
  const first = ownPropertyDescriptor(descriptors, '0')
  const second = ownPropertyDescriptor(descriptors, '1')
  const length = ownPropertyDescriptor(descriptors, 'length')
  if (
    !isEnumerableDataDescriptor(first) ||
    !isEnumerableDataDescriptor(second) ||
    !isDataDescriptor(length) ||
    length.value !== 2
  ) {
    return null
  }
  const firstMember = canonicalizeMember(first.value)
  const secondMember = canonicalizeMember(second.value)
  return firstMember === null || secondMember === null ? null : [firstMember, secondMember]
}

function canonicalizeMember(value: unknown): Record<string, unknown> | null {
  const descriptors = dataDescriptors(value)
  if (
    descriptors === null ||
    !hasExactlyKeys(descriptors, ['platform', 'platformAccountId', 'friendId'])
  ) {
    return null
  }
  const platform = ownDataDescriptor(descriptors, 'platform')
  const platformAccountId = ownDataDescriptor(descriptors, 'platformAccountId')
  const friendId = ownDataDescriptor(descriptors, 'friendId')
  if (
    platform === null ||
    platformAccountId === null ||
    friendId === null ||
    !isStructuredCloneSafe(value)
  ) {
    return null
  }
  const member = Object.create(null) as Record<string, unknown>
  member.platform = platform.value
  member.platformAccountId = platformAccountId.value
  member.friendId = friendId.value
  return member
}

function dataDescriptors(value: unknown): Record<string, DataDescriptor> | null {
  if (!isPlainObject(value) || Object.getOwnPropertySymbols(value).length !== 0) return null
  const descriptors = Object.getOwnPropertyDescriptors(value)
  for (const descriptor of Object.values(descriptors)) {
    if (!isEnumerableDataDescriptor(descriptor)) return null
  }
  return descriptors as unknown as Record<string, DataDescriptor>
}

function hasExactlyKeys(
  descriptors: Record<string, PropertyDescriptor>,
  expectedKeys: readonly string[]
): boolean {
  const names = Object.keys(descriptors)
  return (
    names.length === expectedKeys.length &&
    expectedKeys.every((key) => Object.hasOwn(descriptors, key))
  )
}

function ownDataDescriptor(
  descriptors: Record<string, DataDescriptor>,
  key: string
): DataDescriptor | null {
  return Object.hasOwn(descriptors, key) ? descriptors[key]! : null
}

function ownPropertyDescriptor(
  descriptors: Record<string, PropertyDescriptor>,
  key: string
): PropertyDescriptor | null {
  return Object.hasOwn(descriptors, key) ? descriptors[key]! : null
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value) as object | null
  return prototype === Object.prototype || prototype === null
}

function isEnumerableDataDescriptor(
  descriptor: PropertyDescriptor | null | undefined
): descriptor is DataDescriptor {
  return (
    descriptor !== null &&
    descriptor !== undefined &&
    descriptor.enumerable === true &&
    isDataDescriptor(descriptor)
  )
}

function isDataDescriptor(
  descriptor: PropertyDescriptor | null | undefined
): descriptor is DataDescriptor {
  return descriptor !== null && descriptor !== undefined && Object.hasOwn(descriptor, 'value')
}

function isFormatVersion(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function invalidFile(storeFormatVersion = LINK_GRAPH_FORMAT_VERSION): CanonicalFile {
  return { kind: 'invalid', storeFormatVersion }
}

function isStructuredCloneSafe(value: unknown): boolean {
  try {
    structuredClone(value)
    return true
  } catch {
    return false
  }
}

/**
 * Copy only the earlier descriptor-captured canonical values into detached
 * null-prototype containers. This is deliberately separate from Zod: schemas
 * approve the snapshot but never provide the data we retain or persist.
 */
function materializeFile(snapshot: Record<string, unknown>): LinkGraphFile {
  const file = Object.create(null) as LinkGraphFile
  file.storeFormatVersion = snapshotValue(snapshot, 'storeFormatVersion') as number
  const peopleSnapshot = snapshotValue(snapshot, 'people') as Record<string, unknown>
  const people = Object.create(null) as Record<string, LinkedPerson>
  for (const personId of Object.keys(peopleSnapshot)) {
    if (!Object.hasOwn(peopleSnapshot, personId)) continue
    people[personId] = materializePerson(
      snapshotValue(peopleSnapshot, personId) as Record<string, unknown>
    )
  }
  file.people = people
  return file
}

function materializePerson(snapshot: Record<string, unknown>): LinkedPerson {
  const person = Object.create(null) as LinkedPerson
  person.id = snapshotValue(snapshot, 'id') as string
  const members = snapshotValue(snapshot, 'members') as Record<string, unknown>
  person.members = [
    materializeMember(snapshotValue(members, '0') as Record<string, unknown>),
    materializeMember(snapshotValue(members, '1') as Record<string, unknown>)
  ]
  person.displayName = snapshotValue(snapshot, 'displayName') as string | null
  return person
}

function materializeMember(snapshot: Record<string, unknown>): LinkedPersonMember {
  const member = Object.create(null) as LinkedPersonMember
  member.platform = snapshotValue(snapshot, 'platform') as Platform
  member.platformAccountId = snapshotValue(snapshot, 'platformAccountId') as string
  member.friendId = snapshotValue(snapshot, 'friendId') as string
  return member
}

function snapshotValue(snapshot: Record<string, unknown>, key: string): unknown {
  if (!Object.hasOwn(snapshot, key)) {
    throw new Error(`link graph: canonical snapshot missing ${key}`)
  }
  return snapshot[key]
}

function parseMember(member: LinkedPersonMember): LinkedPersonMember {
  const canonical = canonicalizeMember(member)
  if (canonical === null || !memberSchema.safeParse(canonical).success) {
    throw new Error('link graph: invalid member')
  }
  return materializeMember(canonical)
}

function parsePersonId(personId: string): string {
  if (!personIdSchema.safeParse(personId).success) throw new Error('link graph: invalid person id')
  return personId
}

const PROFILE_VERSION = 2
const revisionSchema = z
  .number()
  .int()
  .min(1)
  .max(Number.MAX_SAFE_INTEGER - 1)
const profileFields = {
  customName: z.string().trim().min(1).max(256).nullable(),
  defaultName: z.string().max(256),
  preferredPlatform: platformSchema,
  pictureMode: z.enum(['preferred', 'merged']),
  sharedNote: z.string().max(500),
  revision: revisionSchema
}
const profileKeys = ['id', 'members', ...Object.keys(profileFields)]
const changeSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('replace'),
      members: z.tuple([memberSchema, memberSchema]),
      preferredPlatform: platformSchema,
      defaultName: z.string().max(256),
      expectedPeople: z
        .array(z.object({ id: personIdSchema, revision: revisionSchema }).strict())
        .max(2)
    })
    .strict(),
  z
    .object({
      kind: z.literal('unlink'),
      personId: personIdSchema,
      expectedRevision: revisionSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal('update'),
      personId: personIdSchema,
      expectedRevision: revisionSchema,
      patch: z
        .object({ ...profileFields, revision: z.never().optional() })
        .omit({ revision: true })
        .partial()
        .strict()
    })
    .strict()
])

function toProfile(person: LinkedPerson): LinkedProfile {
  return {
    id: person.id,
    members: person.members,
    customName: person.displayName?.trim() || null,
    defaultName: person.displayName ?? '',
    preferredPlatform: person.members[0].platform,
    pictureMode: 'preferred',
    sharedNote: '',
    revision: 1
  }
}

function emptyProfiles(): LinkProfileFile {
  return {
    storeFormatVersion: 2,
    revision: 1,
    people: Object.create(null) as Record<string, LinkedProfile>
  }
}

/** Capture plain data without evaluating accessors, including command patches. */
function plainSnapshot(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) {
    if (
      Object.getPrototypeOf(value) !== Array.prototype ||
      Object.getOwnPropertySymbols(value).length
    )
      throw new Error('link graph: invalid array')
    const descriptors = Object.getOwnPropertyDescriptors(value)
    if (Object.keys(descriptors).length !== value.length + 1)
      throw new Error('link graph: invalid array')
    const result = Array.from({ length: value.length }, (_, i) => {
      const entry = ownPropertyDescriptor(descriptors, String(i))
      if (!isEnumerableDataDescriptor(entry)) throw new Error('link graph: invalid array')
      return plainSnapshot(entry.value)
    })
    if (!isStructuredCloneSafe(value)) throw new Error('link graph: invalid array')
    return result
  }
  const descriptors = dataDescriptors(value)
  if (!descriptors) throw new Error('link graph: invalid object')
  const result = Object.create(null) as Record<string, unknown>
  for (const key of Object.keys(descriptors)) {
    if (DANGEROUS_OBJECT_KEYS.has(key)) throw new Error('link graph: invalid key')
    result[key] = plainSnapshot(descriptors[key]!.value)
  }
  if (!isStructuredCloneSafe(value)) throw new Error('link graph: invalid object')
  return result
}

function parseProfiles(raw: unknown): { file: LinkProfileFile; legacy: boolean } {
  const value: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw
  const descriptors = dataDescriptors(value)
  if (!descriptors) throw new Error('link graph: storage could not be loaded')
  const version = ownDataDescriptor(descriptors, 'storeFormatVersion')?.value
  if (typeof version === 'number' && version > PROFILE_VERSION)
    throw new Error('link graph: refusing to overwrite data written by a newer version')
  if (version !== PROFILE_VERSION) {
    const legacy = parseFile(value)
    if (!legacy.loadValid || (version !== undefined && version !== 1))
      throw new Error('link graph: storage could not be loaded')
    const file = emptyProfiles()
    for (const person of Object.values(legacy.file.people))
      file.people[person.id] = toProfile(person)
    return { file, legacy: version === 1 }
  }
  if (!hasExactlyKeys(descriptors, ['storeFormatVersion', 'revision', 'people']))
    throw new Error('link graph: invalid file')
  // Descriptor validation happens before cloning, which otherwise evaluates getters.
  const peopleDescriptors = dataDescriptors(ownDataDescriptor(descriptors, 'people')?.value)
  if (!peopleDescriptors || Object.keys(peopleDescriptors).length > LINK_GRAPH_MAX_PEOPLE)
    throw new Error('link graph: invalid people')
  const file = emptyProfiles()
  file.revision = revisionSchema.parse(ownDataDescriptor(descriptors, 'revision')?.value)
  const owners = new Set<string>()
  for (const id of Object.keys(peopleDescriptors)) {
    parsePersonId(id)
    const pd = dataDescriptors(peopleDescriptors[id]!.value)
    if (!pd || !hasExactlyKeys(pd, profileKeys)) throw new Error('link graph: invalid profile')
    const members = canonicalizeMembers(pd.members?.value)
    if (!members || !members.every((m) => memberSchema.safeParse(m).success))
      throw new Error('link graph: invalid members')
    const person = Object.create(null) as LinkedProfile
    person.id = parsePersonId(pd.id!.value as string)
    person.members = members.map(materializeMember) as LinkedProfile['members']
    if (person.id !== id || person.members[0].platform === person.members[1].platform)
      throw new Error('link graph: invalid profile')
    const fields = Object.create(null) as Record<string, unknown>
    for (const key of Object.keys(profileFields)) fields[key] = pd[key]!.value
    Object.assign(person, z.object(profileFields).strict().parse(fields))
    for (const member of person.members) {
      const key = memberKey(member)
      if (owners.has(key)) throw new Error('link graph: conflicting members')
      owners.add(key)
    }
    file.people[id] = person
  }
  if (!isStructuredCloneSafe(value)) throw new Error('link graph: invalid data')
  return { file, legacy: false }
}

/** Installation-global profiles. All mutations require reviewed revisions. */
export class LinkGraphStore {
  constructor(
    private readonly storage: LinkGraphStorage = new LinkProfileStorage(),
    private readonly createPersonId: () => string = () => randomUUID()
  ) {}

  list(strict = false): LinkedProfile[] {
    return this.runOperation(() => {
      try {
        return this.loadSnapshot().profiles
      } catch (error) {
        if (strict) throw error
        return []
      }
    })
  }

  snapshot(): LinkProfileSnapshot {
    return this.runOperation(() => this.loadSnapshot())
  }

  private loadSnapshot(): LinkProfileSnapshot {
    const loaded = parseProfiles(this.storage.read())
    if (loaded.legacy) {
      try {
        this.commit(loaded.file, true)
      } catch {
        /* Keep valid v1 readable. */
      }
    }
    return profileSnapshot(loaded.file)
  }

  getByMember(member: LinkedPersonMember): LinkedProfile | null {
    return this.runOperation(() => {
      const parsedMember = parseMember(member)
      try {
        const { file, legacy } = parseProfiles(this.storage.read())
        if (legacy) {
          try {
            this.commit(file, true)
          } catch {
            /* A failed migration must not hide valid v1 records. */
          }
        }
        const person = Object.values(file.people).find((p) =>
          p.members.some((m) => memberKey(m) === memberKey(parsedMember))
        )
        return person ? structuredClone(person) : null
      } catch {
        return null
      }
    })
  }

  apply(change: LinkChange): LinkedProfile | null
  apply(change: LinkChange, snapshot: true): LinkProfileSnapshot
  apply(change: LinkChange, snapshot = false): LinkedProfile | LinkProfileSnapshot | null {
    return this.runOperation(() => {
      const result = (
        person: LinkedProfile,
        file: LinkProfileFile
      ): LinkedProfile | LinkProfileSnapshot =>
        structuredClone(snapshot ? profileSnapshot(file) : person)
      const captured = plainSnapshot(change)
      changeSchema.parse(captured)
      // Zod validates, but its ordinary-object output may lose inherited
      // non-writable field names. Retain the detached descriptor snapshot.
      const command = captured as LinkChange
      if (command.kind === 'update' && typeof command.patch.customName === 'string')
        command.patch.customName = command.patch.customName.trim()
      let loaded = parseProfiles(this.storage.read())
      if (command.kind === 'replace') {
        const [a, b] = command.members
        if (a.platform === b.platform)
          throw new Error('link graph: one member per platform required')
        const matches = (file: LinkProfileFile): LinkedProfile[] =>
          Object.values(file.people).filter((p) =>
            p.members.some((m) => memberKey(m) === memberKey(a) || memberKey(m) === memberKey(b))
          )
        const matching = matches(loaded.file)
        // An identical pair is a non-destructive no-op, even for an old confirmation.
        if (
          matching.length === 1 &&
          matching[0]!.members.every(
            (m) => memberKey(m) === memberKey(a) || memberKey(m) === memberKey(b)
          )
        )
          return result(matching[0]!, loaded.file)
        const verify = (affected: LinkedProfile[]): void => {
          if (
            new Set(command.expectedPeople.map((p) => p.id)).size !==
              command.expectedPeople.length ||
            affected.length !== command.expectedPeople.length ||
            affected.some(
              (p) => !command.expectedPeople.some((e) => e.id === p.id && e.revision === p.revision)
            )
          )
            throw new Error('link graph: stale confirmation')
        }
        verify(matching)
        // Caller-supplied ID factories can run arbitrary callbacks. Reload after them.
        const id = parsePersonId(this.createPersonId())
        loaded = parseProfiles(this.storage.read())
        const affected = matches(loaded.file)
        verify(affected)
        if (Object.hasOwn(loaded.file.people, id))
          throw new Error('link graph: generated a duplicate person id')
        if (Object.keys(loaded.file.people).length - affected.length >= LINK_GRAPH_MAX_PEOPLE)
          throw new Error('link graph: maximum linked people reached')
        const person: LinkedProfile = {
          id,
          members: command.members,
          customName: null,
          defaultName: command.defaultName,
          preferredPlatform: command.preferredPlatform,
          pictureMode: 'preferred',
          sharedNote: '',
          revision: 1
        }
        const next = copyProfileFile(loaded.file)
        for (const old of affected) delete next.people[old.id]
        next.people[id] = person
        const response = result(person, next)
        this.commit(next, loaded.legacy)
        return response
      }
      const person = Object.hasOwn(loaded.file.people, command.personId)
        ? loaded.file.people[command.personId]
        : undefined
      if (!person || person.revision !== command.expectedRevision)
        throw new Error('link graph: stale confirmation')
      const next = copyProfileFile(loaded.file)
      if (command.kind === 'unlink') delete next.people[person.id]
      else next.people[person.id] = { ...person, ...command.patch, revision: person.revision + 1 }
      const response = result(command.kind === 'unlink' ? person : next.people[person.id]!, next)
      this.commit(next, loaded.legacy)
      return response
    })
  }

  private commit(next: LinkProfileFile, migrating: boolean): void {
    // Validate the exact outgoing document, including safe-integer revision bounds.
    parseProfiles(next)
    if (migrating) this.storage.backup?.()
    this.storage.write(next)
  }

  private runOperation<T>(operation: () => T): T {
    if (linkGraphOperationActive) throw new Error('link graph: reentrant operation rejected')
    linkGraphOperationActive = true
    try {
      return operation()
    } finally {
      linkGraphOperationActive = false
    }
  }
}

function profileSnapshot(file: LinkProfileFile): LinkProfileSnapshot {
  return {
    storeRevision: file.revision,
    profiles: Object.values(file.people)
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((person) => structuredClone(person))
  }
}

function copyProfileFile(file: LinkProfileFile): LinkProfileFile {
  const next = emptyProfiles()
  next.revision = file.revision + 1
  for (const person of Object.values(file.people)) next.people[person.id] = person
  return next
}
