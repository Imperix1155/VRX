/**
 * Main-process copy (dialogs, native notifications, tray, fatal error boxes).
 *
 * The renderer picks its language from `navigator.language`, which Electron
 * derives from `app.getLocale()`. Main resolves the same locale once at startup
 * via `setMainLocale(app.getLocale())`, so native surfaces match the window.
 * Kept free of electron imports so presenters stay unit-testable.
 */
export type MainLocale = 'en' | 'ja'

const en = {
  'tray.show': 'Show VRX',
  'tray.hide': 'Hide VRX',
  'tray.quit': 'Quit VRX',
  'notify.online.title': 'Friend Online',
  'notify.online.body': '{{name}} came online',
  'notify.inGame.title': 'Friend Joined a World',
  'notify.inGame.body': '{{name}} joined {{world}}',
  'notify.inGame.bodyNoWorld': '{{name}} joined a world',
  'notify.offline.title': 'Friend Offline',
  'notify.offline.body': '{{name}} went offline',
  'notify.hot.title': 'Friends Gathering',
  'notify.hot.body_one': '1 friend is together in {{world}} — join them?',
  'notify.hot.body_other': '{{count}} friends are together in {{world}} — join them?',
  'notify.hot.bodyNoWorld_one': '1 friend is in the same instance — join them?',
  'notify.hot.bodyNoWorld_other': '{{count}} friends are in the same instance — join them?',
  'notify.inbox.someone': 'Someone',
  'notify.invite.title': 'Invite',
  'notify.invite.body': '{{name}} invited you to {{world}}',
  'notify.invite.bodyNoWorld': '{{name}} invited you',
  'notify.inviteRequest.title': 'Invite Request',
  'notify.inviteRequest.body': '{{name}} asked you for an invite',
  'notify.friendRequest.title': 'Friend Request',
  'notify.friendRequest.body': '{{name}} sent you a friend request',
  'notify.vrTest.title': 'VRX',
  'notify.vrTest.body': 'Alerts in VR are working.',
  'recovery.crash.title': 'VRX — Renderer Crashed',
  'recovery.crash.message': 'The window has stopped responding due to an unexpected error.',
  'recovery.crash.detail': 'Reason: {{reason}} (exit code {{exitCode}})',
  'recovery.hang.title': 'VRX — Window Not Responding',
  'recovery.hang.message': 'VRX is not responding.',
  'recovery.hang.detail': 'The window may be busy. You can wait or reload it.',
  'recovery.reload': 'Reload',
  'recovery.dismiss': 'Dismiss',
  'recovery.wait': 'Wait',
  'fatal.startup.title': 'VRX failed to start',
  'fatal.startup.message': 'Something went wrong while VRX was starting. Try opening it again.',
  'fatal.runtime.title': 'VRX has to close',
  'fatal.runtime.message': 'Something went wrong and VRX has to close. Open it again to continue.',
  'appBackground.dialogTitle': 'Choose a background picture',
  'appBackground.dialogFilter': 'Pictures (PNG, JPEG)'
} as const

export type MainStringKey = keyof typeof en

const ja: Record<MainStringKey, string> = {
  'tray.show': 'VRX を表示',
  'tray.hide': 'VRX を隠す',
  'tray.quit': 'VRX を終了',
  'notify.online.title': 'フレンドがオンライン',
  'notify.online.body': '{{name}}がオンラインになりました',
  'notify.inGame.title': 'フレンドがワールドに参加',
  'notify.inGame.body': '{{name}}が{{world}}に参加しました',
  'notify.inGame.bodyNoWorld': '{{name}}がワールドに参加しました',
  'notify.offline.title': 'フレンドがオフライン',
  'notify.offline.body': '{{name}}がオフラインになりました',
  'notify.hot.title': 'フレンドが集まっています',
  'notify.hot.body_one': '{{world}}にフレンドが1人います — 参加しますか？',
  'notify.hot.body_other': '{{world}}にフレンドが{{count}}人集まっています — 参加しますか？',
  'notify.hot.bodyNoWorld_one': '同じインスタンスにフレンドが1人います — 参加しますか？',
  'notify.hot.bodyNoWorld_other':
    '同じインスタンスにフレンドが{{count}}人集まっています — 参加しますか？',
  'notify.inbox.someone': '誰か',
  'notify.invite.title': '招待',
  'notify.invite.body': '{{name}}から{{world}}への招待が届きました',
  'notify.invite.bodyNoWorld': '{{name}}から招待が届きました',
  'notify.inviteRequest.title': '招待リクエスト',
  'notify.inviteRequest.body': '{{name}}が招待を求めています',
  'notify.friendRequest.title': 'フレンドリクエスト',
  'notify.friendRequest.body': '{{name}}からフレンドリクエストが届きました',
  'notify.vrTest.title': 'VRX',
  'notify.vrTest.body': 'VR での通知が届いています。',
  'recovery.crash.title': 'VRX — 画面がクラッシュしました',
  'recovery.crash.message': '予期しないエラーにより、ウィンドウが応答しなくなりました。',
  'recovery.crash.detail': '理由: {{reason}}（終了コード {{exitCode}}）',
  'recovery.hang.title': 'VRX — ウィンドウが応答していません',
  'recovery.hang.message': 'VRX が応答していません。',
  'recovery.hang.detail': 'ウィンドウが処理中の可能性があります。待つか、再読み込みしてください。',
  'recovery.reload': '再読み込み',
  'recovery.dismiss': '閉じる',
  'recovery.wait': '待つ',
  'fatal.startup.title': 'VRX を起動できませんでした',
  'fatal.startup.message': 'VRX の起動中に問題が発生しました。もう一度開いてみてください。',
  'fatal.runtime.title': 'VRX を終了します',
  'fatal.runtime.message': '問題が発生したため、VRX を終了します。もう一度開いて続けてください。',
  'appBackground.dialogTitle': '背景画像を選択',
  'appBackground.dialogFilter': '画像（PNG、JPEG）'
}

const TABLES: Record<MainLocale, Record<MainStringKey, string>> = { en, ja }

let current: MainLocale = 'en'

/** Map an Electron/BCP-47 locale (e.g. `ja-JP`) to a supported main locale. */
export function resolveMainLocale(locale: string | undefined | null): MainLocale {
  return locale?.toLowerCase().split(/[-_]/)[0] === 'ja' ? 'ja' : 'en'
}

export function setMainLocale(locale: string | undefined | null): MainLocale {
  current = resolveMainLocale(locale)
  return current
}

export function getMainLocale(): MainLocale {
  return current
}

/** Translate with `{{var}}` interpolation; missing keys fall back to English. */
export function mt(key: MainStringKey, vars: Record<string, string | number> = {}): string {
  const template = TABLES[current][key] ?? en[key]
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match
  )
}
