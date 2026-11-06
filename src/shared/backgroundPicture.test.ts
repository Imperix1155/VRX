import { describe, expect, it } from 'vitest'
import { backgroundPictureRefusal, backgroundPictureWarning } from './backgroundPicture'

describe('backgroundPictureRefusal', () => {
  it.each([
    [1920, 1080],
    [640, 360],
    [2000, 2000],
    [1080, 1600],
    [5120, 1440],
    [3840, 768]
  ])('accepts %i × %i', (width, height) => {
    expect(backgroundPictureRefusal(width, height)).toBeNull()
  })

  it.each([
    [639, 360, 'too-small'],
    [640, 359, 'too-small'],
    [256, 256, 'too-small'],
    [0, 0, 'too-small'],
    [Number.NaN, 1080, 'too-small'],
    [1080, 1920, 'too-tall'],
    [400, 4000, 'too-tall'],
    [4000, 400, 'too-wide'],
    [65_000, 1, 'too-wide']
  ])('refuses %i × %i as %s', (width, height, reason) => {
    expect(backgroundPictureRefusal(width, height)).toBe(reason)
  })
})

describe('backgroundPictureWarning', () => {
  it.each([
    [1920, 1080],
    [3840, 2160],
    [2048, 1536],
    [2000, 2000],
    [1900, 2000],
    [3440, 1440],
    [1280, 720]
  ])('has nothing to say about %i × %i', (width, height) => {
    expect(backgroundPictureWarning(width, height)).toBeNull()
  })

  it.each([
    [1080, 1600, 'tall'],
    [1600, 2000, 'tall'],
    [3840, 1080, 'wide'],
    [800, 600, 'low-res'],
    [1000, 1000, 'low-res'],
    [1920, 700, 'low-res']
  ])('warns about %i × %i as %s', (width, height, warning) => {
    expect(backgroundPictureWarning(width, height)).toBe(warning)
  })

  it('says nothing about a size it cannot read', () => {
    expect(backgroundPictureWarning(0, 0)).toBeNull()
  })
})
