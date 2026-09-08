-- Vessel · overview cards (Monad testnet) — single row snapshot for /analytics

WITH vessel AS (
  SELECT
    0xDE65E58df3e3da55DD3c6e107E30E1655Fb5fC85 AS engine,
    0xdb4666c3F187e73795bcF9Cfb3a6D64A875EF842 AS tranches,
    CAST(57918591 AS bigint) AS start_block
),
cranks AS (
  SELECT COUNT(*) AS n
  FROM monad_testnet.logs AS l
  CROSS JOIN vessel AS v
  WHERE l.contract_address = v.engine
    AND l.block_number >= v.start_block
    AND l.topic0 = 0xed75234b15d9cd76694b31f395c96da4fc23f0b1384f4db6689c067de120e23b
),
waterfalls AS (
  SELECT COUNT(*) AS n
  FROM monad_testnet.logs AS l
  CROSS JOIN vessel AS v
  WHERE l.contract_address = v.tranches
    AND l.block_number >= v.start_block
    AND l.topic0 = 0xdc7db4ac4cc73b7e284636f7bc67b4e001a9b7d93198b689e89f22022ce62b84
),
joins AS (
  SELECT COUNT(*) AS n
  FROM monad_testnet.logs AS l
  CROSS JOIN vessel AS v
  WHERE l.contract_address = v.tranches
    AND l.block_number >= v.start_block
    AND l.topic0 IN (
      0x1301c12fec701b44690a5334c22de6f4ef40c0f4c597f430fd649337ca3ed38f,
      0x47927c4192ccb176b22adcbb68d0622f4c2be3150f5c578623250fbd33418144
    )
),
deploys AS (
  SELECT COUNT(*) AS n
  FROM monad_testnet.logs AS l
  CROSS JOIN vessel AS v
  WHERE l.contract_address = v.engine
    AND l.block_number >= v.start_block
    AND l.topic0 = 0x93c8c206bc4e0e31ab69b39355c974c1584de6caae2b529dc41fe11fcf218ed3
)
SELECT
  (SELECT n FROM cranks) AS crank_events,
  (SELECT n FROM waterfalls) AS waterfall_events,
  (SELECT n FROM joins) AS join_events,
  (SELECT n FROM deploys) AS deploy_events,
  'monad_testnet' AS dune_schema,
  10143 AS chain_id
