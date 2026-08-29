# e2e last run

chainId: 31337
burner: 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC
wait: evm_increaseTime(60)

| step | expected | actual | tx |
| --- | --- | --- | --- |
| PASS preflight getCode all ADDRESSES | non-empty | 11 contracts | `—` |
| PASS 1 faucet +100 dUSD | 100000000 | 100000000 | `0x53cb841fded2df169973decbd386823db072e4e3aa37b787b4a79edbd3390074` |
| PASS 2a joinBallast 60 shares > 0 | >0 | 60000000000000000000 | `0x8457512d7f7d69875d13c5b9db2d8bb2db49944d3bf2f5140bb35a20e992af06` |
| PASS 2b joinHull 40 shares > 0 | >0 | 40000000000000000000 | `0x3620527f4966590a521530fa8fe9037d6d224cb3cd521620941490a94e420e22` |
| PASS 2c subordination ≥ 20% | >= 2000 bps | 6000 | `0x3620527f4966590a521530fa8fe9037d6d224cb3cd521620941490a94e420e22` |
| PASS 3a spot WMON > 0 | >0 | 90000000000000000000 | `0xde7c150a3c747330ebda06730f88061e6fcacb4ddfdd92186aae9444a0bb05a1` |
| PASS 3b shortNotional > 0 | >0 | 90000000 | `0xde7c150a3c747330ebda06730f88061e6fcacb4ddfdd92186aae9444a0bb05a1` |
| PASS 3c |netDeltaBps| ≤ 100 | <= 100 | 0 | `0xde7c150a3c747330ebda06730f88061e6fcacb4ddfdd92186aae9444a0bb05a1` |
| PASS 4 conservation identity (wei) | 21 | 21 | `0x4d1c457d975e669757bdf57c31f24da87dd46d35ee8039db4fe9374a1e55e99a` |
| PASS 5a hull NAV unchanged | 40000008 | 40000008 | `0x2f4f22c9c95d07a23ceb6d572d75c827bbd3a761684217ce8fbd5f83e4ee05a7` |
| PASS 5b ballast NAV − shortfall | 59999964 | 59999964 | `0x2f4f22c9c95d07a23ceb6d572d75c827bbd3a761684217ce8fbd5f83e4ee05a7` |
| PASS 6a floor after partial ballast exit | >= 2000 bps | 5744 | `0xad151512a0817f6de11f6456b1bc0ed0501c7e345be0fb76da076c543c57825e` |
| PASS 6a2 unwind for idle cash | success | success | `0xdf5f4b5a8024d2f3d221897f4fe2af7c19d5aa61921d9683d9df691837985e36` |
| PASS 6b exitHull payout = principal + accrued | 40000008 | 40000008 | `0x245289833a0f43ed361d94ac58ed0306d6e317c06d281b8bf9067d7719a8ac01` |
