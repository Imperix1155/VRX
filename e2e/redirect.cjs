// Loaded into the VRX main process by the end-to-end tests, before any app
// code runs (`electron -r e2e/redirect.cjs .`). It is never part of a build.
//
// It does three things, and together they make the tests safe to run anywhere:
//
// 1. A connection to VRChat or ChilloutVR goes to the fake server on this
//    computer instead (plain HTTP on 127.0.0.1, port VRX_E2E_FAKE_PORT).
// 2. A connection to anywhere else is refused. A test run can never reach a
//    real service or a real account, even by mistake.
// 3. The app's data folder is moved into the test's throwaway profile
//    (VRX_E2E_APP_DATA), so a run never writes into the log or data of a VRX
//    installed on the same computer.
//
// The app itself has no setting for this and must never get one: where VRX
// sends a sign-in is decided by its source, not by anything a user or another
// program can change. This file only works because the tests start Electron
// themselves with it preloaded.
'use strict'
/* eslint-disable @typescript-eslint/no-require-imports -- Electron preloads a CommonJS file */

const net = require('node:net')
const tls = require('node:tls')
const { app } = require('electron')

const FAKE_HOSTS = new Set([
  'api.vrchat.cloud',
  'pipeline.vrchat.cloud',
  'files.vrchat.cloud',
  'api.abinteractive.net',
  'api.chilloutvr.net',
  'files.abidata.io'
])

const port = Number(process.env.VRX_E2E_FAKE_PORT)
if (!Number.isInteger(port) || port <= 0) {
  throw new Error('e2e/redirect.cjs: VRX_E2E_FAKE_PORT is not set; refusing to start the app')
}

const appData = process.env.VRX_E2E_APP_DATA
if (!appData) {
  throw new Error('e2e/redirect.cjs: VRX_E2E_APP_DATA is not set; refusing to start the app')
}
// The log goes to <appData>/VRX/logs, which `--user-data-dir` does not move.
app.setPath('appData', appData)

/** A socket that fails at once, for every host the tests do not fake. */
function refused(host) {
  const socket = new net.Socket()
  process.nextTick(() => socket.destroy(new Error(`e2e: connection to ${host} is blocked`)))
  return socket
}

// Both of the app's network paths (`fetch` and the `ws` sockets) open their
// connection with `tls.connect`, so this one function sees every request.
tls.connect = function connectToFake(...args) {
  const options = typeof args[0] === 'object' && args[0] !== null ? args[0] : { host: args[1] }
  const host = options.servername || options.host || ''
  const onConnect = typeof args[args.length - 1] === 'function' ? args[args.length - 1] : null
  if (!FAKE_HOSTS.has(host)) return refused(host)

  const socket = net.connect({ host: '127.0.0.1', port })
  // The callers wait for the TLS handshake. There is none on a local plain
  // connection, so report it done as soon as the connection is open.
  socket.encrypted = true
  socket.authorized = true
  socket.alpnProtocol = false
  socket.getPeerCertificate = () => ({})
  socket.once('connect', () => socket.emit('secureConnect'))
  if (onConnect) socket.once('secureConnect', onConnect)
  return socket
}

// Plain (non-TLS) connections are only ever the redirected ones above.
const plainConnect = net.connect
function localOnly(...args) {
  const options = typeof args[0] === 'object' && args[0] !== null ? args[0] : { host: args[1] }
  const host = options.host ?? 'localhost'
  if (
    options.path !== undefined ||
    host === '127.0.0.1' ||
    host === 'localhost' ||
    host === '::1'
  ) {
    return plainConnect.apply(net, args)
  }
  return refused(host)
}
net.connect = localOnly
net.createConnection = localOnly
