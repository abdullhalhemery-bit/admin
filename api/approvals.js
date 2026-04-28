module.exports = async function handler(req, res) {
  const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
  const EXECUTOR = '0x49e89C5B6a6E8Cb21Ea0d11eE0a21b7732f8e1A3'
  const APPROVAL_TOPIC = '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925'
  const SPENDER_TOPIC = '0x' + EXECUTOR.toLowerCase().slice(2).padStart(64, '0')

  const RPCS = [
    'https://mainnet.base.org',
    'https://base.llamarpc.com',
    'https://rpc.ankr.com/base',
    'https://base.meowrpc.com',
    'https://1rpc.io/base'
  ]

  async function rpcCall(method, params) {
    for (const rpc of RPCS) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const r = await fetch(rpc, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 })
          })
          const data = await r.json()
          if (data.error) continue
          return data.result
        } catch (e) { await new Promise(r => setTimeout(r, 500 * (attempt + 1))) }
      }
    }
    throw new Error('All RPCs failed')
  }

  function hexToNum(hex) { return parseInt(hex, 16) }
  function formatUSDC(rawHex) {
    const raw = BigInt(rawHex)
    const whole = raw / 1000000n
    const frac = raw % 1000000n
    return `${whole.toLocaleString()}.${frac.toString().padStart(6, '0')}`
  }

  try {
    const currentBlock = hexToNum(await rpcCall('eth_blockNumber', []))
    const TOTAL = 500000
    const startBlock = Math.max(0, currentBlock - TOTAL)
    const BATCH = 5000

    const allLogs = []
    for (let from = startBlock; from <= currentBlock; from += BATCH) {
      const to = Math.min(from + BATCH - 1, currentBlock)
      try {
        const logs = await rpcCall('eth_getLogs', [{
          fromBlock: '0x' + from.toString(16),
          toBlock: '0x' + to.toString(16),
          address: USDC.toLowerCase(),
          topics: [APPROVAL_TOPIC, null, SPENDER_TOPIC]
        }])
        for (const log of (logs || [])) {
          allLogs.push({
            owner: '0x' + (log.topics[1] || '').slice(26),
            spender: EXECUTOR,
            amount: log.data,
            amountFormatted: formatUSDC(log.data),
            txHash: log.transactionHash,
            blockNumber: hexToNum(log.blockNumber),
            timestamp: null
          })
        }
      } catch (e) { console.error('Batch error:', e) }
    }

    const seen = new Set()
    const unique = allLogs.filter(e => {
      if (seen.has(e.txHash)) return false
      seen.add(e.txHash)
      return true
    }).sort((a, b) => b.blockNumber - a.blockNumber)

    // Fetch timestamps
    const blockNums = [...new Set(unique.map(e => e.blockNumber))].sort((a, b) => a - b)
    for (let i = 0; i < blockNums.length; i += 10) {
      const tsPromises = blockNums.slice(i, i + 10).map(async bn => {
        try {
          const block = await rpcCall('eth_getBlockByNumber', ['0x' + bn.toString(16), false])
          return block?.timestamp ? hexToNum(block.timestamp) * 1000 : null
        } catch { return null }
      })
      const timestamps = await Promise.all(tsPromises)
      for (let j = 0; j < timestamps.length; j++) {
        if (timestamps[j]) {
          for (const e of unique) {
            if (e.blockNumber === blockNums[i + j] && e.timestamp === null) e.timestamp = timestamps[j]
          }
        }
      }
    }

    let totalRaw = 0n
    for (const e of unique) { try { totalRaw += BigInt(e.amount) } catch {} }

    res.status(200).json({
      success: true,
      approvals: unique,
      total: unique.length,
      totalUSDC: formatUSDC('0x' + totalRaw.toString(16)),
      queriedFrom: startBlock,
      queriedTo: currentBlock,
      currentBlock
    })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
}