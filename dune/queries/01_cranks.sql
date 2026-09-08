-- Vessel · EngineLite.Cranked tape (Monad testnet)
-- topic0 = keccak256("Cranked(address,int256,int256)")
-- Publish on Dune, then set NEXT_PUBLIC_DUNE_QUERY_* / dashboard URL.

WITH vessel AS (
  SELECT
    0xDE65E58df3e3da55DD3c6e107E30E1655Fb5fC85 AS engine,
    CAST(57918591 AS bigint) AS start_block
),
cranks AS (
  SELECT
    l.block_time,
    l.block_number,
    l.tx_hash,
    l.tx_from AS caller,
    -- netDeltaBps is the 3rd int256 in data (offset 64); keep raw for decode in viz
    l.data AS payload
  FROM monad_testnet.logs AS l
  CROSS JOIN vessel AS v
  WHERE l.contract_address = v.engine
    AND l.block_number >= v.start_block
    AND l.topic0 = 0xed75234b15d9cd76694b31f395c96da4fc23f0b1384f4db6689c067de120e23b
)
SELECT
  date_trunc('day', block_time) AS day,
  COUNT(*) AS crank_count,
  COUNT(DISTINCT caller) AS unique_crankers
FROM cranks
GROUP BY 1
ORDER BY 1 DESC
