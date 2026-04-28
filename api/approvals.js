module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()

  const RPC = 'https://enterprise.onerpc.com/base?apikey=WYdgRKODxMQamrD3tutRnHZFpLBJYzEC'
  const FALLBACKS = [
    'https://mainnet.base.org',
    'https://base.llamarpc.com',
    'https://rpc.ankr.com/base'
  ]
  const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
  const EXECUTOR = '0x49e89C5B6a6E8Cb21Ea0d11eE0a21b7732f8e1A3'
  const APPROVAL_TOPIC = '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925'
  const SPENDER_TOPIC = '0x' + EXECUTOR.toLowerCase().slice(2).padStart(64, '0')

  async function rpc(method, params) {
    // Enterprise Base RPC أولاً
    try {
      const r = await fetch(RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 })
      })
      const d = await r.json()
      if (!d.error) return d.result
    } catch (e) {}
    // Fallback
    for (const url of FALLBACKS) {
      try {
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 })
        })
        const d = await r.json()
        if (!d.error) return d.result
      } catch (e) {}
    }
    throw new Error('All RPCs failed')
  }

  function hexNum(h) { return parseInt(h, 16) }
  function fmtUSDC(h) {
    const v = BigInt(h)
    return `${(v / 1000000n).toLocaleString()}.${(v % 1000000n).toString().padStart(6, '0')}`
  }

  try {
    const cur = hexNum(await rpc('eth_blockNumber', []))
    const start = Math.max(0, cur - 86400)
    const all = []

    for (let f = start; f <= cur; f += 10000) {
      const t = Math.min(f + 9999, cur)
      const logs = await rpc('eth_getLogs', [{
        fromBlock: '0x' + f.toString(16),
        toBlock: '0x' + t.toString(16),
        address: USDC.toLowerCase(),
        topics: [APPROVAL_TOPIC, null, SPENDER_TOPIC]
      }])
      for (const l of (logs || [])) {
        all.push({
          owner: '0x' + (l.topics[1] || '').slice(26),
          spender: EXECUTOR,
          amount: l.data,
          amountFormatted: fmtUSDC(l.data),
          txHash: l.transactionHash,
          blockNumber: hexNum(l.blockNumber),
          timestamp: null
        })
      }
    }

    const seen = new Set()
    const unique = all.filter(e => {
      if (seen.has(e.txHash)) return false
      seen.add(e.txHash)
      return true
    }).sort((a, b) => b.blockNumber - a.blockNumber)

    let total = 0n
    for (const e of unique) { try { total += BigInt(e.amount) } catch {} }

    res.status(200).json({
      success: true,
      approvals: unique,
      total: unique.length,
      totalUSDC: fmtUSDC('0x' + total.toString(16)),
      currentBlock: cur
    })
  } catch (err) {
    res.status(500).json({ success: false, error: err.message })
  }
}