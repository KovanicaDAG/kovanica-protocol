export async function getBalance(address: string): Promise<string> {
  try {
    const response = await fetch('http://localhost:8545', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_getBalance',
        params: [address, 'latest'],
        id: 1,
      }),
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    // Convert hex string (e.g. 0x...) to decimal balance and assume 18 decimals like ETH
    const wei = BigInt(data.result);
    const kvnc = Number(wei) / 1e18;
    return kvnc.toFixed(2);
  } catch (error) {
    console.error('Failed to fetch balance:', error);
    return '0.00';
  }
}
