// VeiledHood — mock data
const TOKENS = {
  ETH:  { sym: 'ETH',  name: 'Ether',        color: '#5B7BE8', chain: 'Robinhood Chain', px: 3184.20 },
  USDC: { sym: 'USDC', name: 'USD Coin',     color: '#2775CA', chain: 'Robinhood Chain', px: 1.00 },
  vETH: { sym: 'vETH', name: 'Shielded ETH', color: '#8257FF', chain: 'Shielded pool',   px: 3184.20 },
  vUSD: { sym: 'vUSD', name: 'Shielded USDC',color: '#6E4BD8', chain: 'Shielded pool',   px: 1.00 },
  HOOD: { sym: 'HOOD', name: 'Robinhood',    color: '#3FD98B', chain: 'Robinhood Chain', px: 24.86 },
};

const BALANCES = { ETH: 4.284, USDC: 18420.55, vETH: 11.902, vUSD: 42180.00, HOOD: 1240.5 };

const HOLDINGS = [
  { sym: 'vETH', amt: 11.902, shielded: true },
  { sym: 'vUSD', amt: 42180.00, shielded: true },
  { sym: 'ETH',  amt: 4.284, shielded: false },
  { sym: 'USDC', amt: 18420.55, shielded: false },
  { sym: 'HOOD', amt: 1240.5, shielded: false },
];

const SERIES = [58, 61, 59, 66, 71, 68, 74, 79, 77, 84, 88, 86, 93, 97, 101, 108];
const SERIES_D = [42, 44, 43, 47, 46, 51, 55, 53, 58, 62, 60, 66, 69, 72, 76, 81];

const ACTIVITY = [
  { id: 'a1', kind: 'swap',   title: 'Shielded swap',      sub: '2.400 vETH → 7,642.08 vUSD', at: '2 min ago',  val: '+7,642.08', unit: 'vUSD', tone: 'pos', priv: true },
  { id: 'a2', kind: 'vault',  title: 'Vault deposit',      sub: '5.000 ETH → shielded pool',  at: '1 hr ago',   val: '+5.0000',   unit: 'vETH', tone: 'pos', priv: true },
  { id: 'a3', kind: 'pay',    title: 'Agent payment',      sub: 'inference · 0.01 USDC',      at: '3 hr ago',   val: '−0.0100',   unit: 'USDC', tone: '',    priv: true },
  { id: 'a4', kind: 'bridge', title: 'Bridge in',          sub: 'Ethereum → Robinhood Chain',at: '6 hr ago',   val: '+12,000.00',unit: 'USDC', tone: 'pos', priv: true },
  { id: 'a5', kind: 'stake',  title: 'Staking reward',     sub: 'epoch 1,284 claim',          at: '1 day ago',  val: '+18.4200',  unit: 'HOOD', tone: 'pos', priv: false },
  { id: 'a6', kind: 'swap',   title: 'Public swap',        sub: '840.00 USDC → 0.264 ETH',    at: '2 days ago', val: '+0.2640',   unit: 'ETH',  tone: 'pos', priv: false },
];

const RECORDS = [
  { id: 'r1', label: 'Strategy · delta-neutral v4', tags: ['strategy', 'live'], size: '4.2 KB', at: 'Today, 09:14' },
  { id: 'r2', label: 'Agent memory · research thread', tags: ['agent', 'memory'], size: '128 KB', at: 'Yesterday' },
  { id: 'r3', label: 'API config · execution keys', tags: ['config'], size: '1.1 KB', at: '3 days ago' },
  { id: 'r4', label: 'Portfolio thesis Q3', tags: ['notes'], size: '18 KB', at: 'Last week' },
];

const AGENT_MSGS = [
  { role: 'user', text: 'What is my shielded exposure to ETH right now, and what would rebalancing to 40% stables cost me?' },
  { role: 'agent', text: 'Your shielded ETH position is 11.902 vETH — $37,899 at $3,184.20, which is 47.3% of your shielded balance. Moving to 40% stables means swapping 2.29 vETH (≈$7,290). Routed through the shielded pool the price impact is 0.04% and the whole thing settles in one private transaction.' },
];

const CLIENTS = [
  { id: 'c1', name: 'Claude Code', status: 'connected', tools: 6, last: 'Active now' },
  { id: 'c2', name: 'Cursor', status: 'connected', tools: 6, last: '12 min ago' },
  { id: 'c3', name: 'Claude Desktop', status: 'idle', tools: 4, last: '2 hr ago' },
  { id: 'c4', name: 'Cline', status: 'off', tools: 0, last: 'Never' },
];

const SERVICES = [
  { id: 's1', name: 'Private inference', price: 0.01, calls: 4820, spend: 48.20 },
  { id: 's2', name: 'Wallet context read', price: 0.005, calls: 12640, spend: 63.20 },
  { id: 's3', name: 'Encrypted data fetch', price: 0.002, calls: 3180, spend: 6.36 },
];

const PAYMENTS = [
  { id: 'p1', to: '0x3fB1…a07E', svc: 'Private inference', amt: 0.01, at: '14:22:08' },
  { id: 'p2', to: '0x91cD…4Fa2', svc: 'Wallet context', amt: 0.005, at: '14:21:44' },
  { id: 'p3', to: '0xC58e…b913', svc: 'Private inference', amt: 0.01, at: '14:19:02' },
  { id: 'p4', to: '0x7Ae2…1Dd9', svc: 'Encrypted data', amt: 0.002, at: '14:16:31' },
  { id: 'p5', to: '0x44bF…9c02', svc: 'Private inference', amt: 0.01, at: '14:12:55' },
];

const POOLS = [
  { id: 'v1', name: 'Shielded ETH', sym: 'vETH', apr: 4.82, staked: 8.400, tvl: '24,180 vETH' },
  { id: 'v2', name: 'Shielded USDC', sym: 'vUSD', apr: 7.14, staked: 24000, tvl: '48.2M vUSD' },
  { id: 'v3', name: 'HOOD', sym: 'HOOD', apr: 12.60, staked: 0, tvl: '2.4M HOOD' },
];

const totalUsd = (list) => list.reduce((s, h) => s + h.amt * TOKENS[h.sym].px, 0);
const SHIELDED_USD = totalUsd(HOLDINGS.filter(h => h.shielded));
const PUBLIC_USD = totalUsd(HOLDINGS.filter(h => !h.shielded));
const TOTAL_USD = SHIELDED_USD + PUBLIC_USD;

Object.assign(window, { TOKENS, BALANCES, HOLDINGS, SERIES, SERIES_D, ACTIVITY, RECORDS, AGENT_MSGS, CLIENTS, SERVICES, PAYMENTS, POOLS, SHIELDED_USD, PUBLIC_USD, TOTAL_USD });
