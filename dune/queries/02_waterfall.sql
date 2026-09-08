-- Vessel · Tranches.Waterfall settles (Monad testnet)
-- topic0 = keccak256("Waterfall(int256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256)")

WITH vessel AS (
  SELECT
    0xdb4666c3F187e73795bcF9Cfb3a6D64A875EF842 AS tranches,
    CAST(57918591 AS bigint) AS start_block
)
SELECT
  date_trunc('day', l.block_time) AS day,
  COUNT(*) AS waterfall_events,
  COUNT(DISTINCT l.tx_hash) AS txs
FROM monad_testnet.logs AS l
CROSS JOIN vessel AS v
WHERE l.contract_address = v.tranches
  AND l.block_number >= v.start_block
  AND l.topic0 = 0xdc7db4ac4cc73b7e284636f7bc67b4e001a9b7d93198b689e89f22022ce62b84
GROUP BY 1
ORDER BY 1 DESC
