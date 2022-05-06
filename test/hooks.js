'use strict'

const { test } = require('tap')
const net = require('net')
const Fastify = require('fastify')
const fastifyWebsocket = require('..')
const WebSocket = require('ws')
const { once } = require('events')

test('Should run onRequest, preValidation, preHandler hooks', async t => {
  t.plan(6)
  const fastify = Fastify()

  t.teardown(() => fastify.close())

  await fastify.register(fastifyWebsocket)

  fastify.addHook('onRequest', async () => t.ok('called', 'onRequest'))
  fastify.addHook('preParsing', async () => t.ok('called', 'preParsing'))
  fastify.addHook('preValidation', async () => t.ok('called', 'preValidation'))
  fastify.addHook('preHandler', async () => t.ok('called', 'preHandler'))

  fastify.get('/echo', { websocket: true }, (conn) => {
    conn.setEncoding('utf8')
    conn.write('hello client')
    t.teardown(conn.destroy.bind(conn))

    conn.once('data', chunk => {
      t.equal(chunk, 'hello server')
      conn.end()
    })
  })

  await fastify.listen({ port: 0 })

  const ws = new WebSocket('ws://localhost:' + (fastify.server.address()).port + '/echo')
  const client = WebSocket.createWebSocketStream(ws, { encoding: 'utf8' })
  t.teardown(client.destroy.bind(client))

  client.setEncoding('utf8')
  client.write('hello server')

  const [chunk] = await once(client, 'data')
  t.equal(chunk, 'hello client')
  client.end()
  await once(client, 'close')
})

test('Should not run onTimeout hook', async t => {
  t.plan(1)
  const fastify = Fastify()

  t.teardown(() => fastify.close())

  await fastify.register(fastifyWebsocket)

  fastify.addHook('onTimeout', async () => t.fail('called', 'onTimeout'))

  fastify.get('/echo', { websocket: true }, (conn) => {
    conn.setEncoding('utf8')
    conn.write('hello client')
    t.teardown(conn.destroy.bind(conn))
  })

  await fastify.listen({ port: 0 })
  const ws = new WebSocket('ws://localhost:' + (fastify.server.address()).port + '/echo')
  const client = WebSocket.createWebSocketStream(ws, { encoding: 'utf8' })
  t.teardown(client.destroy.bind(client))

  const [chunk] = await once(client, 'data')
  t.equal(chunk, 'hello client')
})

test('Should run onError hook before handler is executed (error thrown in onRequest hook)', t => {
  t.plan(3)
  const fastify = Fastify()

  t.teardown(() => fastify.close())

  fastify.register(fastifyWebsocket)

  fastify.addHook('onRequest', async (request, reply) => { throw new Error('Fail') })
  fastify.addHook('onError', async (request, reply) => t.ok('called', 'onError'))

  fastify.get('/echo', { websocket: true }, (conn, request) => {
    t.teardown(conn.destroy.bind(conn))
  })

  fastify.listen({ port: 0 }, function (err) {
    t.error(err)
    const ws = new WebSocket('ws://localhost:' + (fastify.server.address()).port + '/echo')
    const client = WebSocket.createWebSocketStream(ws, { encoding: 'utf8' })
    t.teardown(client.destroy.bind(client))
    ws.on('close', code => t.equal(code, 1006))
  })
})

test('Should run onError hook before handler is executed (error thrown in preValidation hook)', t => {
  t.plan(3)
  const fastify = Fastify()

  t.teardown(() => fastify.close())

  fastify.register(fastifyWebsocket)

  fastify.addHook('preValidation', async () => {
    await Promise.resolve()
    throw new Error('Fail')
  })

  fastify.addHook('onError', async () => t.ok('called', 'onError'))

  fastify.get('/echo', { websocket: true }, () => {
    t.fail()
  })

  fastify.listen({ port: 0 }, function (err) {
    t.error(err)
    const ws = new WebSocket('ws://localhost:' + (fastify.server.address()).port + '/echo')
    const client = WebSocket.createWebSocketStream(ws, { encoding: 'utf8' })
    t.teardown(client.destroy.bind(client))
    ws.on('close', code => t.equal(code, 1006))
  })
})

test('onError hooks can send a reply and prevent hijacking', t => {
  t.plan(3)
  const fastify = Fastify()

  t.teardown(() => fastify.close())

  fastify.register(fastifyWebsocket)

  fastify.addHook('preValidation', async (request, reply) => {
    await Promise.resolve()
    throw new Error('Fail')
  })

  fastify.addHook('onError', async (request, reply) => {
    t.ok('called', 'onError')
    await reply.code(404).send('there was an error')
  })

  fastify.get('/echo', { websocket: true }, (conn, request) => {
    t.fail()
  })

  fastify.listen({ port: 0 }, function (err) {
    t.error(err)
    const ws = new WebSocket('ws://localhost:' + (fastify.server.address()).port + '/echo')
    const client = WebSocket.createWebSocketStream(ws, { encoding: 'utf8' })
    t.teardown(client.destroy.bind(client))
    ws.on('close', code => t.equal(code, 1006))
  })
})

