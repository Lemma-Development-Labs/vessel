# /product/hull

## Hull (dated fixed income)

Hull is a dated fixed-income tranche:

- A depositor receives a **fixed coupon rate** at purchase (the rate is known up-front).
- Losses are sub-ordinated: the system routes losses after Ballast is depleted.
- Hull issuance is capped by posted Ballast via the protocol’s subordination floor.

Hull is protected only as long as Ballast + reserve exist. In stress, losses reach Hull last.

