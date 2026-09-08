-- Vessel testnet addresses (MonadId 10143). Keep in sync with ADDRESSES.json.
-- Paste as a CTE at the top of every Vessel dashboard query, or save as a
-- Dune "query materialization" once you have an account.

-- EngineLite  0xDE65E58df3e3da55DD3c6e107E30E1655Fb5fC85
-- Tranches    0xdb4666c3F187e73795bcF9Cfb3a6D64A875EF842
-- BlitzVault  0xE1c3aBAd2789aC170833d9E9bd72E706284a70c5
-- deployedBlock 57918591

WITH vessel AS (
  SELECT
    0xDE65E58df3e3da55DD3c6e107E30E1655Fb5fC85 AS engine,
    0xdb4666c3F187e73795bcF9Cfb3a6D64A875EF842 AS tranches,
    0xE1c3aBAd2789aC170833d9E9bd72E706284a70c5 AS vault,
    CAST(57918591 AS bigint) AS start_block
)
SELECT * FROM vessel
