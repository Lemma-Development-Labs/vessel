# e2e last run

chainId: 10143
burner: 0xfD49f731679FC9959A3F73dDE3d6444ed619030A
wait: 60000ms wall clock

| step | expected | actual | tx |
| --- | --- | --- | --- |
| PASS preflight getCode all ADDRESSES | non-empty | 11 contracts | `—` |
| PASS 1 faucet +100 dUSD | 100000000 | 100000000 | `0x7883f4b42e733b2c90718f2de7366fa3ff5a4c5c8a4165aef39b937f3b112509` |
| PASS 2a joinBallast 60 shares > 0 | >0 | 60000000000000000000 | `0x5c952f950187c80f36d2f6f3d2cc34081be77a2e2024b13625a980e045fa976e` |
| PASS 2b joinHull 40 shares > 0 | >0 | 40000000000000000000 | `0x5ef384f02bd5bbcbd169937ccfeeed6b013261d46ea46f6a1642c81cc9b6a6e2` |
| PASS 2c subordination ≥ 20% | >= 2000 bps | 6000 | `0x5ef384f02bd5bbcbd169937ccfeeed6b013261d46ea46f6a1642c81cc9b6a6e2` |
| PASS 3a spot WMON > 0 | >0 | 90000000000000000000 | `0x22acec226698d8dfa21654898dd460e4a7a9ac7541620f09348af3256f06f2ae` |
| PASS 3b shortNotional > 0 | >0 | 90000000 | `0x22acec226698d8dfa21654898dd460e4a7a9ac7541620f09348af3256f06f2ae` |
| PASS 3c |netDeltaBps| ≤ 100 | <= 100 | 0 | `0x22acec226698d8dfa21654898dd460e4a7a9ac7541620f09348af3256f06f2ae` |
| PASS 4 conservation identity (wei) | 21 | 21 | `0x2d358ecff432ba4354558b0cd7f7a08f32d66bf751d469b1ebb50766e218bc13` |
| PASS 5a hull NAV unchanged | 40000018 | 40000018 | `0x48c8d28ec4a0af99416c22db6f3c94d45fd5fff5cbc63d39ecefdb2caad01f5e` |
| PASS 5b ballast NAV − shortfall | 59999959 | 59999959 | `0x48c8d28ec4a0af99416c22db6f3c94d45fd5fff5cbc63d39ecefdb2caad01f5e` |
| PASS 6a floor after partial ballast exit | >= 2000 bps | 5744 | `0xfc4791b1c0a6e640acbeebc696a27a86d2ec0343a7ed573a62351074c03532c3` |
| PASS 6a2 unwind for idle cash | success | success | `0xc2c6be632e3f80daaaa51ab98614cf670a5c3da64229132748e9ce9560258443` |
| PASS 6b exitHull payout = principal + accrued | 40000018 | 40000018 | `0xe7f25289d4e41ece892c8ad6b2185755c620dd4b41decfa51467f2024d15d736` |