test('Should not run onError hook if reply was already hijacked (error thrown in websocket handler)', t => {
  t.plan(2)
  const fastify = Fastify()

  t.teardown(() => fastify.close())

  fastify.register(fastifyWebsocket)

  fastify.addHook('onError', async (request, reply) => t.fail('called', 'onError'))

  fastify.get('/echo', { websocket: true }, async (conn, request) => {
    t.teardown(conn.destroy.bind(conn))
    throw new Error('Fail')
  })

  fastify.listen({ port: 0 }, function (err) {
    t.error(err)
    const ws = new WebSocket('ws://localhost:' + (fastify.server.address()).port + '/echo')
    const client = WebSocket.createWebSocketStream(ws, { encoding: 'utf8' })
    t.teardown(client.destroy.bind(client))
    ws.on('close', code => t.equal(code, 1006))
  })
})

test('Should not run preSerialization/onSend hooks', async t => {
  t.plan(1)
  const fastify = Fastify()

  t.teardown(() => fastify.close())

  await fastify.register(fastifyWebsocket)

  fastify.addHook('onSend', async () => t.fail('called', 'onSend'))
  fastify.addHook('preSerialization', async () => t.fail('called', 'preSerialization'))

  fastify.get('/echo', { websocket: true }, async (conn) => {
    conn.setEncoding('utf8')
    conn.write('hello client')
    t.teardown(conn.destroy.bind(conn))
    conn.end()
  })

  await fastify.listen({ port: 0 })
  const ws = new WebSocket('ws://localhost:' + (fastify.server.address()).port + '/echo')
  const client = WebSocket.createWebSocketStream(ws, { encoding: 'utf8' })
  t.teardown(client.destroy.bind(client))

  const [chunk] = await once(client, 'data')
  t.equal(chunk, 'hello client')
  client.end()
})

test('Should not hijack reply for a normal http request in the internal onError hook', t => {
  t.plan(2)
  const fastify = Fastify()

  t.teardown(() => fastify.close())

  fastify.register(fastifyWebsocket)

  fastify.get('/', async () => {
    throw new Error('Fail')
  })

  fastify.listen({ port: 0 }, err => {
    t.error(err)

    const port = fastify.server.address().port

    const httpClient = net.createConnection({ port }, () => {
      httpClient.write('GET / HTTP/1.1\r\n\r\n')
      httpClient.once('data', data => {
        t.match(data.toString(), /Fail/i)
        httpClient.destroy()
      })
    })
  })
})

test('Should run async hooks and still deliver quickly sent messages', async (t) => {
  t.plan(2)
  const fastify = Fastify()

  t.teardown(() => fastify.close())

  await fastify.register(fastifyWebsocket)

  fastify.addHook(
    'preValidation',
    async () => await new Promise((resolve) => setTimeout(resolve, 25))
  )

  fastify.get('/echo', { websocket: true }, (conn) => {
    conn.setEncoding('utf8')
    conn.write('hello client')
    t.teardown(conn.destroy.bind(conn))

    conn.socket.on('message', (message) => {
      t.equal(message.toString('utf-8'), 'hello server')
      conn.end()
    })
  })

  await fastify.listen({ port: 0 })
  const ws = new WebSocket(
    'ws://localhost:' + fastify.server.address().port + '/echo'
  )
  const client = WebSocket.createWebSocketStream(ws, { encoding: 'utf8' })
  t.teardown(client.destroy.bind(client))

  client.setEncoding('utf8')
  client.write('hello server')

  const [chunk] = await once(client, 'data')
  t.equal(chunk, 'hello client')
  client.end()
  await once(client, 'close')
})

test('Should not hijack reply for an normal request to a websocket route that is sent a normal HTTP response in a hook', async t => {
  t.plan(2)

  const fastify = Fastify()

  await fastify.register(fastifyWebsocket)
  fastify.addHook('preValidation', async (_, reply) => {
    t.pass('preValidation called')
    await Promise.resolve()
    await reply.code(404).send('not found')
  })
  fastify.get('/echo', { websocket: true }, () => {
    t.fail()
  })

  await fastify.listen({ port: 0 })

  const port = fastify.server.address().port

  const httpClient = net.createConnection({ port })
  httpClient.end('GET /echo HTTP/1.1\r\n\r\n')
  const [data] = await once(httpClient, 'data')
  t.match(data.toString(), /not found/i)
  httpClient.resume()
  await once(httpClient, 'close')
  await fastify.close()
})

test('Should not hijack reply for an WS request to a WS route that gets sent a normal HTTP response in a hook', async t => {
  const fastify = Fastify()
  t.teardown(() => fastify.close())

  await fastify.register(fastifyWebsocket)
  fastify.addHook('preValidation', async (_, reply) => {
    await Promise.resolve()
    await reply.code(404).send('not found')
  })
  fastify.get('/echo', { websocket: true }, () => {
    t.fail()
  })

  await fastify.listen({ port: 0 })

  const ws = new WebSocket('ws://localhost:' + (fastify.server.address()).port + '/echo')
  const client = WebSocket.createWebSocketStream(ws, { encoding: 'utf8' })
  t.teardown(client.destroy.bind(client))

  await once(client, 'error')
})
