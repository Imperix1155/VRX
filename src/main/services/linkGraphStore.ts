import Store from 'electron-store'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { LinkedPerson, LinkedPersonMember, Platform } from '@shared/types'
import { isPlatformAccountId } from './accountSession'

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
  write(value: LinkGraphFile): void
}

class ElectronLinkGraphStorage implements LinkGraphStorage {
  private store: Store<Record<string, unknown>> | null = null

  read(): unknown {
    return this.getStore().store
  }

  write(value: LinkGraphFile): void {
    this.getStore().store = { ...value }
  }

  private getStore(): Store<Record<string, unknown>> {
    this.store ??= new Store<Record<string, unknown>>({
      name: 'link-graph',
      accessPropertiesByDotNotation: false
    })
    return this.store
  }
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

function createPerson(
  id: string,
  firstMember: LinkedPersonMember,
  secondMember: LinkedPersonMember,
  displayName: string | null
): LinkedPerson {
  const person = Object.create(null) as LinkedPerson
  person.id = id
  person.members = [firstMember, secondMember]
  person.displayName = displayName
  return person
}

function copyPeople(
  people: Record<string, LinkedPerson>,
  omitPersonId?: string
): Record<string, LinkedPerson> {
  const copied = Object.create(null) as Record<string, LinkedPerson>
  for (const personId of Object.keys(people)) {
    if (!Object.hasOwn(people, personId) || personId === omitPersonId) continue
    copied[personId] = people[personId]!
  }
  return copied
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

function parseDisplayName(displayName: string | null): string | null {
  if (!displayNameSchema.safeParse(displayName).success) {
    throw new Error('link graph: invalid display name')
  }
  return displayName
}

/** Installation-global, account-qualified cross-platform identity references. */
export class LinkGraphStore {
  private readonly storage: LinkGraphStorage
  private file: LinkGraphFile
  private loadValid: boolean
  constructor(
    storage?: LinkGraphStorage,
    private readonly createPersonId: () => string = () => randomUUID()
  ) {
    this.storage = storage ?? new ElectronLinkGraphStorage()
    this.file = emptyLinkGraphFile()
    this.loadValid = false
    this.refresh()
  }

  list(): LinkedPerson[] {
    return this.runOperation(() => {
      this.refresh()
      return Object.values(this.file.people)
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((person) => structuredClone(person))
    })
  }

  getByMember(member: LinkedPersonMember): LinkedPerson | null {
    return this.runOperation(() => {
      const parsedMember = parseMember(member)
      this.refresh()
      const owner = this.findByMember(parsedMember)
      return owner === undefined ? null : structuredClone(owner)
    })
  }

  link(
    firstMember: LinkedPersonMember,
    secondMember: LinkedPersonMember,
    displayName: string | null = null
  ): LinkedPerson {
    return this.runOperation(() => {
      const parsedFirstMember = parseMember(firstMember)
      const parsedSecondMember = parseMember(secondMember)
      const personId = this.createPersonId()
      if (!personIdSchema.safeParse(personId).success) {
        throw new Error('link graph: generated an invalid person id')
      }
      const parsedDisplayName = parseDisplayName(displayName)

      this.refresh()
      if (parsedFirstMember.platform === parsedSecondMember.platform) {
        throw new Error('link graph: a person must have one member per platform')
      }
      if (memberKey(parsedFirstMember) === memberKey(parsedSecondMember)) {
        throw new Error('link graph: a member cannot appear twice in one person')
      }
      this.assertWritable()
      if (
        this.findByMember(parsedFirstMember) !== undefined ||
        this.findByMember(parsedSecondMember) !== undefined
      ) {
        throw new Error('link graph: member is already linked')
      }
      if (Object.keys(this.file.people).length >= LINK_GRAPH_MAX_PEOPLE) {
        throw new Error('link graph: maximum linked people reached')
      }
      if (Object.hasOwn(this.file.people, personId)) {
        throw new Error('link graph: generated a duplicate person id')
      }

      const person = createPerson(
        personId,
        parsedFirstMember,
        parsedSecondMember,
        parsedDisplayName
      )
      const next = emptyLinkGraphFile()
      next.people = copyPeople(this.file.people)
      next.people[person.id] = person
      this.persist(next)
      return structuredClone(person)
    })
  }

  unlink(personId: string): LinkedPerson | null {
    return this.runOperation(() => {
      const parsedPersonId = parsePersonId(personId)
      this.refresh()
      this.assertWritable()
      if (!Object.hasOwn(this.file.people, parsedPersonId)) return null
      const person = this.file.people[parsedPersonId]
      if (person === undefined) return null

      const next = emptyLinkGraphFile()
      next.people = copyPeople(this.file.people, parsedPersonId)
      this.persist(next)
      return structuredClone(person)
    })
  }

  private refresh(): void {
    try {
      const loaded = parseFile(this.storage.read())
      this.file = loaded.file
      this.loadValid = loaded.loadValid
    } catch {
      this.file = emptyLinkGraphFile()
      this.loadValid = false
    }
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

  private assertWritable(): void {
    if (this.file.storeFormatVersion > LINK_GRAPH_FORMAT_VERSION) {
      throw new Error('link graph: refusing to overwrite data written by a newer version')
    }
    if (!this.loadValid) {
      throw new Error('link graph: storage could not be loaded; explicit recovery/reset required')
    }
  }

  private persist(next: LinkGraphFile): void {
    try {
      this.storage.write(structuredClone(next))
    } catch (error) {
      this.refresh()
      throw error
    }
    this.file = next
    this.loadValid = true
  }

  private findByMember(member: LinkedPersonMember): LinkedPerson | undefined {
    const key = memberKey(member)
    return Object.values(this.file.people).find((person) =>
      person.members.some((candidate) => memberKey(candidate) === key)
    )
  }
}
