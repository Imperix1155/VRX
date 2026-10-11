/**
 * Main-process copy (dialogs, native notifications, tray).
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
  'recovery.crash.title': 'VRX — Renderer Crashed',
  'recovery.crash.message': 'The window has stopped responding due to an unexpected error.',
  'recovery.crash.detail': 'Reason: {{reason}} (exit code {{exitCode}})',
  'recovery.hang.title': 'VRX — Window Not Responding',
  'recovery.hang.message': 'VRX is not responding.',
  'recovery.hang.detail': 'The window may be busy. You can wait or reload it.',
  'recovery.reload': 'Reload',
  'recovery.dismiss': 'Dismiss',
  'recovery.wait': 'Wait',
  'cvrImport.title': 'ChilloutVR session import',
  'cvrImport.message': 'Allow VRX to find and use an existing ChilloutVR session?',
  'cvrImport.detail':
    'VRX will read local ChilloutVR game profiles and CVRX files, copy a session into VRX, and sign in on your behalf. Source files are never changed. Sessions use OS-backed encryption when available; otherwise a weaker local installation key is stored alongside the encrypted data. Access to both permits session recovery. VRX remembers your choice. You can change it in Settings → Accounts; direct sign-in remains available.',
  'cvrImport.deny': 'Use direct sign-in',
  'cvrImport.allow': 'Allow session import',
  'cvrImport.saveFailed.message': 'Your session import choice could not be saved.',
  'cvrImport.saveFailed.detail':
    'No external session was read. You can sign in directly. VRX may ask again on the next launch.',
  'cvrImport.saveFailed.continue': 'Continue to sign-in'
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
  'recovery.crash.title': 'VRX — 画面がクラッシュしました',
  'recovery.crash.message': '予期しないエラーにより、ウィンドウが応答しなくなりました。',
  'recovery.crash.detail': '理由: {{reason}}（終了コード {{exitCode}}）',
  'recovery.hang.title': 'VRX — ウィンドウが応答していません',
  'recovery.hang.message': 'VRX が応答していません。',
  'recovery.hang.detail': 'ウィンドウが処理中の可能性があります。待つか、再読み込みしてください。',
  'recovery.reload': '再読み込み',
  'recovery.dismiss': '閉じる',
  'recovery.wait': '待つ',
  'cvrImport.title': 'ChilloutVR セッションのインポート',
  'cvrImport.message': 'VRX が既存の ChilloutVR セッションを検出して使用することを許可しますか？',
  'cvrImport.detail':
    'VRX はローカルの ChilloutVR ゲームプロファイルと CVRX ファイルを読み取り、セッションを VRX にコピーして、あなたの代わりにサインインします。元のファイルが変更されることはありません。セッションは利用可能な場合 OS の暗号化で保護されます。利用できない場合は、より弱いローカルのインストールキーが暗号化データと一緒に保存されます。両方にアクセスできるとセッションを復元できます。VRX はこの選択を記憶します。設定 → アカウントでいつでも変更でき、直接サインインも引き続き利用できます。',
  'cvrImport.deny': '直接サインインする',
  'cvrImport.allow': 'セッションのインポートを許可',
  'cvrImport.saveFailed.message': 'セッションのインポートの選択を保存できませんでした。',
  'cvrImport.saveFailed.detail':
    '外部のセッションは読み取られていません。直接サインインできます。次回の起動時にもう一度確認される場合があります。',
  'cvrImport.saveFailed.continue': 'サインインに進む'
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
