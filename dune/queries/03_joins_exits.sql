-- Vessel · Hull / Ballast joins & exits (Monad testnet)

WITH vessel AS (
  SELECT
    0xdb4666c3F187e73795bcF9Cfb3a6D64A875EF842 AS tranches,
    CAST(57918591 AS bigint) AS start_block
),
labeled AS (
  SELECT
    l.block_time,
    l.block_number,
    l.tx_hash,
    CASE l.topic0
      WHEN 0x1301c12fec701b44690a5334c22de6f4ef40c0f4c597f430fd649337ca3ed38f THEN 'join_hull'
      WHEN 0x47927c4192ccb176b22adcbb68d0622f4c2be3150f5c578623250fbd33418144 THEN 'join_ballast'
      WHEN 0x5ce8e96b3a3d46914a6462cfeef67bc785bf72429a4a7276065c5a8b613a3360 THEN 'exit_hull'
      WHEN 0x0928688bfe6c1093ad5e29d3251392fb08d384f95de56f2d0bc6e6c909d72e85 THEN 'exit_ballast'
    END AS kind
  FROM monad_testnet.logs AS l
  CROSS JOIN vessel AS v
  WHERE l.contract_address = v.tranches
    AND l.block_number >= v.start_block
    AND l.topic0 IN (
      0x1301c12fec701b44690a5334c22de6f4ef40c0f4c597f430fd649337ca3ed38f,
      0x47927c4192ccb176b22adcbb68d0622f4c2be3150f5c578623250fbd33418144,
      0x5ce8e96b3a3d46914a6462cfeef67bc785bf72429a4a7276065c5a8b613a3360,
      0x0928688bfe6c1093ad5e29d3251392fb08d384f95de56f2d0bc6e6c909d72e85
    )
)
SELECT
  date_trunc('day', block_time) AS day,
  kind,
  COUNT(*) AS events
FROM labeled
GROUP BY 1, 2
ORDER BY 1 DESC, 2
